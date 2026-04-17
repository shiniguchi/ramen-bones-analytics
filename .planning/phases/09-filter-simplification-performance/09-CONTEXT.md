# Phase 9: Filter Simplification & Performance - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

The filter bar shows exactly 2 filters (inhouse/takeaway + cash/card) as inline segmented toggles, granularity/range changes respond in <200ms via client-side re-bucketing (no SSR round-trip), and the dashboard shows 2 KPI tiles (Revenue + Transactions) instead of 5. FilterSheet, MultiSelectDropdown, and all dead filter code are deleted.

</domain>

<decisions>
## Implementation Decisions

### Cash/Card Filter
- **D-01:** Cash/card filter is a 3-state segmented toggle: All / Cash / Card. Inline in the filter bar, always visible. No bottom sheet.
- **D-02:** Data source is `is_cash` from `visit_attribution_mv` (Phase 8 D-02). Filter operates on the client-side dataset — no server round-trip.

### Sales Type Filter
- **D-03:** Inhouse/takeaway filter is also a 3-state segmented toggle: All / Inhouse / Takeaway. Same inline pattern as cash/card.
- **D-04:** Both filter toggles use the same component pattern as GrainToggle (segmented radio group with `replaceState()`).

### Client-Side Re-Bucketing (VA-12)
- **D-05:** SSR load fetches raw daily-grain rows once for the selected date range. Client-side JS re-aggregates into week/month buckets when grain changes. No `goto()`, no `invalidateAll` for grain or range changes.
- **D-06:** Grain and range stay as URL params for shareability/bookmarkability. Changes use `replaceState()` instead of `goto()`. SSR reads them on initial page load only; subsequent changes are client-side.
- **D-07:** Date range widening strategy: fetch-per-range with widest-window caching. If user widens range (7d→90d), a client-side fetch grabs the wider window and caches it. Narrowing slices the cached data — no refetch. Always keeps the widest-seen window in memory.
- **D-08:** Filters (sales_type, is_cash) also apply client-side to the already-loaded dataset. Combined with grain/range, ALL interactive controls are client-side after initial SSR load.

### Revenue Card Consolidation (VA-13)
- **D-09:** Drop 3 fixed revenue tiles (Today/7d/30d) and 1 Avg Ticket tile. Keep 2 tiles total: Revenue + Transactions.
- **D-10:** Revenue tile shows total revenue for the active date range with delta vs prior period. Title is dynamic: "Revenue · {range}". Respects both filters.
- **D-11:** Transactions tile shows count for the active date range with delta vs prior period. Also respects both filters.
- **D-12:** Avg Ticket tile is dropped — derivable from revenue/transactions if needed later.

### Filter Bar Layout
- **D-13:** Two-row layout. Row 1: date range chips (today/7d/30d/90d/all). Row 2: horizontally scrollable row with Grain toggle + Sales Type toggle + Cash/Card toggle, visually separated.
- **D-14:** GrainToggle moves from CohortRetentionCard header to the filter bar as a global control. It's now a top-level filter affecting all tiles and charts (important for Phase 10).
- **D-15:** FilterSheet.svelte, MultiSelectDropdown.svelte, and the filter-icon trigger button are deleted entirely. No multi-select dropdowns remain.

### Dead Code Cleanup
- **D-16:** Remove `payment_method` param from `filtersSchema` in `src/lib/filters.ts` (deferred from Phase 8 D-07). Remove `distinctPaymentMethods` query and prop threading.
- **D-17:** Remove `distinctPaymentMethodsP` query from `+page.server.ts`. Remove `payment_method` from `queryFiltered()` WHERE clause.
- **D-18:** Delete FilterSheet.svelte, MultiSelectDropdown.svelte. Remove imports and usage from `+page.svelte` / FilterBar.

### Claude's Discretion
- Exact component naming for the new segmented toggles (e.g., `PaymentToggle.svelte`, `SalesTypeToggle.svelte`, or a generic `SegmentedToggle.svelte`)
- Whether to refactor KpiTile to accept the dynamic range label or create a new component
- Client-side caching strategy implementation (Svelte $state store vs module-level cache)
- How to handle the "all" range for prior-period delta (no meaningful prior — show "N/A" or hide delta)
- Separator styling between toggle groups in the scrollable row 2

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Current Filter Architecture
- `src/lib/filters.ts` — Zod schema with `payment_method` to remove; `FILTER_DEFAULTS` object; `parseFilters()` function
- `src/lib/components/FilterSheet.svelte` — Draft-and-apply pattern to delete; `goto()` + `invalidateAll` pattern to replace
- `src/lib/components/GrainToggle.svelte` — Existing segmented toggle pattern to reuse for new filters
- `src/lib/components/FilterBar.svelte` — Current filter bar layout to redesign

### SSR Load (refactor target)
- `src/routes/+page.server.ts` — 12 parallel queries to refactor; `queryFiltered()` WHERE clause; `distinctPaymentMethodsP` to remove
- `src/routes/+page.svelte` — 5 KpiTile instances to reduce to 2; CohortRetentionCard grain prop to remove

### Data Source
- `supabase/migrations/0010_cohort_mv.sql` — Existing MV pattern
- Phase 8 creates `visit_attribution_mv` with `is_cash` boolean — data source for cash/card filter

### Phase 8 Decisions (carry forward)
- `.planning/phases/08-visit-attribution-data-model/08-CONTEXT.md` — D-02: is_cash in MV, D-07: payment_method removal deferred here

### Requirements
- `.planning/REQUIREMENTS.md` §VA-11 — 2 filters only, all tiles respect both
- `.planning/REQUIREMENTS.md` §VA-12 — <200ms client-side grain/range toggle
- `.planning/REQUIREMENTS.md` §VA-13 — 1 revenue card using active range/granularity

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `GrainToggle.svelte` — Segmented toggle pattern with `replaceState()`-style interaction. Reuse for sales type and cash/card toggles.
- `KpiTile.svelte` — Existing tile component with value/prior/delta rendering. May need minor updates for dynamic range label.
- `dateRange.ts` — `chipToRange()` and `customToRange()` utilities for date window computation. Reuse for client-side range slicing.
- `kpiAgg.ts` — `sumKpi()` aggregator. Reuse or extend for client-side re-bucketing.

### Established Patterns
- URL params via zod schema (`filtersSchema`) — extend for new filter params, remove dead ones
- `page.url` reactive access via `$app/state` — use for `replaceState()` approach
- Per-card error isolation with try/catch — maintain for any remaining server queries

### Integration Points
- `+page.server.ts` — Major refactor: reduce queries, return daily-grain raw rows for client rebucketing
- `+page.svelte` — Remove 3 KpiTiles, update FilterBar props, remove FilterSheet
- `FilterBar.svelte` — Redesign: 2-row layout with inline toggles
- `CohortRetentionCard.svelte` — Remove GrainToggle from header (moves to filter bar)

</code_context>

<specifics>
## Specific Ideas

- The two-row filter bar with horizontal scroll on row 2 keeps the date chips always visible while the toggle groups scroll naturally on narrow screens.
- GrainToggle becoming a global control in the filter bar sets up Phase 10 correctly — all 7 charts will need grain.
- The fetch-once + client-side rebucket pattern means the SSR load function can be dramatically simplified — it returns raw daily rows and the client does all aggregation.
- Widest-window caching avoids redundant fetches when users explore different ranges.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 09-filter-simplification-performance*
*Context gathered: 2026-04-16*
