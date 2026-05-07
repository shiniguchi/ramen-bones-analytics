# Phase 19: Cold-Start Trim — Context

**Gathered:** 2026-05-07
**Status:** Ready for planning (4 sub-plans pre-written — see `19-01-PLAN.md`..`19-04-PLAN.md`)
**Source:** Direct conversation 2026-05-07 (deep-research → top-2 proposal → /refine-plan-100pct), per "skip redundant questions after discuss-phase" memory. All decisions locked inline.

<domain>
## Phase Boundary

**This phase delivers:** A measurable cold-start drop on the mobile dashboard. Initial JS payload < 200 KB gzipped. LCP < 2.5 s on throttled "Slow 4G" at 375×667. SSR fan-out 6 → 4 queries (`Promise.all` count). No KPI math change, no schema change, no migration, no RLS surface change.

**This phase does NOT deliver:**
- Filter-cascade speedup. The ~2 s blocking on chip-click traced in `.planning/phases/16.2-friend-persona-qa-gap-closure/16.2-01-trace.md` is **explicitly preserved as the baseline** so the before/after metric is interpretable. Plan 2 territory (separate future phase).
- Server-side pre-aggregation of `transactions_filterable_v` into a per-(date × dimension) summary. Future phase.
- `dashboardStore.filterRows` memoization. Future phase.
- Vite `manualChunks` tuning. Auto-splitting from dynamic imports is sufficient — manual chunking is gold-plating.
- New chart cards, new charts, new locales.
- Bundle reordering on `CampaignUpliftCard` (currently slot 1 → fires `LazyMount.onvisible` immediately). UX call, owner decides separately.

**User-facing read:** Dashboard opens noticeably faster on the friend's phone. No visible chart-functionality regression; same numbers, same colors, same interactions.

</domain>

<decisions>
## Implementation Decisions (LOCKED)

### Pillars (audited per step in each PLAN)
- **Minimal** — extend the existing `LazyMount` (single mandated lazy idiom, `LazyMount.svelte:8-12`); do not add a second lazy primitive. No `manualChunks` config. No new abstractions.
- **Scalable** — adding locale #6 = 1 file, 0 KB cold-bundle cost. Adding chart card #11 = 1 `LazyMount` wrap, 0 KB cold-bundle cost.
- **Dynamic** — locale resolved from `event.cookies.get(LOCALE_COOKIE)` in `src/hooks.server.ts:14-15`. No hardcode. Chunk boundaries derive from the import graph, not config.
- **Universal** — reuse `clientFetch` (`src/lib/clientFetch.ts:13`), `safeGetSession` (`src/hooks.server.ts:34-42`), `fetchAll` (`src/lib/supabasePagination.ts`), `t(loc, key)` API. New `/api/item-counts` and `/api/benchmark` clone `/api/kpi-daily` byte-for-byte structure (`src/routes/api/kpi-daily/+server.ts:23-42`).

### Sub-plan boundaries
- **19-01** — `LazyMount` `loader` prop + 5-card defer in `+page.svelte`
- **19-02** — `/api/item-counts` + `/api/benchmark` deferred endpoints; SSR `Promise.all` 6 → 4
- **19-03** — i18n per-locale dynamic imports (5 dict files + `loadDict()` + hook seeding)
- **19-04** — Phase-final QA on localhost + DEV; planning-docs drift gate; ship

Sub-plans are sequential. **19-02** can run in parallel with 19-01 *after* 19-01 ships, since `/api/item-counts` is consumed only by the cards lazy-converted in 19-01. **19-03** is independent of 19-01/02.

### Dataset audit (every Supabase view consumed by the dashboard)

| View | Today | After phase | Reason |
|---|---|---|---|
| `data_freshness_v` | SSR (eager) | **Keep SSR** | 1 row, drives FreshnessLabel above-fold |
| `transactions_filterable_v` (earliest 1-row) | SSR | **Keep SSR** | Drives `chipToRange('all', allStart=…)`; blocks paint |
| `transactions_filterable_v` (current window) | SSR | **Keep SSR** | KPI tiles mount eagerly (the headline number) |
| `transactions_filterable_v` (prior window) | SSR | **Keep SSR** | KPI tiles' delta computation |
| `insights_v` (latest 1-row) | SSR | **Keep SSR** | InsightCard is the topmost above-fold card |
| `memberships` (role) | SSR | **Keep SSR** | Admin gate, < 5 ms PK lookup |
| `item_counts_daily_v` | SSR | **→ `/api/item-counts`** (Plan 19-02) | Both consumers (`CalendarItemsCard` / `CalendarItemRevenueCard`) become lazy in Plan 19-01 |
| `benchmark_curve_v` | SSR | **→ `/api/benchmark`** (Plan 19-02) | Sole consumer (`CohortRetentionCard`) is already lazy at `+page.svelte:325` |
| `benchmark_sources_v` | SSR | **→ `/api/benchmark`** (Plan 19-02) | Same as above; bundled into the same endpoint |
| `kpi_daily_v` | `/api/kpi-daily` | unchanged | Phase 11-02 |
| `customer_ltv_v` | `/api/customer-ltv` | unchanged | Phase 11-02 |
| `retention_curve_v` + `retention_curve_monthly_v` | `/api/retention` | unchanged | Phase 11-02 |
| `transactions_filterable_v` (lifetime card-hash) | `/api/repeater-lifetime` | unchanged | Phase 11-02 |
| `forecast_with_actual_v` (+ holidays/school/transit/recurring/pipeline) | `/api/forecast` | unchanged | Triggered by `createForecastOverlay` in CalendarRevenue/Counts (now lazy) |
| `forecast_quality` | `/api/forecast-quality` | unchanged | — |
| `campaign_uplift_v` | `/api/campaign-uplift` | unchanged | CampaignUpliftCard self-fetch |

**Net SSR fan-out:** 9 queries today → 6 queries after phase. `Promise.all` collapses 6 → 4 (+ 2 pre-await). Aligns with Phase 11-02 trajectory (11 → 6 → 4).

### Mobile-first constraints
- Localhost-first verification (`http://localhost:5173`) per `.claude/CLAUDE.md` — non-negotiable. Stop hook `.claude/hooks/localhost-qa-gate.js` blocks turn-end on frontend edits without a Playwright MCP navigate.
- Coverage panel measurement at viewport 375×667 throttled "Slow 4G" — recorded in `19-04-PLAN.md` as the canonical pass/fail.
- `feedback_chrome_mcp_on_request.md` — Chrome MCP only on owner request, do not spin proactively.
- `feedback_layerchart_mobile_scroll.md` — `touchEvents: 'auto'` invariant (already in eager cards; no regression risk).
- `feedback_svelte5_tooltip_snippet.md` — `Tooltip.Root` snippet-children form invariant.
- `feedback_sveltekit_replacestate_invalidate_gotcha.md` — locale-switch uses `goto({invalidateAll:true})`, not `replaceState`.

### Branch + workflow alignment
- Branch: `feature/phase-19-cold-start-trim` (Stop hook recognises `feature/phase-*`)
- No DB migration → `migrations.yml` does not run → `feedback_migrations_workflow_dispatch.md` does not apply
- Drift gate: tick `[x]` in `.planning/ROADMAP.md`, bump `progress.completed_phases` + `progress.completed_plans` + `last_updated` in `.planning/STATE.md` before `/gsd-ship`. Validator: `.claude/scripts/validate-planning-docs.sh`.

### Claude's Discretion
- Skeleton placeholder copy inside `LazyMount` while loader resolves — keep the existing `animate-pulse bg-neutral-100` (LazyMount.svelte:67); no new design.
- Per-locale dict file location — `src/lib/i18n/dict/{en,de,ja,es,fr}.ts` (one file each). The folder is new; `messages.ts` retains the type contract.
- Window-scoping for `/api/item-counts` — pass `?from=&to=` from the live store window (matches the Phase 10 D-21 < 500 KB payload comment at `+page.server.ts:147`).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The lazy primitive (extend, don't replace)

- `src/lib/components/LazyMount.svelte` — single mandated lazy-load idiom. The "exactly one lazy idiom" rule at lines 8-12 is load-bearing.

### The deferred-API precedent (clone, don't reinvent)

- `src/routes/api/kpi-daily/+server.ts:23-42` — canonical shape for new `/api/item-counts` and `/api/benchmark`
- `src/routes/api/retention/+server.ts` — precedent for two-array payloads (`{ weekly, monthly }` shape mirrors planned `{ anchors, sources }`)
- `src/lib/clientFetch.ts:13` — module-scoped `Map` cache; the `loadDict()` cache mirrors this pattern

### SSR fan-out — what we are pruning

- `src/routes/+page.server.ts:1-308` — current 9-query SSR. Lines 144-191 are the targets for 19-02. Lines 232-258 (`Promise.all` + `[ssr-perf]` log) update for the 6 → 4 reduction.
- `.planning/debug/resolved/cf-pages-ssr-cpu-1102.md` — the original CF Pages CPU 1102 lesson; this phase continues that trajectory.

### Eager surface — what we are deferring

- `src/routes/+page.svelte:14-19` — 5 static chart imports (CalendarRevenue, CalendarCounts, CalendarItems, CalendarItemRevenue, MdeCurveCard) → 0 after 19-01
- `src/routes/+page.svelte:309-349` — 5 eager mount sites; replace with `<LazyMount loader=…>` per 19-01
- `src/lib/components/CalendarRevenueCard.svelte:8`, `CalendarCountsCard.svelte:8`, `CalendarItemsCard.svelte:9`, `CalendarItemRevenueCard.svelte:6`, `MdeCurveCard.svelte:14` — LayerChart static imports (transitive 22 d3-* + dagre + layerstack + memoize + runed)
- `src/lib/components/CalendarRevenueCard.svelte:24`, `CalendarCountsCard.svelte:24` — `createForecastOverlay` import (eager `/api/forecast` fetch on mount)

### i18n — what we are splitting

- `src/lib/i18n/messages.ts` (76 KB, 1358 LOC) — current shape: 5 `const` blocks (en/de/ja/es/fr) compiled into one `messages: Record<Locale, …>` at line 1330. Type `MessageKey = keyof typeof en` at line 285 stays exported.
- `src/lib/i18n/locales.ts` — locale registry; `LOCALE_COOKIE`, `DEFAULT_LOCALE`, `isLocale()` exports already used by `hooks.server.ts:14`
- 19 components import `t` from `$lib/i18n/messages` — call sites must NOT change (universal pillar)

### Auth + JWT (do not regress)

- `src/hooks.server.ts:34-42` — `safeGetSession()` calling `getClaims()`, scanned by CI guard #2
- `src/routes/+layout.server.ts:9-29` — root auth guard; PUBLIC_PATHS branch must keep returning the dict

### Performance baselines (the before metric)

- `.planning/phases/16.2-friend-persona-qa-gap-closure/16.2-01-trace.md` — single filter-change cascade baseline ~2168 ms blocking. **Preserved by this phase, not improved.**
- `.planning/phases/11-ssr-perf-recovery/11-02-SUMMARY.md` — pattern for moving SSR queries to `/api/*` + `LazyMount` + `clientFetch`
- `wrangler.toml:1-4` — Cloudflare Pages compatibility flags; CF Pages Free 50-subrequest / 50 ms-CPU per-request budget (already comfortable post-Phase 11; this phase improves further)

### Project conventions (no regression)

- `CLAUDE.md` (root + .claude/) — workflow rules, localhost-first frontend verification, no `Co-authored-by Claude` commits
- `.claude/memory/feedback_chrome_mcp_on_request.md` — gate hook OFF; verify only when user asks
- `.claude/memory/feedback_layerchart_mobile_scroll.md` — `touchEvents: 'auto'`
- `.claude/memory/feedback_svelte5_tooltip_snippet.md` — `Tooltip.Root` snippet-children form
- `.claude/memory/feedback_sveltekit_replacestate_invalidate_gotcha.md` — `goto({invalidateAll:true})` for cache-miss + locale switch

</canonical_refs>

<specifics>
## Specific Ideas

### Concrete numbers (the "before")

- LayerChart `node_modules` is 4.9 MB (22 transitive d3-* + dagre + layerstack-*)
- `messages.ts` is 76 KB / 1358 LOC; 5 locales × ~270 keys
- 6,896 lifetime transactions on the friend's tenant (per `src/lib/supabasePagination.ts:5`)
- Phase 16.2-01 trace: 4361 ms first-cascade, 2168 ms blocking after dual-cascade fix
- 19 components import `t` from `$lib/i18n/messages`
- 5 chart cards eager-mount above the fold (the whole problem)
- `+page.svelte:309-349` is the entire eager surface

### Sub-component reach (loaded statically when an eager card mounts)

- `CalendarCountsCard` + `CalendarRevenueCard` each pull: `Chart`, `Svg`, `Axis`, `Bars`, `Spline`, `Text`, `Tooltip` from layerchart; `scaleTime`/`scaleBand` from d3-scale; `timeDay`/`timeMonday`/`timeMonth` from d3-time; `ForecastOverlay`, `ForecastLegend`, `ForecastTooltipRows`, `ModelAvailabilityDisclosure`, `EventBadgeStrip`, `VisitSeqLegend` (sibling components, all carrying their own LayerChart imports)
- `CalendarItemsCard` pulls `LineChart` from layerchart + `EventBadgeStrip`
- `CalendarItemRevenueCard` pulls `Chart`, `Svg`, `Axis`, `Bars`, `Spline`, `Text`, `Tooltip` + `parseISO` + `clientFetch`
- `MdeCurveCard` pulls `Chart`, `Svg`, `Axis`, `Spline`, `Tooltip` + `scaleLinear` + `mde` math module + `EmptyState`
- `CampaignUpliftCard` (lazy but slot-1, fires immediately) pulls `Chart`, `Svg`, `Tooltip`, `Axis`, `Rule` + `scaleBand` — out of scope for this phase but flagged for the slot-reorder UX call

All of the above lands in **one** chart-card chunk per file under SvelteKit + Vite auto-splitting once the static import becomes a dynamic import.

### Risk register (3 items, mirrored in 19-04 QA)

1. **`<svelte:component>` SSR/hydration mismatch.** SSR returns LazyMount's skeleton placeholder (`LazyMount.svelte:67`); client hydrates the skeleton; IO fires post-hydration → loader resolves → `<svelte:component>` mounts. Standard Svelte 5 idiom. Mitigation: 19-01 includes a one-line vitest ensuring `loader` + `children` are mutually exclusive at the prop level (TS narrowing).
2. **CF Pages SSR-CPU regression** (per `.planning/debug/resolved/cf-pages-ssr-cpu-1102.md`). `loadDict()` adds one `await import()` per SSR request. Mitigation: module-level `Map<Locale, Dict>` cache (Plan 19-03) — first hit per Worker isolate ≈ 5-10 ms; subsequent hits ≈ 0 ms. Same pattern as `clientFetch.ts:13`.
3. **Locale-switch race.** Dynamic-import a 15 KB dict over slow 4G can take 200-400 ms. Mitigation: `await loadDict(newLocale)` *before* writing the cookie + `goto()`, so the switcher is held in `isUpdating = true` until the dict is in cache. Existing `withUpdate()` wrapper at `+page.svelte:126-133` is the universal idiom.

### Definition of Done (whole phase)

- [ ] Cold-load initial JS < 200 KB gzipped (Coverage panel, viewport 375×667)
- [ ] LCP < 2.5 s on cold load, throttled "Slow 4G"
- [ ] SSR `Promise.all` count = 4 (verified via dev-only `[ssr-perf]` log at `+page.server.ts:255-256`)
- [ ] All 5 locales render every component without console errors
- [ ] Locale switch < 200 ms perceived on warm cache
- [ ] Filter-cascade wall-clock unchanged within ±200 ms of pre-phase baseline (Phase 16.2 = 2168 ms)
- [ ] Vitest + Playwright suites green
- [ ] `validate-planning-docs.sh` exits 0
- [ ] DEV `/api/item-counts` and `/api/benchmark` return 200 with auth cookie

### Effort

**Medium — 12-14 working hours.** Per-plan breakdown in each PLAN.md.

</specifics>

<deferred>
## Deferred Ideas

- **Replace raw-row pattern with pre-aggregated `tx_summary_daily_v`.** Plan 2 from `/deepsearch-propose-top2` 2026-05-07. Filter-cascade drops from ~2 s to <100 ms but requires a new migration + view + RLS verification + 6 chart-card data-shape changes. Slated as a future phase.
- **`dashboardStore.filterRows` memoization.** WeakMap-keyed by (filter signature, row identity). Smaller win than pre-aggregation but cheaper. Future phase candidate.
- **Vite `manualChunks` config.** Auto-splitting from dynamic imports is sufficient for this phase. Revisit only if Coverage panel after 19-04 shows layerchart still in the entry chunk.
- **`CampaignUpliftCard` slot reordering.** Currently slot 1 → `LazyMount.onvisible` fires on cold load. UX decision: move below the KPI tiles or reduce its `rootMargin` to 0. Owner-facing call.
- **Worker-thread offload of `filterRows` + bucketing.** Comlink + Web Worker. Removes blocking but adds complexity. Future phase if pre-aggregation is rejected.
- **Pre-emptive `<link rel="modulepreload">` for next-likely lazy chunk.** Bandwidth-trade for perceived latency. Skip until profiling shows measurable wins.
- **SSR streaming.** SvelteKit supports it; Cloudflare Pages adapter passes it through. Worthwhile only if KPI tiles' SSR query becomes a bottleneck after this phase.

</deferred>

---

*Phase: 19-cold-start-trim*
*Context gathered: 2026-05-07 via direct conversation (no /gsd-discuss-phase); decisions confirmed inline via /deepsearch-propose-top2 → /refine-plan-100pct*
*Owner-facing problem statement: "the current app is very slow … cold is not very optimized … modules threads too heavy … users expect quite a light experience" (2026-05-07)*
