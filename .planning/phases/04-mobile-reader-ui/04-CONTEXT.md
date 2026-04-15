# Phase 4: Mobile Reader UI - Context

**Gathered:** 2026-04-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver the first SvelteKit code in this repo: a mobile-first reader dashboard that authenticates via `@supabase/ssr`, reads only Phase 3 wrapper views, and renders revenue KPIs, cohort retention, LTV, frequency, and new-vs-returning at a 375px viewport on Cloudflare Pages.

**In scope:**
1. Bootstrap the SvelteKit 2 + Svelte 5 + `adapter-cloudflare` app by copying `docs/reference/*.example` into `src/` (hooks, login, layout.server) and wiring `PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
2. Single `/` dashboard route (login-gated) rendering all analytics cards as a single-column card stream at 375px.
3. A `data_freshness_v` plain view (tiny Phase 4 migration) exposing `MAX(ingested_at)` per tenant — needed for the "Last updated Xh ago" signal.
4. SSR data loading via `+page.server.ts` that fans out parallel wrapper-view queries through `@supabase/ssr`.
5. LayerChart integration for the cohort retention curve (the only chart in v1; KPI cards are number-only, frequency and new-vs-returning are tables/bars — see decisions).
6. CF Pages deploy pipeline (Git integration) and a 375px verification step enforced on every PR.

**Explicitly out of scope:**
- Nightly Claude Haiku insight card (Phase 5 INS-01..INS-06).
- Signup / tenant self-serve onboarding (Phase 5 forkability).
- Custom password reset route (Phase 1 D-11: Supabase default email only).
- Tenant switcher / multi-membership UI (Phase 1 D-05: one membership per user in v1).
- Custom date-range picker (UI-09: preset chips only).
- Alerting / banner on stale data (Phase 5 — v1 shows a freshness label, no push).
- Desktop layout beyond "single-column works on wider viewports too".
- Materializing any leaf views for perf (Phase 3 D-16: revisit only if Phase 4 hits walls).
- Dashboard UI to surface pg_cron refresh status (Phase 5 deferred per 03-CONTEXT.md).

</domain>

<decisions>
## Implementation Decisions

### Layout & Navigation
- **D-01:** **Single scrolling page at `/`.** All cards stack top-to-bottom on one route. No tabs, no multi-route pages. Login redirects here after auth; logout icon (`⎋`) in the header top-right. Rationale: matches UI-02 "single-column card stream", zero nav state to manage, fastest to ship.
- **D-02:** **Card order:** Revenue KPIs → Cohort retention → LTV-to-date → Visit frequency → New vs returning. Money first (daily check), then acquisition (cohort is the unique banking-playbook card), then retention story. Mirrors the founder's mental model: how much, who's coming back, how valuable.
- **D-03:** **Header shape:** compact header with "Ramen Bones" (or restaurant name from `restaurants.name`) on the left and a logout glyph on the right. Header scrolls away with content — the chip bar is the only sticky element.

### Date-Range Chips
- **D-04:** **Chips scope to revenue cards only.** Preset chips (`Today` / `7d` / `30d` / `90d` / `All`) filter the `tx_count` and `avg_ticket` cards (and any future chip-scoped revenue card) ONLY. Cohort retention, LTV, frequency, and new-vs-returning are chip-independent and operate on full history. Rationale: Phase 3's `cohort_mv` is not date-filtered, and retention/LTV are inherently multi-cohort/time — chipping them would break the analytical contract. The cohort card owns its own grain selector (see D-11).
- **D-05:** **Default chip: `7d`. Chips sticky at top of viewport.** 7d is the friend's "weekly health check" window. Sticky keeps the filter context visible while scrolling the long single page. Chip selection persists across reloads via `?range=7d` query param (not localStorage — SSR-friendly and shareable).

### KPI Strip
- **D-06:** **Top of page: three fixed revenue tiles** — `Revenue · Today`, `Revenue · 7d`, `Revenue · 30d`. These tiles **ignore the chip** and always render those three fixed windows. Matches UI-04 literally.
- **D-07:** **Below the fixed tiles:** two chip-scoped cards — `Tx count` and `Avg ticket`. These follow the selected chip window.
- **D-08:** **Revenue card shape: big number + delta vs prior period.** Example: `€ 4,280` with `▲ +12% vs prior 7d` underneath. No sparkline, no embedded chart. Delta computed server-side in `+page.server.ts` from two `kpi_daily_v` windows (current vs prior). Banking-dashboard feel, fastest to scan, zero chart overhead on KPI cards. Delta color: green for positive, red for negative, neutral gray when prior-period has zero rows.
- **D-09:** All revenue figures formatted as integer EUR with thousands separator (`€ 4,280`, not `€4,280.00`). Avg ticket is the only KPI with decimals (`€ 18.40`). Cents-to-euros division happens in the page server — never in SQL (Phase 2 currency decision).

### Freshness Signal
- **D-10:** **"Last updated Xh ago" derived from `MAX(ingested_at)` via a new `data_freshness_v` wrapper view.** Phase 4 ships a tiny migration (suggested `0014_data_freshness_v.sql`) that creates a plain view over `transactions` exposing `MAX(ingested_at) AS last_ingested_at` filtered by JWT tenant claim. Rationale: tells the owner "the last data point I have is X hours old" — the question they actually care about. `cron.job_run_details` was rejected (says refresh ran, not whether fresh data arrived — wrong signal on "refresh ran but CSV wasn't updated" days). `MAX(business_date)` was rejected (conflates "closed Monday" with "data stale").
- **D-10a:** The freshness label lives as muted text under the sticky chip bar — always visible, no per-card repetition. Simple threshold coloring: default muted, yellow when `>30h`, red when `>48h`. Thresholds live as UI constants, not SQL.

### Cohort Retention Card
- **D-11:** **LayerChart overlaid line curves.** One line per cohort, x-axis = periods since first visit (weeks by default), y-axis = retention %. NULL from Phase 3 D-08 renders as natural gaps — no UI filtering logic. **Last 4 cohorts rendered by default** (weekly grain → last 4 weeks' cohorts; daily → last 4 days; monthly → last 4 months). Respects ROADMAP Success Criterion 3 "≤4 series". Colors from a small 4-color palette picked for 375px legibility.
- **D-12:** **Grain selector is a segmented toggle inside the cohort card header** — `[Day | Week | Month]`. Default: **Week** (Phase 3 D-04). This is a card-local control and does NOT touch the global chip bar. LTV and frequency cards do NOT get a grain selector in v1 (weekly-only; revisit in Phase 5 if friend asks).
- **D-13:** **No horizon marker line.** Phase 3 D-08 NULL-masking creates natural visual gaps; LayerChart draws them automatically. A dashed vertical marker was rejected as chart-noise that non-banking readers could misread as an error.
- **D-14:** **Sparse-cohort filter: hide cohorts where `cohort_size < 5` from the chart.** Threshold is a UI constant (`SPARSE_MIN_COHORT_SIZE = 5`), not SQL — Phase 3 D-05 keeps the data layer honest and exposes `cohort_size` on every row. Sparse cohorts are dropped from the line set (not grayed out) to keep 4 lines readable. If all visible cohorts are sparse, fall back to showing the sparse cohorts anyway rather than an empty chart (but render an "insufficient cohort size" hint).
- **D-15:** **Touch tooltips:** tap any point on a line to reveal a tooltip with `cohort_start`, `period`, `retention_rate`, `cohort_size`. LayerChart touch event handlers; no hover state (mobile-first).

### LTV Card
- **D-16:** **LTV card shape: simple bar chart** — one bar per cohort, bar height = `ltv_cents / 100` (euros). Same last-4-cohorts filter as D-11. Reads `ltv_v` and uses the same grain as the cohort card (card-local state shared between cohort + LTV, or re-derived from URL). LayerChart bars, not a second line chart — distinct shape keeps the reader's eye on a different metric.
- **D-17:** **LTV data-depth caveat (UI-07) lives as a persistent italic footer inside the LTV card.** Copy template: `"Based on {N} months of history — long-term LTV not yet observable."` where `N` is computed in `+page.server.ts` from `DATE_PART('month', now() - MIN(first_visit_business_date))` on the cohort wrapper view. Always visible, no modal, no info icon to miss.

### Frequency & New-vs-Returning Cards
- **D-18:** **Frequency card: horizontal bar list** — one row per bucket (`1`, `2`, `3–5`, `6–10`, `11+` per Phase 3 D-12), bar width proportional to `customer_count`, numeric `customer_count` on the right. Not a LayerChart chart — plain divs with Tailwind width percentages. Simpler, no chart overhead for a card with exactly 5 rows.
- **D-19:** **New-vs-returning card: stacked horizontal bar for the current chip window** showing three segments — `new` / `returning` / `cash_anonymous` (Phase 3 D-14). Legend below with revenue tie-out values. This is the one card where the chip window matters (because new-vs-returning is daily and aggregating over the chip range is natural). Confirms Phase 3 D-14 revenue tie-out: `new + returning + cash_anonymous === kpi_daily_v.revenue` across the range.
- **D-19a:** **D-04 amendment:** The new-vs-returning card is the ONE exception to "chips affect revenue only." Chip window defines the aggregation range for this card. All other retention/cohort/LTV/frequency cards remain chip-independent. This nuance is load-bearing — gsd-planner must preserve it.

### Empty & Loading States
- **D-20:** **Per-card empty messages with a "why" explainer.** Each card renders its own empty state when its wrapper view returns 0 rows (or all NULLs). Copy lives in a small `emptyStates.ts` lookup:
  - Revenue tiles: `"No transactions in this window."`
  - Cohort: `"No cohort data yet — needs at least one non-cash transaction."`
  - LTV: `"LTV needs at least one cohort with ≥2 visits."`
  - Frequency: `"No repeat-visit data yet."`
  - New vs returning: `"No transactions in this window."`
  Cards stay in layout at empty-state size (no layout shift as data arrives). A single shared `EmptyState.svelte` component renders the message.
- **D-21:** **First paint: SSR with all data loaded.** `+page.server.ts` calls `Promise.all([kpi_daily_v, cohort_mv wrapper, retention_curve_v, ltv_v, frequency_v, new_vs_returning_v, data_freshness_v])` via `@supabase/ssr`, shapes the response, returns it to the page. No client-side loading state, no skeleton, no streamed promises in v1. Lean on SvelteKit SSR + CF edge for TTFB. Daily-refresh app — slightly slower TTFB is acceptable.
- **D-22:** **Error handling in the loader:** if any single wrapper view errors (e.g. RLS denial, network), that card renders its empty state with a neutral message (`"Couldn't load — try refreshing."`). Other cards still render. No toast, no global error banner in v1. Log the error server-side for debugging.

### Claude's Discretion (setup-level — not discussed in depth)
- **Chart library:** LayerChart 2.x as recommended by CLAUDE.md (Svelte 5 native, MEDIUM confidence). gsd-planner may swap if a blocker surfaces, but must stay within CLAUDE.md's approved stack. `svelte-chartjs` is explicitly forbidden per CLAUDE.md "What NOT to Use".
- **UI primitives:** shadcn-svelte@next for `Card`, `Button`, `Sheet`/segmented control, as recommended by CLAUDE.md. Tailwind v4 with the Vite plugin (not PostCSS). Copy-paste primitives, not a package dependency — forkable per project constraints.
- **Auth flow:** copy `docs/reference/*.example` files verbatim to `src/` (per `docs/reference/README.md`) and drop the `.example` suffix. Email+password only (Phase 1 D-12). Login at `/login` → redirect to `/`. Logout = simple form POST to a `+page.server.ts` action that calls `supabase.auth.signOut()` then redirects.
- **Deploy pipeline:** CF Pages with Git integration (push to main → auto-deploy). `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_PUBLISHABLE_KEY` set in CF Pages project settings. `wrangler pages dev` for local preview. No custom Wrangler workflow in Phase 4.
- **375px verification (UI-11):** a PR-time checklist item — reviewer opens the preview deploy at 375px (e.g., via Chrome DevTools device mode) and screenshots. Optionally a `scripts/verify-viewport.mjs` Playwright screenshot as a stretch goal — gsd-planner picks.
- **Color palette + typography:** sensible defaults (Tailwind's zinc/neutral for chrome, a small palette for chart lines). No explicit brand system in v1. If the friend has strong feelings after first use, iterate in Phase 5.
- **Route structure:** `/` (dashboard), `/login`. No other routes in v1. Logout is an action on `/`, not a separate route.
- **Env var loading:** SvelteKit `$env/static/public` for the publishable key + URL. No secret keys in the frontend (service role never leaves Supabase).
- **Loading Promise.all shape:** whether to parallelize across Supabase calls or batch via an RPC. gsd-planner picks after measuring; `Promise.all` over `.from()` calls is the default.
- **Query parameter scheme:** `?range=7d&grain=week` — single source of truth for filter state, SSR-readable, shareable. gsd-planner confirms.

### Folded Todos
None — no pending todos matched this phase via `todo match-phase 4`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project
- `CLAUDE.md` — tech stack (§Recommended Stack), "What NOT to Use" list, Supporting Libraries (LayerChart, shadcn-svelte@next, Tailwind v4, date-fns), critical gotchas (§1 RLS + MV, §3 `@supabase/ssr` session trust, §4 Workers runtime ≠ Node).
- `.planning/PROJECT.md` — vision, mobile-first non-negotiable, 2-week MVP constraint, data-depth note (3–12 months → LTV caveat).
- `.planning/REQUIREMENTS.md` §UI-01..UI-11 — the eleven requirements this phase satisfies.
- `.planning/ROADMAP.md` §"Phase 4: Mobile Reader UI" — goal + four success criteria.

### Phase 1 Prior Art (auth, wrapper pattern, reference files)
- `.planning/phases/01-foundation/01-CONTEXT.md` — D-04 (JWT `restaurant_id` claim), D-06/07/08 (wrapper-view + REVOKE + unique-index pattern), D-09 (per-tenant timezone), D-10/11/12 (login flow, no signup, `@supabase/ssr` mandatory, `getSession` forbidden on server), D-14 (CI grep guards — Phase 4 must pass all four).
- `docs/reference/README.md` — Phase 4 copy-paste instructions for bootstrapping `src/` from reference files.
- `docs/reference/hooks.server.ts.example` — canonical `handle` hook with `safeGetSession()` wiring.
- `docs/reference/+layout.server.ts.example` — canonical root layout server load.
- `docs/reference/login/+page.svelte.example` — login form shape.
- `docs/reference/login/+page.server.ts.example` — login action.
- `supabase/migrations/0002_auth_hook.sql` — JWT `restaurant_id` claim injection (Phase 4 reads via `session.user`).
- `supabase/migrations/0004_kpi_daily_mv_template.sql` — canonical MV/wrapper template; Phase 4's `data_freshness_v` follows the wrapper pattern but is a plain view (no MV).

### Phase 3 Prior Art (wrapper views Phase 4 consumes)
- `.planning/phases/03-analytics-sql/03-CONTEXT.md` — D-02 (`cohort_mv` wide shape with day/week/month columns), D-04 (weekly is banking standard → UI default), D-05 (no minimum-cohort-size filter in SQL → UI filters, see D-14 of this phase), D-08 (NULL-masking survivorship → LayerChart natural gaps), D-11 (LTV = avg per acquired customer), D-12 (frequency fixed buckets 1/2/3–5/6–10/11+), D-14 (new_vs_returning has third `cash_anonymous` bucket — revenue tie-out), D-16 (only two MVs; leaves are plain views), D-17/18 (wrapper view tenant filter), D-24 (CI guard blocks raw `*_mv`/`transactions` references from `src/`).
- Phase 3 migration files (to be created by Phase 3 plans 02..05): `0010_cohort_mv.sql`, `0011_kpi_daily_mv_real.sql`, `0012_leaf_views.sql`, `0013_refresh_function_and_cron.sql`. Phase 4 starts plan work only after these exist in `supabase/migrations/`.
- `scripts/ci-guards.sh` — Phase 4 `src/` must pass guard 1 (no `*_mv` references) and guard 2 (no raw `getSession` on server without `safeGetSession`/`getUser`).

### External (downstream researcher to fetch fresh)
- SvelteKit Cloudflare adapter docs — https://svelte.dev/docs/kit/adapter-cloudflare
- Supabase SvelteKit SSR auth guide — https://supabase.com/docs/guides/auth/server-side/sveltekit
- `@supabase/ssr` npm — https://www.npmjs.com/package/@supabase/ssr
- LayerChart docs — https://layerchart.com/docs
- LayerChart 2.0 Svelte 5 native — https://github.com/techniq/layerchart
- shadcn-svelte `@next` Tailwind v4 migration — https://www.shadcn-svelte.com/docs/migration/tailwind-v4
- Tailwind v4 Vite plugin — https://tailwindcss.com/docs/installation/using-vite
- Cloudflare Pages deploy docs — https://developers.cloudflare.com/pages/

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`docs/reference/*.example`** — copy verbatim into `src/` per `docs/reference/README.md` §"How to wire into `src/`". Phase 4 does NOT rewrite these from scratch.
- **Phase 3 wrapper views** (once 03-02 through 03-05 are merged) — `kpi_daily_v`, `cohort_v` (name TBD by Phase 3 planner — may be inlined), `retention_curve_v`, `ltv_v`, `frequency_v`, `new_vs_returning_v`. These are the ONLY database surfaces Phase 4 queries. Raw `*_mv` and `transactions` are CI-blocked from `src/`.
- **Phase 1 `restaurants` table** — Phase 4 reads `restaurants.name` for the header (via a wrapper view or derived from JWT context — gsd-planner decides; do NOT query the raw table).
- **`tests/helpers/supabase.ts` `adminClient()` pattern** — if Phase 4 adds integration tests (wrapper view SSR round-trip), follow the TEST-project pattern from Phase 1/3.

### Established Patterns
- **`@supabase/ssr` server hooks with `safeGetSession` / `getUser`** — never raw `getSession()` on the server (CI guard 2, Phase 1 D-12/14).
- **Per-tenant timezone on the server** — if any date formatting happens in SvelteKit load functions, the tenant timezone (from `restaurants.timezone`) is the source of truth. Client-side date math is forbidden for business-date logic.
- **Migration numbering** — continues at `0014_data_freshness_v.sql` (and onward) for the freshness view. Phase 3 ends at `0013_*`; do not collide.
- **Wrapper view + JWT-claim WHERE + `REVOKE ALL` on raw** — Phase 4's `data_freshness_v` is a plain view, not an MV, but still follows `WHERE restaurant_id::text = (auth.jwt()->>'restaurant_id')` and `GRANT SELECT ... TO authenticated`.
- **Vitest integration tests against TEST Supabase project** — if Phase 4 adds tests, follow Phase 1/3 precedent.

### Integration Points
- **CF Pages project settings** — `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and any build env. Deploy triggered by `git push origin main`.
- **GHA CI** — existing `.github/workflows/{guards,tests,migrations}.yml` from Phase 1 already run on PRs. Phase 4 adds no new workflow; frontend lint/type-check may extend `tests.yml` (gsd-planner decides).
- **`package.json`** — Phase 4 is the first phase to add SvelteKit + frontend deps. Expect substantial additions: `@sveltejs/kit`, `@sveltejs/adapter-cloudflare`, `svelte@5`, `@supabase/ssr`, `@supabase/supabase-js`, `layerchart`, `tailwindcss@next`, `@tailwindcss/vite`, `date-fns`, plus dev deps (`vite`, `typescript`, `@types/node`, `svelte-check`).
- **`src/` layout** — first time this directory exists. Expected shape: `src/app.d.ts`, `src/app.html`, `src/hooks.server.ts`, `src/lib/supabase.ts`, `src/lib/components/`, `src/routes/+layout.svelte`, `src/routes/+layout.server.ts`, `src/routes/+page.svelte`, `src/routes/+page.server.ts`, `src/routes/login/+page.svelte`, `src/routes/login/+page.server.ts`.
- **`svelte.config.js` + `vite.config.ts`** — first-time creation. adapter-cloudflare, Tailwind v4 Vite plugin, TypeScript.
- **Chip state in URL** — `?range=7d&grain=week` readable by `+page.server.ts` via `url.searchParams`. SSR-friendly, shareable, no localStorage.

</code_context>

<specifics>
## Specific Ideas

- **7d default chip** is the "weekly health check" window — the friend opens this on Monday morning and wants to know how last week went. Not banking-standard (banking defaults to MTD/YTD) but correct for a single ramen restaurant where a weekly rhythm is the operational unit.
- **Three fixed revenue tiles + chip-scoped tx/avg-ticket** is a deliberate asymmetry: the fixed tiles are the "vital signs" (always visible regardless of filter); the chip-scoped metrics are the "zoom lens". D-06/07 must be preserved together.
- **LayerChart chosen because NULL-masking from Phase 3 D-08 becomes free natural gaps** — this was a deliberate SQL→chart handoff in Phase 3. Any chart lib swap must preserve this (`svelte-chartjs` doesn't, which is part of why it's forbidden in CLAUDE.md).
- **LTV caveat as a persistent italic footer** (D-17) is chosen over info-icon-on-tap because non-technical restaurant owners don't know to tap info icons. Always-visible copy is the honest default.
- **Sparse filter in UI, not SQL** (D-14) preserves Phase 3 D-05's "SQL is honest; UI is pragmatic" split. `cohort_size` is already exposed per row — UI just drops lines.
- **Freshness signal from `MAX(ingested_at)`** (D-10) is the right semantic — "how old is the last data I have", not "when did the refresh job run". This required a new tiny migration (`0014_data_freshness_v.sql`) — an acceptable Phase 4 addition because it's a plain view, not a change to Phase 3's MVs.
- **The new-vs-returning card is the ONE chip-scoped analytics card** (D-19/D-19a). All other analytics cards are chip-independent. This nuance must survive into planning and implementation — easy to over-simplify into "chips affect revenue only" and break the revenue tie-out test.
- **Segmented day/week/month toggle lives inside the cohort card**, not as a global control. Keeps grain switching local and keyed to the card the user is reading.

</specifics>

<deferred>
## Deferred Ideas

- **Nightly Claude Haiku insight card** — Phase 5 (INS-01..06). Explicitly not in Phase 4 scope even though the dashboard will have a natural slot for it above or below the KPI strip.
- **Skeleton placeholders / streamed promises** — deferred; v1 ships SSR-with-data. Revisit in Phase 5 if TTFB on CF edge is unacceptable on slow phones.
- **LTV and frequency card grain selectors** — v1 is weekly-only on both. Revisit in Phase 5 if the friend asks for day/month comparison.
- **Horizon marker line on cohort chart** — deferred per D-13. Phase 3 already exposes `cohort_age_weeks` so Phase 4 or 5 can draw one later without SQL changes.
- **Signup / self-serve onboarding UI** — Phase 5 forkability (Phase 1 D-10 deferred this).
- **Custom password reset route** — Phase 1 D-11 deferred to Phase 5 or later.
- **Tenant switcher** — when a user joins a second restaurant (Phase 1 D-05 deferred).
- **Alerting / push notifications on stale data** — Phase 5. V1 shows a freshness label, no push.
- **Dashboard UI for pg_cron refresh status** — Phase 3 03-CONTEXT.md deferred to Phase 4; now deferred from Phase 4 to Phase 5.
- **Desktop-optimized layout (sidebar, multi-column)** — explicitly out of scope per PROJECT.md; v1 single-column works on desktop as-is.
- **Custom date-range picker** — UI-09 mandates preset chips only. Deferred indefinitely.
- **Playwright 375px screenshot automation** — may land in Phase 4 as a stretch goal; more likely Phase 5 alongside the ship-readiness pass.
- **Sparkline charts on KPI tiles** — deferred per D-08; number + delta is v1.
- **LayerChart bundle size audit at 375px 3G** — defer until first deploy; revisit only if friend reports slow loads.
- **Empty-state "why" explainer copy localization (DE)** — friend speaks English/German; v1 ships English copy. Localization deferred.
- **Unblocking Phase 1 UAT tests 3/4/5** (second TEST Supabase project) — still deferred. Phase 4 does not change this.

### Reviewed Todos (not folded)
None — no pending todos surfaced by `todo match-phase 4`.

</deferred>

---

*Phase: 04-mobile-reader-ui*
*Context gathered: 2026-04-14*
