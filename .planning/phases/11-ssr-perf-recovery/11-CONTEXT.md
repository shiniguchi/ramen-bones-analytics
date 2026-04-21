# Phase 11: SSR Performance & Recovery - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning
**Auto-decided:** User directed "follow your recs first for all questions" — every gray area below is Claude's recommended option with rationale logged inline. User may revise before planning. Rationale for each decision is rooted in the root-cause analysis at `.planning/debug/cf-pages-ssr-cpu-1102.md`.

<domain>
## Phase Boundary

Stop the deployed dashboard at `https://ramen-bones-analytics.pages.dev/` from returning HTTP 404 "Not found" (9-byte body) on every SSR route. Root cause: `src/routes/+page.server.ts` fans out 11 Supabase queries per SSR load; 4 are hard-coded lifetime-unbounded (ignore the chip window) and 3 more scale to lifetime when `range=all` resolves to `from=1970-01-01`. The combined sequential `fetchAll` pagination + JSON parse + Supabase round-trip exceeds Cloudflare Pages Free-tier's **50 subrequests / 50ms CPU per request** budget → Error 1102 → repeat 1102s cause Cloudflare to unpin the production deployment → all SSR routes 404. Static pipeline (`/robots.txt` → 200) keeps serving throughout, confirming the Worker is dark while Pages is alive.

**In scope:**
1. **Clamp the "All" range** so SSR never receives `from=1970-01-01` (or any other pathological input).
2. **Move the 4 lifetime-unbounded queries off the SSR critical path** to deferred endpoints + client-side lazy fetches, matching the Phase 10 D-11 `LazyMount` pattern already used for below-fold cards.
3. **Cap `fetchAll` pages** scaled to the chip window, with a hard 50-page ceiling so a single regression cannot blow the subrequest budget again.

**Explicitly out of scope:**
- New filter surfaces or new charts (this is a pure structural fix).
- Moving to a paid Cloudflare plan (project constraint: $0/month).
- Backend SQL refactoring — the materialized views already aggregate correctly; the problem is the Worker, not the database.
- Redeploying the same commit as a bandage (that's `project_cf_pages_stuck_recovery.md` memory — already tried, doesn't fix root cause).
- Touching the user's uncommitted local changes in `src/lib/components/CalendarCountsCard.svelte`, `CalendarItemRevenueCard.svelte`, `CalendarItemsCard.svelte`, `CalendarRevenueCard.svelte`, `dashboardStore.svelte.ts`, or `tests/unit/CalendarCards.test.ts`. These are in-flight work unrelated to the SSR blowup (they affect client render, not server fan-out). Plans must stash/leave these alone; if a plan must touch `dashboardStore.svelte.ts`, note it explicitly so the user can merge their pending diff first.

</domain>

<decisions>
## Implementation Decisions

### Range Clamping
- **D-01:** **`chipToRange('all')` resolves `from` to the tenant's earliest `business_date`, not `'1970-01-01'`.** The earliest date is fetched once per SSR from `transactions_filterable_v` via `SELECT MIN(business_date)` (indexed — one round-trip, negligible cost). Fallback to hard-coded `'2024-01-01'` if the MIN query errors or returns null (empty tenant).

  **Concretely:** `src/lib/dateRange.ts:25-27` becomes `{ from: earliestBusinessDate ?? '2024-01-01', to: todayStr, priorFrom: null, priorTo: null }`. The `earliestBusinessDate` value is injected by `+page.server.ts` before calling `chipToRange`, so `dateRange.ts` stays framework-agnostic. Alternative signature: `chipToRange(range, now, { allStart })` where `allStart` is optional and defaults to `'2024-01-01'`.

  **Why not hard-code `'2020-01-01'` or similar:** the restaurant's earliest transaction is the semantic truth of "All". Hard-coding a floor creates a silent truncation when historical data is loaded (e.g., future CSV import of pre-2024 data). The SSR query for MIN is cheap (<10ms) and self-correcting.

  **Why not skip the SSR query and compute earliest on the client:** the 1970 default originates in `chipToRange` which runs on both SSR and client. Client-side fallback leaves the SSR path exposed. Must fix at the SSR boundary.

- **D-02:** **`parseFilters` soft-clamps `from < '2024-01-01'` to `'2024-01-01'` and emits a console warn.** Does NOT reject the URL — old bookmarks stay usable. `to > today + 1 year` similarly clamps. `to < from` continues to swap (existing `customToRange` D-17 tolerance — unchanged).

  **Why soft-clamp, not error:** the existing customToRange already swaps inverted dates (`dateRange.ts:54-55`) — the codebase pattern is "tolerate bad input, log it, keep serving". 4xx on bookmarked URLs breaks the trust model.

### SSR Fan-out Reduction
- **D-03:** **Move 4 lifetime-unbounded queries out of the SSR `Promise.all` into deferred client-side fetches.** The 4 targets and their new homes:

  | Query (current) | SSR line | Feeds | New location |
  |---|---|---|---|
  | `dailyKpiP` (kpi_daily_v) | +page.server.ts:101-105 | Daily KPI heatmap (quick-260418-map, below fold) | `GET /api/kpi-daily` + client `$lib/clientFetch` with `LazyMount` |
  | `customerLtvP` (customer_ltv_v) | +page.server.ts:116-119 | VA-07 LtvHistogramCard, VA-09 CohortRevenueCard, VA-10 CohortAvgLtvCard (all below fold) | `GET /api/customer-ltv` |
  | `repeaterTxP` (lifetime card-hash tx) | +page.server.ts:125-129 | Repeater card recomputation, only when day-of-week filter active | `GET /api/repeater-lifetime?days=...` — only fetched when `filters.days` is non-default |
  | `retentionP` + `retentionMonthlyP` (retention_curve_v) | +page.server.ts:153-164 | CohortRetentionCard (below fold per Phase 10 D-10 position 9) | `GET /api/retention` |

  **SSR keeps only:** `data_freshness_v` (1 row), `dailyRowsP` (range-bounded), `priorDailyRowsP` (range-bounded), `itemCountsP` (range-bounded), `benchmarkAnchorsP` + `benchmarkSourcesP` (small seed tables), `insightP` (single row via `.limit(1)`). That's 7 SSR subrequests max on narrow ranges — comfortably under the 50-subrequest cap.

  **Why defer, not sample / limit / cache:** the unbounded queries grow with the business. A `LIMIT 100` today works but breaks silently as the restaurant grows. Deferring puts the growth-proportional cost on the client (where CPU/memory budgets are much larger) and keeps SSR under Cloudflare's hard limits.

  **Why these 4 (not others):** each is (a) unbounded by chip window, (b) feeds cards below the first viewport fold (verified against Phase 10 D-10 order), (c) not required to render the above-fold KPI tiles or revenue chart. Moving them does not regress the skeleton load.

  **How client fetches:** new `$lib/clientFetch.ts` helper wraps `fetch('/api/...')` with SWR-style in-memory cache keyed by query params. Existing `LazyMount` (Phase 10 D-11) gates the fetch on `IntersectionObserver` scroll-into-view. Cards render with skeleton until their fetch resolves.

- **D-04:** **`+page.svelte` composition stays in D-10 order.** No visual regression. Cards below the fold gain a skeleton → real render transition. Above-the-fold paint timing improves because SSR returns faster (7 queries instead of 11).

### fetchAll Safety Cap
- **D-05:** **`fetchAll()` gains a second-optional parameter `maxPages`, default `50` (not `1000`).** The hard 1000-page cap is kept as a last-resort guard but should never be hit in normal operation. Each caller may pass a smaller cap based on its known payload shape; the `MAX_PAGES` export becomes `DEFAULT_MAX_PAGES = 50` with `HARD_MAX_PAGES = 1000` still exported for extreme cases.

  **Why 50:** CF Pages Free subrequest limit is 50 per request. If a single fetchAll call ever needs more than 50 pages (50,000 rows), it's an architectural problem that needs SQL-side aggregation, not a pagination loop.

  **Why keep `HARD_MAX_PAGES = 1000`:** migrations or seed scripts may legitimately want to iterate large datasets server-side. Don't break those paths.

### Defense & Observability
- **D-06:** **Add a `+page.server.ts` SSR timing log** (dev-only, gated by `import.meta.env.DEV`) that logs `console.info` with query count and total ms. Cheap, turns off in production via tree-shake. Lets future gotchas surface in `wrangler pages deployment tail` output without paid observability.

- **D-07:** **Document the CF Pages free-tier limits inline** in `+page.server.ts` at the top of the load function. A 4-line comment: "CF Pages Free = 50 subrequests + 50ms CPU per request. If this SSR adds a new query, consider deferring." Cheap tripwire for the next reviewer.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Debug session (root cause)
- `.planning/debug/cf-pages-ssr-cpu-1102.md` — full evidence chain: which queries are unbounded, what triggers 1102, why redeploy is a bandage.

### Prior related sessions / memory
- `.planning/debug/range-chip-stale-cache.md` — 2026-04-18 fix that added `invalidateAll`, which made "All" actually re-run SSR and thus exposed this issue.
- `.claude/memory/project_cf_pages_stuck_recovery.md` — recovery pattern (`gh workflow run deploy.yml --ref main`). Bandage only.
- `.claude/memory/project_silent_error_isolation.md` — prior `.catch(() => [])` mask pattern. Relevant because the current SSR still uses `.catch` wrappers; plans must not add new silent masks.

### Existing patterns to reuse
- `src/routes/+page.server.ts:22-56` — existing E2E fixture bypass pattern (reference for how to branch the load function cleanly).
- Phase 10 D-11 `LazyMount` — established pattern for below-fold mounting via `IntersectionObserver`.
- Phase 10 `10-08-PLAN.md` — prior SSR fan-out composition, helpful context for how the current 11-query structure was assembled.
- `src/lib/supabasePagination.ts` — `fetchAll` implementation; the `MAX_PAGES` cap change lives here.
- `src/lib/filters.ts` — `parseFilters` lives here (D-02 clamp).

### Framework / infra
- Cloudflare Pages Free limits: 50 subrequests per request, 50ms CPU per request (per `.planning/research/` or CLAUDE.md verification).
- SvelteKit `+server.ts` API endpoints: used for new `/api/*` routes.
- Supabase RLS: new `/api/*` endpoints must use `locals.supabase` so tenant scoping is preserved.

### Project guardrails (from CLAUDE.md)
- No paid tiers in v1.
- Mobile-first: new API fetches must not regress first paint at 375px.
- No raw `_mv` references — always query via `_v` wrapper views. (CI guard will fail otherwise.)
- RLS: tenant_id scoping from day 1 on every new endpoint.

</canonical_refs>

<specifics>
## Specific Ideas

- The user has uncommitted local changes to `src/lib/components/CalendarCountsCard.svelte`, `CalendarItemRevenueCard.svelte`, `CalendarItemsCard.svelte`, `CalendarRevenueCard.svelte`, `src/lib/dashboardStore.svelte.ts`, and `tests/unit/CalendarCards.test.ts`. Plans MUST NOT modify these files unless strictly required. If `dashboardStore.svelte.ts` must change for D-03, the plan must call this out so the user can commit/stash their in-flight work first.

- Verification criterion: after deploy, `curl -sS -o /dev/null -w "HTTP %{http_code} size=%{size_download}\n" 'https://ramen-bones-analytics.pages.dev/?range=all'` must return `HTTP 303` (redirect to `/login`) or `HTTP 200` — never `HTTP 404 size=9`.

- Verification criterion: `curl -I https://ramen-bones-analytics.pages.dev/login` must include `x-sveltekit-page: true` response header.

- Use `wrangler pages deployment tail --project-name ramen-bones-analytics` as the live observability tool during verification. CF Pages Free does not include a persistent log UI.

- Tests: unit-test the date-clamp in `parseFilters` with `from=1970-01-01` input. Integration-test a new `/api/customer-ltv` endpoint with RLS to confirm tenant scoping.

- **Nyquist validation hint:** the fix touches both the SSR load and client fetch paths. Validation needs to cover (a) `parseFilters` rejecting/clamping pathological dates, (b) each new `/api/*` endpoint returning 200 + correct payload under auth, (c) `+page.server.ts` completing under 50ms CPU (approximated via end-to-end timing at local dev since we can't measure Cloudflare CPU directly).

</specifics>

<deferred>
## Deferred Ideas

- **Paid Cloudflare plan upgrade.** Out of scope per project $0/month constraint. Would raise CPU limit to 30s and subrequests to 1000 — but fixes the symptom not the structural overfetch.
- **Full migration to Cloudflare Workers KV or D1 for hot caches.** Overkill; materialized views are the cache.
- **Server-Sent Events / WebSocket live updates for below-fold cards.** Phase 4 decided daily refresh is enough for v1.
- **Moving Supabase queries to Edge Functions** (proxy through Deno). Would add deploy surface area for marginal benefit.
- **`fetchAll` streaming to avoid buffering whole payload in Worker memory.** Current rows-per-query are small (<10kB); CPU is the binding constraint, not memory.
- **Auto-redeploy on 1102 detection via webhook + GH Actions.** Treats symptom, not cause.

</deferred>

---

*Phase: 11-ssr-perf-recovery*
*Context gathered: 2026-04-21 following root-cause analysis in `.planning/debug/cf-pages-ssr-cpu-1102.md`.*
