# Phase 10: Charts - Context

**Gathered:** 2026-04-17
**Status:** Ready for planning
**Auto-decided:** User directed "follow your recs first for all questions" — every gray area below is Claude's recommended option with rationale logged inline. User may revise before planning.

<domain>
## Phase Boundary

Render 7 chart components on the dashboard at 375px, all fed by `visit_attribution_mv` (Phase 8) and filtered by the 2-toggle + grain + range system (Phase 9). Delivers VA-04..VA-10.

**In scope (the 7 charts):**
1. **VA-04** Calendar revenue — stacked bars by visit-count bucket per day/week/month
2. **VA-05** Calendar customer counts — stacked bars by visit-count bucket per day/week/month
3. **VA-06** Retention curve — weekly/monthly cohort retention (already on dashboard — carry forward, not rebuild)
4. **VA-07** LTV per customer — distribution
5. **VA-08** Calendar order item counts — stacked bars by item name per day/week/month
6. **VA-09** Cohort total revenue — per weekly/monthly acquisition cohort
7. **VA-10** Cohort avg LTV — per weekly/monthly acquisition cohort

**Plus the supporting data-layer work the charts depend on** (new wrapper views / MVs — see D-01).

**Explicitly out of scope:**
- New filter surfaces (Phase 9 locked filters)
- New grain modes (Phase 9 locked day/week/month global)
- Desktop-only visuals
- Alerting / export / drill-down — v1 is pull-only, 375px only
- v1.1 star-schema MVs / legacy charts (superseded, already dropped in Phase 8)
- Retention chart rebuild — only lift GrainToggle-driven data-flow wiring if needed (already filter-bar-global per Phase 9 D-14); otherwise leave behavior intact

</domain>

<decisions>
## Implementation Decisions

### Data Layer Architecture (feeds all 7 charts)
- **D-01:** **Hybrid approach — one fetch-once daily stream for calendar charts, three new wrapper views for cohort-indexed charts + items + per-customer LTV.** The existing fetch-once-and-client-rebucket pattern from Phase 9 (D-05) scales to the 3 calendar charts by extending the existing data stream. Cohort-indexed charts get dedicated MV-backed wrapper views because client-side cohort aggregation would require pulling the full transaction history.

  **Concretely:**
  - Extend `transactions_filterable_v` with two columns: `visit_seq` (from `visit_attribution_mv`) and `card_hash` (for cohort joins client-side if ever needed). Calendar revenue/counts (VA-04, VA-05) use this — no new SSR query.
  - `retention_curve_v` — **reuse existing** for VA-06.
  - **New** `customer_ltv_v` (MV-backed) — one row per customer with `(revenue_cents, visit_count, cohort_week, cohort_month)`. Feeds VA-07 (histogram bins), VA-09 (GROUP BY cohort_week/month → SUM), VA-10 (GROUP BY → AVG). **Three charts from one view.**
  - **New** `item_counts_daily_v` (MV-backed) — joins `stg_orderbird_order_items` with transactions + visit_attribution on `(restaurant_id, source_tx_id)`, aggregates to `(business_date, item_name, sales_type, is_cash, count)` grain. Feeds VA-08 only.

  **Why hybrid not pure-client:** cohort charts (VA-09/VA-10) and LTV histogram (VA-07) aggregate across the full customer history regardless of the active range — pulling every transaction client-side breaks the <200ms VA-12 budget and blows mobile memory on growing tenants. MVs aggregate once per night.

  **Why hybrid not pure-MV:** calendar charts (VA-04/VA-05) must respond to sales_type / cash / grain / range changes instantly (Phase 9 D-05/D-08 pattern — user has already validated this UX). Re-fetching an MV per toggle breaks it.

- **D-02:** **SSR load fan-out grows from 4 to 7 queries.** Parallel `Promise.all`: `transactions_filterable_v` (extended), `retention_curve_v`, `insights_v`, `data_freshness_v`, `customer_ltv_v`, `item_counts_daily_v`, plus prior-window rows for KPI tiles. Per-card error isolation per Phase 4 D-22.

- **D-03:** **Client-side dataset: `DailyRow` gains `visit_seq: number | null` and `card_hash: string | null`.** `dashboardStore.svelte.ts` `filterRows()` stays unchanged (filters are still sales_type/is_cash/range). `aggregateByBucket()` gets a sibling `aggregateByBucketAndVisitSeq()` that returns `Map<bucket, Map<visit_seq_bucket, {revenue_cents, tx_count}>>` for calendar stacking.

### Refresh Orchestration
- **D-04:** **`refresh_analytics_mvs()` gains two new refresh steps**, in this order: `cohort_mv → kpi_daily_mv → visit_attribution_mv → customer_ltv_mv → item_counts_daily_mv`. `customer_ltv_mv` depends on `cohort_mv` + `transactions`; `item_counts_daily_mv` depends on `stg_orderbird_order_items` + `visit_attribution_mv`. All use `REFRESH MATERIALIZED VIEW CONCURRENTLY` with unique indexes per CLAUDE.md.

### Visit-Count Bucket Encoding
- **D-05:** **All 8 buckets kept (1st/2nd/3rd/4x/5x/6x/7x/8x+) — no collapsing.** Roadmap VA-04/VA-05 specifies this granularity explicitly. "Collapse to 5-6 buckets" would compress the "regulars" story the owner is here to see.

- **D-06:** **Sequential color scale, not categorical palette.** 8 shades of a single hue (light blue `#dbeafe` → deep blue `#1e3a8a`), interpolated via `d3-interpolate`. Light = 1st-timer (new), dark = 8x+ (regular). Visual encoding reinforces the loyalty-gradient story; distinct categorical colors would imply "8 unrelated categories".

- **D-07:** **Cash bar = 9th segment, neutral gray `#a1a1aa`.** `visit_seq IS NULL` rows (cash) stack below the 8 card buckets. When `cashFilter === 'card'`, cash segment hides; when `'cash'`, only cash segment renders; when `'all'`, all 9 visible.

- **D-08:** **Legend collapsed into a compact horizontal scale below the chart** — 8-step gradient bar with "1st" label on the left end and "8x+" on the right, plus a small gray swatch for "Cash". No per-segment label — tooltip on tap reveals the breakdown. At 375px, a vertical 9-item legend would dominate the card.

### Chart Order on the Page
- **D-09:** **Linear scroll, no tabs, no accordion.** Restaurant-owner mental model is "scroll through the day's numbers". Phase 4 D-01 locked single-column stream; tabs/accordion adds nav state the user hasn't asked for.

- **D-10:** **Order (top to bottom):**
  1. `DashboardHeader` + `FilterBar` (sticky — existing)
  2. `FreshnessLabel` (existing)
  3. KPI tile: Revenue (existing)
  4. KPI tile: Transactions (existing)
  5. `InsightCard` (existing)
  6. **Calendar revenue** (VA-04) — primary new card
  7. **Calendar counts** (VA-05)
  8. **Calendar items** (VA-08)
  9. `CohortRetentionCard` (VA-06 — existing)
  10. **Cohort total revenue** (VA-09)
  11. **Cohort avg LTV** (VA-10)
  12. **LTV per customer histogram** (VA-07)

  Rationale: calendar group → retention → cohort-value group → distribution. Calendar revenue is highest-signal ("how's business this week"); LTV distribution is retrospective so goes last.

- **D-11:** **Lazy-mount charts below fold via `IntersectionObserver`.** First paint renders up to card 6 (Calendar revenue) eagerly — rest mount on scroll-into-view. Cuts initial LayerChart instantiation cost and matches mobile expectation that "scroll reveals more". Stretch goal for the planner: if measurement shows first-paint is fast enough without this, skip and ship simple.

### LTV per Customer (VA-07) — Shape
- **D-12:** **Histogram of per-customer revenue, binned into 6 buckets.** X-axis = LTV bins (`€0–10`, `€10–25`, `€25–50`, `€50–100`, `€100–250`, `€250+`). Y-axis = customer count. LayerChart `Bars` primitive. Shows distribution shape — "I have a long tail of big spenders" — which is the growth-analyst question this chart answers.

  Why not: (a) "one bar per customer" unreadable for hundreds of rows; (b) "bucketed by visit_seq" would duplicate info already in VA-04/VA-05 calendar charts + VA-09/VA-10 cohort charts.

- **D-13:** **Bins are UI constants, not SQL.** Defined in a new `src/lib/ltvBins.ts` — easy to tune without migration. Consistent with Phase 4 D-14 pattern (sparse threshold is UI constant, data layer stays honest).

### Order Items (VA-08) — Shape
- **D-14:** **Top-8 items + "Other" rollup, client-side selection.** SSR returns full `item_counts_daily_v` rows for the current window; client computes top-8 by total count in-window, rolls the rest into "Other" (9th segment, same neutral gray as the Cash segment in D-07). 8 picked to mirror the 8 visit-count buckets (visual consistency).

- **D-15:** **Categorical 8-color palette for items**, not sequential. Item names are unordered (tonkotsu, miso, shoyu...) — no gradient semantic. Use `d3-scale-chromatic` `schemeTableau10` (pick 8). Different from calendar revenue/counts (D-06 sequential) because the data is different kind.

- **D-16:** **Chart metric = count of order_items, not gross.** `SUM(COUNT)` per (date, item_name) — reads as "bowls sold per day, by type". Gross breakdown would duplicate VA-04. If the owner asks for a revenue-by-item view later, that's a future phase.

### Cohort Grain vs Global Grain
- **D-17:** **Global grain toggle clamps for cohort-semantic charts** (VA-06, VA-09, VA-10). When user picks "day", cohort charts render as weekly and show a small inline hint ("Cohort view: weekly — day not applicable").

  Why not "cohort cards get their own header toggle": Phase 9 D-14 locked GrainToggle as a top-level global control. Per-card toggles reverse that without a strong reason. Clamping is a smaller UX mutation (one hint line vs. new toggle surface).

### Empty / Sparse States
- **D-18:** **Per-chart empty state copy in `src/lib/emptyStates.ts` (extend existing file).** Claude's discretion on copy, but must follow Phase 4 D-20 "why" pattern. Suggested:
  - `calendar-revenue`: "No transactions in this window."
  - `calendar-counts`: same
  - `calendar-items`: "No order items tracked yet."
  - `cohort-revenue`: "Not enough cohort history yet."
  - `cohort-avg-ltv`: same
  - `ltv-histogram`: "LTV histogram needs at least one non-cash customer with ≥1 transaction."
  - `retention` already covered.

- **D-19:** **Sparse filter for cohort charts VA-09/VA-10 reuses `pickVisibleCohorts()` from `src/lib/sparseFilter.ts`.** Same threshold (cohort_size < 5) drops sparse cohorts, same fallback when all are sparse (show with hint).

### Touch / Tooltip
- **D-20:** **Tap-to-reveal tooltips per Phase 4 D-15.** Tooltip format for calendar charts: `{business_date_label} · {visit_seq_label}: €{revenue} ({tx_count} tx)` — stacked bar segment tapping reveals that segment's numbers. Overall total appears in the bar's "base" tooltip when tapping background.

### Performance Budget
- **D-21:** **Initial SSR payload budget: ≤500kB compressed** for 90d range. Main contributor is `customer_ltv_v` — ~2000 customers × 4 int cols = ~40kB even uncompressed. `item_counts_daily_v` at 90d × 8 items × 2 filters × 2 cash-states ~6000 rows, maybe 300kB. Both acceptable. Planner verifies with a measurement task.

- **D-22:** **`MAX_CALENDAR_BARS = 90` soft cap.** If user picks 365d + daily grain, calendar bars become hairlines. Planner decides handling — either clamp grain to weekly when range >90d, or just let bars be thin and trust the user. Lean clamp.

### Claude's Discretion
- Exact LayerChart primitive choice for stacked bars (`BarStack` vs manual `Rect` composition) — planner picks based on layerchart 2.x API.
- Individual chart component file names and test structure.
- Whether to introduce a shared `CalendarChart.svelte` abstraction used by VA-04/VA-05/VA-08 (all share calendar-x + stacked-bar + 9-color segments) or three sibling components. Planner's call — abstraction is DRY but refactor pressure later is easy.
- Color hex values for the sequential scale (D-06) and categorical palette (D-15) — finalize in implementation by testing at 375px.
- Unit-of-measure label on y-axes (€ for revenue; raw number for counts) — follow Phase 4 KpiTile precedent.
- MV refresh cost measurement — if `customer_ltv_mv` refresh takes >30s in prod, planner may swap to a regular view backed by cohort_mv.

### Folded Todos
None — `todo match-phase 10` returned zero matches.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project
- `CLAUDE.md` — Tech stack, "What NOT to Use" list, RLS + MV gotcha, `REFRESH CONCURRENTLY` requirement, LayerChart / shadcn-svelte@next / Tailwind v4 / date-fns selections.
- `.planning/PROJECT.md` — v1.2 milestone goal, mobile-first non-negotiable.
- `.planning/REQUIREMENTS.md` §VA-04..VA-10 — the 7 requirements this phase satisfies.
- `.planning/ROADMAP.md` §"Phase 10: Charts" — goal + 7 success criteria.

### Direct Predecessor Phases (locked decisions the planner must preserve)
- `.planning/phases/04-mobile-reader-ui/04-CONTEXT.md` — D-11..D-15 (LayerChart patterns, touch tooltips, sparse filter), D-20/21/22 (empty/loading/error), D-13 (no horizon marker).
- `.planning/phases/08-visit-attribution-data-model/08-CONTEXT.md` — D-01..D-06 (visit_attribution_mv shape; is_cash derivation; `visit_seq` computation).
- `.planning/phases/09-filter-simplification-performance/09-CONTEXT.md` — D-05..D-08 (fetch-once client-rebucket), D-14 (GrainToggle is global filter-bar control).

### Data Layer (SQL assets to copy / extend)
- `supabase/migrations/0010_cohort_mv.sql` — canonical MV+wrapper+REVOKE+unique-index template.
- `supabase/migrations/0013_refresh_function_and_cron.sql` — `refresh_analytics_mvs()` to extend with `customer_ltv_mv` + `item_counts_daily_mv`.
- `supabase/migrations/0020_visit_attribution_mv.sql` — visit_seq source-of-truth; pattern for new MVs.
- `supabase/migrations/0022_transactions_filterable_v_is_cash.sql` — **view to extend with `visit_seq` + `card_hash` columns**.
- `supabase/migrations/0012_leaf_views.sql` — leaf view patterns (though most are now dropped via 0021).
- `supabase/migrations/0007_stg_orderbird_order_items.sql` — staging table joined for item_name aggregation.

### Frontend (SvelteKit assets to extend / reuse)
- `src/lib/components/CohortRetentionCard.svelte` — LayerChart Spline + sparse filter + tooltip pattern; calendar and cohort charts copy its shape.
- `src/lib/components/KpiTile.svelte` — tile pattern (unchanged).
- `src/lib/components/FilterBar.svelte` — global filter surface (unchanged — Phase 9).
- `src/lib/components/EmptyState.svelte` — per-card empty renderer (extend `emptyStates.ts`).
- `src/lib/dashboardStore.svelte.ts` — **extend `DailyRow` type with `visit_seq`, add `aggregateByBucketAndVisitSeq()`.** Keep fetch-once pattern.
- `src/lib/sparseFilter.ts` — `pickVisibleCohorts()` reused for VA-09/VA-10.
- `src/lib/emptyStates.ts` — extend with 6 new chart empty-state keys (D-18).
- `src/lib/filters.ts` — **no change** (filters frozen by Phase 9).
- `src/routes/+page.server.ts` — extend `Promise.all` fan-out (D-02); add select for `visit_seq` + `card_hash` on `transactions_filterable_v`.
- `src/routes/+page.svelte` — insert 6 new chart cards per D-10 ordering; add lazy-mount wiring per D-11.

### Tooling
- `scripts/ci-guards.sh` — must permit new MV names (`customer_ltv_mv`, `item_counts_daily_mv`) in refresh function; still block raw `_mv` references from `src/`.
- `src/lib/e2eChartFixtures.ts` — extend with sample rows for the 6 new charts (E2E_FIXTURES bypass path in `+page.server.ts` lines 20–43).

### External docs (researcher to fetch fresh)
- LayerChart 2.x primitives — https://layerchart.com/docs
- d3-scale-chromatic (categorical palette for items) — https://d3js.org/d3-scale-chromatic
- d3-interpolate (sequential palette for visit_seq) — https://d3js.org/d3-interpolate
- Svelte 5 `IntersectionObserver` patterns for lazy-mount — reference any community snippet

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`CohortRetentionCard.svelte`** — shape template for all 7 new charts. Props shape, LayerChart `Chart`/`Svg`/`Axis` wrappers, sparse-filter wiring, EmptyState fallback, `h-64` card sizing — all copy-paste patterns.
- **`dashboardStore.svelte.ts`** — `bucketKey()`, `filterRows()`, `aggregateByBucket()` already handle grain/range/filter state. Extend with `aggregateByBucketAndVisitSeq()` — same pattern, nested map.
- **`sparseFilter.ts` `pickVisibleCohorts()`** — cohort-aware visible-row selector, reused for VA-09/VA-10.
- **`emptyStates.ts`** — existing copy lookup, extend with 6 new entries.
- **`kpiAgg.ts`** — already imports date-fns `startOfWeek`/`startOfMonth`; reuse helpers rather than duplicate.
- **`e2eChartFixtures.ts`** — E2E bypass infrastructure already wired; extend with new chart fixtures to keep Playwright tests fast.

### Established Patterns
- **Wrapper view + JWT tenant filter + REVOKE ALL on raw MV** (Phase 1 D-06/07/08, Phase 3 D-17/18) — applies to new `customer_ltv_v` and `item_counts_daily_v`.
- **`REFRESH MATERIALIZED VIEW CONCURRENTLY` in `refresh_analytics_mvs()`** (Phase 8 D-05, migration 0013) — extend for two new MVs.
- **Client-side aggregation from raw daily rows** (Phase 9 D-05/D-08) — scales to visit_seq dimension.
- **Per-card error isolation in `+page.server.ts`** (Phase 4 D-22) — every new query uses try/catch + per-card empty fallback.
- **LayerChart Spline / Axis / Tooltip shape** (Phase 4 D-11/D-15) — copy for all new charts.
- **Svelte 5 runes (`$props`, `$derived`, `$state`)** — established in Phase 4 onward; planner stays consistent.
- **SSR returns raw rows, client does all aggregation** (Phase 9 D-05) — extends to VA-04/05/08; VA-06/07/09/10 use pre-aggregated wrapper views.

### Integration Points
- `+page.server.ts` — extend fan-out + extend `DailyRow` select list (+2 cols).
- `+page.svelte` — insert 6 new chart components in D-10 order; thread window/grain/filters/dailyRows props.
- `dashboardStore.svelte.ts` — extend `DailyRow` type + add new aggregator.
- `supabase/migrations/` — 3 new migrations:
  - `0023_transactions_filterable_v_visit_seq.sql` — extend view with visit_seq + card_hash
  - `0024_customer_ltv_mv.sql` — new MV + wrapper + test helper + refresh-fn update
  - `0025_item_counts_daily_mv.sql` — new MV + wrapper + test helper + refresh-fn update
  - (Numbering is Claude's discretion — could split / combine)
- `tests/integration/` — new tests for each MV shape, tenant isolation, refresh ordering.
- `scripts/ci-guards.sh` — add new MV names to allowlist in refresh function guard (if any).

</code_context>

<specifics>
## Specific Ideas

- **The 7-chart scope is the load-bearing commitment.** Three of the 7 (VA-04/05/06) are "core" — calendar revenue, calendar counts, retention. The other four (VA-07/08/09/10) add cohort-value and item-name depth. If scope pressure emerges mid-execution, cohort-value pair (VA-09 + VA-10) can ship together or be deferred as a pair since they share a data source (`customer_ltv_v`). Retention and calendar charts are the non-negotiable minimum.
- **`customer_ltv_v` feeding 3 charts is the elegance hinge of the plan.** VA-07 bins by revenue, VA-09 groups by cohort_week, VA-10 averages by cohort_week. If the planner splits this across 3 separate views, they've missed the re-use win.
- **Sequential color scale (D-06) is deliberately not a Tailwind default palette.** d3-interpolate produces perceptually-uniform gradients. Using arbitrary hand-picked shades usually produces banding at the mid-range (user can't tell 3rd apart from 4th visit).
- **Cash as a 9th segment (D-07) mirrors the Phase 4 new_vs_returning "cash_anonymous" bucket (D-19).** Same philosophy — don't hide cash from the revenue story; show it as a distinct class.
- **Lazy-mount below fold (D-11) is optional.** If planner measures first-paint as fast enough without it, skip. Don't build speculative perf work.
- **Extending `transactions_filterable_v` is chosen over a new "visit_seq-enriched view"** because Phase 9 already joins `visit_attribution_mv` for `is_cash` (migration 0022). Adding `visit_seq` to the same existing join is one column, not a new view. Keeps the SSR query count flat.
- **MEMORY.md's 2026-04-16 note said "only 3 charts for now, more later."** User confirmed on 2026-04-17 that "later" is now — scope is 7 charts per the roadmap. The memory note remains valid history but no longer reflects active scope.

</specifics>

<deferred>
## Deferred Ideas

- **Revenue-by-item view** — separate from VA-08 (which is item counts). Deferred until owner asks.
- **Individual customer drill-down from LTV histogram** (tap a bar → see which customers) — out of scope for v1.2; card-hash anonymity makes this awkward anyway.
- **Per-card grain toggles** — intentionally rejected in favor of clamping (D-17). Revisit only if owner complains.
- **Hourly / day-of-week heatmap** — v2 roadmap ADV-01. Not Phase 10.
- **At-risk customer list** — v2 ADV-02.
- **Segment chips (high-value / casual / one-time)** — v2 ADV-03.
- **Menu-item cohort analysis** — v2 ADV-04.
- **Custom date-range picker on mobile** — out of scope per REQUIREMENTS.md.
- **Export charts to PDF / CSV** — rejected per REQUIREMENTS.md "Out of Scope".
- **12-month LTV projection line** — rejected per REQUIREMENTS.md (not enough history).
- **Cohort triangle / heatmap** — rejected per REQUIREMENTS.md (unreadable on phone).

### Reviewed Todos (not folded)
None — `todo match-phase 10` returned zero matches.

</deferred>

---

*Phase: 10-charts*
*Context gathered: 2026-04-17*
*Decision mode: auto-recs (per feedback_follow_recs_first.md)*
