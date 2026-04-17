# Phase 9: Filter Simplification & Performance - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-16
**Phase:** 09-filter-simplification-performance
**Areas discussed:** Cash/card filter design, Client-side re-bucketing, Revenue card consolidation, Filter bar layout

---

## Cash/Card Filter Design

| Option | Description | Selected |
|--------|-------------|----------|
| Segmented toggle | All / Cash / Card — 3-state inline toggle, always visible. Matches GrainToggle pattern. | ✓ |
| Dropdown in FilterSheet | Keep MultiSelectDropdown in bottom sheet. Consistent with current sales_type. | |
| Toggle pills | Two independent on/off pills. More flexible but takes more space. | |

**User's choice:** Segmented toggle
**Notes:** Uses `is_cash` from `visit_attribution_mv`. No server round-trip.

### Follow-up: Sales Type Consistency

| Option | Description | Selected |
|--------|-------------|----------|
| Segmented toggle | All / Inhouse / Takeaway — same pattern as cash/card. Eliminates FilterSheet. | ✓ |
| Keep in FilterSheet | Stay as MultiSelectDropdown in slide-up sheet. | |

**User's choice:** Segmented toggle for sales type too. FilterSheet fully eliminated.

---

## Client-Side Re-Bucketing

### Data-Fetching Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Fetch-once, rebucket client-side | SSR loads daily-grain rows. Client rebuckets for week/month. No server round-trip for grain/range. | ✓ |
| Partial invalidation | Keep SSR, only refetch affected queries. Still a round-trip but fewer queries. | |
| Streaming + suspense | Full round-trip but skeleton renders immediately. | |

**User's choice:** Fetch-once, rebucket client-side
**Notes:** Core performance fix for VA-12.

### URL State Handling

| Option | Description | Selected |
|--------|-------------|----------|
| Keep in URL, no SSR trigger | replaceState() for changes. SSR reads on initial load only. Shareable URLs preserved. | ✓ |
| Client-only state | Svelte $state only. Simpler but URLs don't encode view. | |

**User's choice:** Keep in URL with replaceState()

### Range Widening Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Fetch per range, cache wider | Widen triggers client-side fetch. Narrowing slices cache. Keeps widest-seen window. | ✓ |
| Always fetch 'all' | Full dataset upfront. Zero latency on any change. Larger initial payload. | |
| SSR round-trip on range change | Only grain is client-side. Partially solves VA-12. | |

**User's choice:** Fetch per range, cache wider

---

## Revenue Card Consolidation

### Single Revenue Card Content

| Option | Description | Selected |
|--------|-------------|----------|
| Revenue for active range + prior delta | One card: "Revenue · {range}" with total + delta. Respects all filters. | ✓ |
| Revenue + Tx count + Avg ticket in one card | All 3 KPI metrics in a single dense card. | |
| Keep Today tile, merge 7d/30d | Today always visible, other two merge into range-responsive card. | |

**User's choice:** Revenue for active range + prior delta

### Other Tiles

| Option | Description | Selected |
|--------|-------------|----------|
| Keep both alongside revenue card | 3 tiles: Revenue, Transactions, Avg Ticket. | |
| Drop Avg Ticket | 2 tiles: Revenue + Transactions only. Avg ticket is derivable. | ✓ |
| Merge all into one summary card | One card with all sub-metrics. | |

**User's choice:** Drop Avg Ticket — 2 tiles total (Revenue + Transactions)

---

## Filter Bar Layout

### Organization at 375px

| Option | Description | Selected |
|--------|-------------|----------|
| Stacked rows | 3 rows: date chips, grain, filters. Everything visible, no sheet. | |
| Two rows + overflow scroll | Row 1: date chips. Row 2: all toggles in scrollable row. Fewer vertical pixels. | ✓ |
| Collapsible filter section | Date always visible. Disclosure triangle reveals others. | |

**User's choice:** Two rows + overflow scroll

### GrainToggle Location

| Option | Description | Selected |
|--------|-------------|----------|
| Move to filter bar | Global control in row 2 alongside other toggles. | ✓ |
| Keep in card header | Stay inside CohortRetentionCard. Each chart gets own toggle. | |

**User's choice:** Move to filter bar as global control

### FilterSheet Cleanup

| Option | Description | Selected |
|--------|-------------|----------|
| Delete entirely | Remove FilterSheet.svelte, MultiSelectDropdown.svelte, trigger button. | ✓ |
| Keep but hide | Keep components, remove trigger. | |

**User's choice:** Delete entirely

---

## Claude's Discretion

- Component naming for new toggles
- KpiTile refactor for dynamic range labels
- Client-side caching implementation (Svelte $state vs module-level)
- "All" range prior-period delta handling
- Separator styling between toggle groups

## Deferred Ideas

None — discussion stayed within phase scope.
