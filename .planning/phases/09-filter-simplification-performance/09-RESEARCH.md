# Phase 9: Filter Simplification & Performance - Research

**Researched:** 2026-04-16
**Domain:** SvelteKit client-side state management, URL-driven filtering, Svelte 5 reactivity
**Confidence:** HIGH

## Summary

Phase 9 transforms the dashboard from a 12-query SSR-heavy page to a fetch-once, client-side-rebucket architecture. The three workstreams are: (1) replace FilterSheet/MultiSelectDropdown with inline segmented toggles for sales_type and is_cash, (2) switch grain/range/filter changes from `goto()` (SSR round-trip) to `replaceState()` with client-side aggregation, and (3) collapse 5 KPI tiles to 2 (Revenue + Transactions) that follow the active date range.

The existing codebase already has the right patterns -- `GrainToggle.svelte` demonstrates the segmented toggle UI, `kpiAgg.ts` provides pure aggregation, and `dateRange.ts` handles window math. The main engineering challenge is the fetch-once data architecture: SSR must return daily-grain raw rows from `visit_attribution_v` (joined with `transactions_filterable_v` for gross_cents), and a new client-side module must handle re-bucketing into week/month grains, filtering by is_cash and sales_type, and caching the widest-seen date window.

**Primary recommendation:** Build a `dashboardStore.ts` module using Svelte 5 `$state`/`$derived` that holds the raw daily rows, derives filtered+bucketed aggregates reactively, and exposes them to all tiles and charts. Use `replaceState()` from `$app/navigation` for URL updates; read URL params from `$app/state` page object reactively.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- D-01: Cash/card filter is a 3-state segmented toggle: All / Cash / Card. Inline in the filter bar, always visible.
- D-02: Data source is `is_cash` from `visit_attribution_mv`. Filter operates on the client-side dataset.
- D-03: Inhouse/takeaway filter is also a 3-state segmented toggle: All / Inhouse / Takeaway.
- D-04: Both filter toggles use the same component pattern as GrainToggle (segmented radio group with `replaceState()`).
- D-05: SSR load fetches raw daily-grain rows once. Client-side JS re-aggregates into week/month. No `goto()`, no `invalidateAll` for grain or range changes.
- D-06: Grain and range stay as URL params. Changes use `replaceState()`. SSR reads on initial load only; subsequent changes are client-side.
- D-07: Date range widening: fetch-per-range with widest-window caching. Widening fetches wider window and caches; narrowing slices cached data.
- D-08: Filters (sales_type, is_cash) apply client-side to already-loaded dataset.
- D-09: Drop 3 fixed revenue tiles (Today/7d/30d) and 1 Avg Ticket tile. Keep 2 tiles: Revenue + Transactions.
- D-10: Revenue tile shows total for active date range with delta vs prior period. Title dynamic: "Revenue . {range}". Respects both filters.
- D-11: Transactions tile shows count for active date range with delta vs prior period. Respects both filters.
- D-12: Avg Ticket tile dropped.
- D-13: Two-row filter bar layout. Row 1: date range chips. Row 2: horizontally scrollable with Grain + Sales Type + Cash/Card toggles.
- D-14: GrainToggle moves from CohortRetentionCard header to filter bar as global control.
- D-15: FilterSheet.svelte, MultiSelectDropdown.svelte, and filter-icon button deleted entirely.
- D-16: Remove `payment_method` param from `filtersSchema`.
- D-17: Remove `distinctPaymentMethodsP` query from `+page.server.ts`. Remove `payment_method` from `queryFiltered()` WHERE clause.
- D-18: Delete FilterSheet.svelte, MultiSelectDropdown.svelte. Remove imports and usage.

### Claude's Discretion
- Exact component naming for new segmented toggles (generic `SegmentedToggle.svelte` vs specific)
- Whether to refactor KpiTile or create a new component for dynamic range label
- Client-side caching strategy implementation (Svelte $state store vs module-level cache)
- How to handle "all" range for prior-period delta (no meaningful prior)
- Separator styling between toggle groups in scrollable row 2

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VA-11 | Filters simplified to inhouse/takeaway + cash/card only -- all tiles and charts respect both filters (no unscoped reference tiles) | Segmented toggle pattern from GrainToggle.svelte; `is_cash` from visit_attribution_mv; sales_type from transactions_filterable_v; client-side filtering via $derived |
| VA-12 | Granularity/range toggle is client-side (no full SSR round-trip) -- target <200ms perceived response | `replaceState()` from `$app/navigation` replaces `goto()`; fetch-once daily rows + client rebucketing; widest-window cache prevents refetches |
| VA-13 | Drop 2 of 3 revenue reference cards -- keep 1 revenue card using active date range/granularity, respects all filters | Collapse 5 KpiTile instances to 2; dynamic title from range; delta vs prior period computed client-side |
</phase_requirements>

## Standard Stack

### Core (already installed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| SvelteKit | 2.x | App framework | Already in use; `replaceState` from `$app/navigation` is the key new API |
| Svelte 5 | 5.x (runes) | Reactivity | `$state`/`$derived` power the client-side rebucketing store |
| @supabase/supabase-js | 2.103.x | DB client | Already in use for SSR queries |
| date-fns | 4.x | Date math | Already in use; `startOfWeek`, `startOfMonth`, `format` for rebucketing |
| zod | 3.x | Schema validation | Already in use in `filters.ts` |

### New APIs Used (no install needed)

| API | Source | Purpose |
|-----|--------|---------|
| `replaceState(url, state)` | `$app/navigation` | Update URL params without SSR round-trip |
| `page.url` | `$app/state` | Reactive URL reading for filter state |
| `$state()` / `$derived()` | Svelte 5 runes | Client-side data store + derived aggregations |

No new packages needed. All functionality comes from existing dependencies.

## Architecture Patterns

### Recommended Project Structure

```
src/
  lib/
    filters.ts              # MODIFY: remove payment_method, add is_cash param
    dateRange.ts             # EXISTING: chipToRange, customToRange (no changes)
    kpiAgg.ts                # EXISTING: sumKpi (reuse for client-side agg)
    dashboardStore.svelte.ts # NEW: fetch-once + client-side rebucket store
    format.ts                # EXISTING: formatEUR (no changes)
    components/
      FilterBar.svelte       # REWRITE: 2-row layout with inline toggles
      SegmentedToggle.svelte  # NEW: generic 3-state toggle (reusable)
      GrainToggle.svelte      # MODIFY: use replaceState instead of goto
      KpiTile.svelte          # MODIFY: dynamic title support
      DatePickerPopover.svelte # MODIFY: use replaceState instead of goto
      FilterSheet.svelte      # DELETE
      MultiSelectDropdown.svelte # DELETE
  routes/
    +page.server.ts          # SIMPLIFY: return raw daily rows only
    +page.svelte             # REWRITE: 2 tiles, use dashboardStore
```

### Pattern 1: Fetch-Once + Client-Side Rebucketing

**What:** SSR loads raw daily-grain rows once. All grain/range/filter changes happen client-side via reactive derivations.

**When to use:** Any time interactive controls need sub-200ms response and the dataset fits in memory (this dataset is ~365 rows/year max for daily grain).

**Implementation approach:**

```typescript
// dashboardStore.svelte.ts
// Module-level Svelte 5 runes (.svelte.ts extension required)
import { startOfWeek, startOfMonth, format } from 'date-fns';

type DailyRow = {
  business_date: string;
  gross_cents: number;
  sales_type: string | null;
  is_cash: boolean;
};

// Reactive state: raw rows + filter params
let rawRows = $state<DailyRow[]>([]);
let dateFrom = $state('');
let dateTo = $state('');
let grain = $state<'day' | 'week' | 'month'>('week');
let salesTypeFilter = $state<'all' | 'INHOUSE' | 'TAKEAWAY'>('all');
let cashFilter = $state<'all' | 'cash' | 'card'>('all');

// Derived: filtered rows (runs ~instantly on <10k rows)
const filtered = $derived.by(() => {
  let rows = rawRows;
  if (salesTypeFilter !== 'all') {
    rows = rows.filter(r => r.sales_type === salesTypeFilter);
  }
  if (cashFilter !== 'all') {
    rows = rows.filter(r => cashFilter === 'cash' ? r.is_cash : !r.is_cash);
  }
  // Slice to date window
  return rows.filter(r => r.business_date >= dateFrom && r.business_date <= dateTo);
});

// Derived: bucketed by grain
const bucketed = $derived.by(() => {
  const buckets = new Map<string, { revenue: number; txCount: number }>();
  for (const row of filtered) {
    const key = bucketKey(row.business_date, grain);
    const b = buckets.get(key) ?? { revenue: 0, txCount: 0 };
    b.revenue += row.gross_cents;
    b.txCount += 1;
    buckets.set(key, b);
  }
  return buckets;
});

function bucketKey(date: string, grain: 'day' | 'week' | 'month'): string {
  if (grain === 'day') return date;
  const d = new Date(date + 'T00:00:00');
  if (grain === 'week') return format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd');
  return format(startOfMonth(d), 'yyyy-MM');
}
```

### Pattern 2: replaceState for URL Sync

**What:** Use `replaceState()` instead of `goto()` to update URL params without triggering SSR load.

**Why:** `goto()` causes SvelteKit to re-run `+page.server.ts`. `replaceState()` only updates the URL and history entry -- no server round-trip.

**Critical detail:** `replaceState` from `$app/navigation` takes `(url: string | URL, state: App.PageState)`. The first argument is the new URL string. The second is page state (can be empty `{}`).

```typescript
import { replaceState } from '$app/navigation';
import { page } from '$app/state';

function updateParam(key: string, value: string) {
  const url = new URL(page.url);
  url.searchParams.set(key, value);
  replaceState(url, {}); // No SSR, no navigation
}
```

### Pattern 3: Widest-Window Cache

**What:** Track the widest date range the user has requested. Narrowing slices from cache. Widening triggers a fetch for the delta.

```typescript
let cachedFrom = $state('');
let cachedTo = $state('');

async function ensureData(from: string, to: string, supabase: SupabaseClient) {
  if (from >= cachedFrom && to <= cachedTo) return; // Already cached
  // Fetch the wider window
  const fetchFrom = from < cachedFrom ? from : cachedFrom;
  const fetchTo = to > cachedTo ? to : cachedTo;
  const { data } = await supabase
    .from('transactions_filterable_v')
    .select('business_date,gross_cents,sales_type')
    .gte('business_date', fetchFrom)
    .lte('business_date', fetchTo);
  // Merge with existing + update cache bounds
  // ... merge logic
  cachedFrom = fetchFrom;
  cachedTo = fetchTo;
}
```

### Pattern 4: Segmented Toggle (3-State)

**What:** Generic component for All/A/B segmented radio group. Reused for sales_type and cash/card.

```svelte
<!-- SegmentedToggle.svelte -->
<script lang="ts">
  type Option = { value: string; label: string };
  let { options, selected, onchange, label }:
    { options: Option[]; selected: string; onchange: (v: string) => void; label: string } = $props();
</script>

<div role="group" aria-label={label}
     class="inline-flex items-center rounded-lg border border-zinc-200 bg-zinc-50 p-0.5 gap-0.5">
  {#each options as opt}
    <button type="button" role="radio" aria-checked={selected === opt.value}
      class="min-h-11 min-w-0 flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors
        {selected === opt.value ? 'bg-blue-50 text-blue-600 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}"
      onclick={() => onchange(opt.value)}>
      {opt.label}
    </button>
  {/each}
</div>
```

### Anti-Patterns to Avoid

- **goto() for filter changes:** Triggers full SSR round-trip. Use `replaceState()` instead.
- **invalidateAll() for grain changes:** Same SSR round-trip problem. Client-side rebucketing is the solution.
- **Server-side WHERE for client-side filters:** is_cash and sales_type should be filtered client-side from the already-loaded dataset, not via server queries.
- **Separate fetch per grain change:** The whole point is fetch-once at daily grain, rebucket client-side.
- **$effect for derived data:** Use `$derived` / `$derived.by()`, not `$effect` + manual state updates. Effects are for side-effects (DOM, external APIs), not data derivation.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Date bucketing (week/month) | Manual week-number math | `date-fns` `startOfWeek` / `startOfMonth` | Locale-aware week start (Monday for DE), DST handling |
| URL param management | String concatenation | `new URL(page.url)` + `URLSearchParams` | Handles encoding, existing params, edge cases |
| History management | `window.history.replaceState` | SvelteKit `replaceState()` | Integrates with SvelteKit router state |
| EUR formatting | Template literal math | `Intl.NumberFormat` via existing `formatEUR` | Locale-correct separators, currency symbol |

## Common Pitfalls

### Pitfall 1: replaceState URL Must Be Absolute or Relative to Origin
**What goes wrong:** Passing just `?grain=week` to `replaceState` may not work as expected.
**Why it happens:** `replaceState` expects a `string | URL`. A bare query string works but may lose pathname.
**How to avoid:** Always construct a full URL: `const url = new URL(page.url); url.searchParams.set(...)`.
**Warning signs:** URL loses pathname after toggle click.

### Pitfall 2: Svelte 5 .svelte.ts Extension for Module-Level Runes
**What goes wrong:** `$state` and `$derived` fail to compile in a regular `.ts` file.
**Why it happens:** Svelte 5 runes are compiler transforms. They only work in `.svelte` or `.svelte.ts` files.
**How to avoid:** Name the store file `dashboardStore.svelte.ts`, NOT `dashboardStore.ts`.
**Warning signs:** Compiler error about `$state` not being defined.

### Pitfall 3: DatePickerPopover Still Uses goto()
**What goes wrong:** Date range changes via presets still trigger SSR round-trip even after grain/filter changes are client-side.
**Why it happens:** `DatePickerPopover.svelte` calls `goto()` with `invalidateAll: true` for preset and custom range changes.
**How to avoid:** Refactor DatePickerPopover to use `replaceState()` for preset changes AND trigger the widest-window-cache fetch for range widening. Custom range "Apply" button triggers fetch if cache doesn't cover the new window.
**Warning signs:** Clicking "30d" chip causes full page reload while grain toggle is instant.

### Pitfall 4: Prior-Period Delta for "All" Range
**What goes wrong:** "All" range has no meaningful prior period -- there's no earlier data.
**Why it happens:** `chipToRange('all')` returns `priorFrom: null`.
**How to avoid:** When range is 'all', show "N/A" or hide the delta line on KPI tiles. KpiTile already handles `null` prior gracefully ("-- no prior data").
**Warning signs:** Division by zero or nonsensical delta percentage.

### Pitfall 5: visit_attribution_v Missing gross_cents
**What goes wrong:** The client-side store needs both `is_cash` (from visit_attribution_v) and `gross_cents` (from transactions_filterable_v or a join).
**Why it happens:** `visit_attribution_mv` only stores tx_id, card_hash, is_cash, visit_seq, business_date -- no gross_cents, no sales_type.
**How to avoid:** Either (a) join visit_attribution_v with transactions_filterable_v server-side before returning to client, or (b) create a new combined view, or (c) add gross_cents and sales_type to the MV definition.
**Warning signs:** Client-side store has is_cash but can't compute revenue.

### Pitfall 6: CohortRetentionCard Loses GrainToggle
**What goes wrong:** After moving GrainToggle out of CohortRetentionCard into FilterBar, the card header looks empty.
**Why it happens:** The card previously had `<GrainToggle {grain} />` in its header.
**How to avoid:** Remove the GrainToggle from CohortRetentionCard header. The card title alone is sufficient. Grain is now a global control in the filter bar.
**Warning signs:** Duplicate grain toggles on the page.

### Pitfall 7: E2E Fixtures Still Reference Old KPI Shape
**What goes wrong:** E2E tests break because the mock data in `+page.server.ts` still returns the old 5-tile KPI shape.
**Why it happens:** The E2E fixture bypass block returns `revenueToday`, `revenue7d`, `revenue30d`, `txCount`, `avgTicket`.
**How to avoid:** Update the E2E fixture to return the new 2-tile shape (revenue + transactions for active range).
**Warning signs:** E2E tests fail with "cannot read property of undefined".

## Code Examples

### Client-Side Fetch on Range Widening

When the user changes from 7d to 30d, the client checks the cache and fetches only if needed:

```typescript
// Inside dashboardStore.svelte.ts
export async function setRange(newRange: Range, supabase: SupabaseClient) {
  const window = chipToRange(newRange);
  // Update URL without SSR
  const url = new URL(page.url);
  url.searchParams.set('range', newRange);
  replaceState(url, {});
  
  // Check if cache covers this window
  if (window.from >= cachedFrom && window.to <= cachedTo) {
    // Just update derived state -- reactivity handles the rest
    dateFrom = window.from;
    dateTo = window.to;
    return;
  }
  
  // Need to fetch wider window
  await ensureData(window.from, window.to, supabase);
  dateFrom = window.from;
  dateTo = window.to;
}
```

### Updated +page.server.ts (Simplified)

```typescript
// Returns raw daily rows for client-side processing
export const load: PageServerLoad = async ({ locals, url }) => {
  const filters = parseFilters(url);
  const range = filters.range;
  const chipW = range === 'custom' && filters.from && filters.to
    ? customToRange({ from: filters.from, to: filters.to })
    : chipToRange(range as Range);

  // Single query: daily rows with is_cash + sales_type
  // Join transactions_filterable_v with visit_attribution_v
  const { data: dailyRows } = await locals.supabase
    .from('transactions_filterable_v')
    .select('business_date, gross_cents, sales_type, payment_method')
    .gte('business_date', chipW.from)
    .lte('business_date', chipW.to);

  // Also need is_cash from visit_attribution_v for the same window
  // ... join strategy TBD (see Pitfall 5)

  return {
    range, grain: filters.grain, filters,
    window: chipW,
    dailyRows: dailyRows ?? [],
    // Retention + insight still SSR (not rebucketed)
    retention: await retentionQuery(locals.supabase),
    latestInsight: await insightQuery(locals.supabase),
    freshness: await freshnessQuery(locals.supabase)
  };
};
```

## Data Architecture Decision: Join Strategy for is_cash + gross_cents

The `visit_attribution_mv` has `is_cash` and `visit_seq` but not `gross_cents` or `sales_type`. The `transactions_filterable_v` has `gross_cents` and `sales_type` but not `is_cash`.

**Options:**
1. **Server-side join in +page.server.ts** -- two queries, merge by tx_id in JS. Simple but two round-trips.
2. **New combined view** -- create a Postgres view joining both. Single query. Best approach.
3. **Add columns to transactions_filterable_v** -- alter the view to include is_cash from a join to visit_attribution_mv. Cleanest.

**Recommendation:** Option 3 -- rewrite `transactions_filterable_v` to join with `visit_attribution_mv` and include `is_cash`. This keeps the single-view query pattern the loader already uses. The migration is a `CREATE OR REPLACE VIEW`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `goto()` + `invalidateAll` | `replaceState()` | SvelteKit 2.0 | No SSR round-trip for URL param changes |
| `$: reactive` (Svelte 4) | `$derived` / `$state` (Svelte 5) | Svelte 5.0 | Explicit reactivity, works in .svelte.ts files |
| `$app/stores` | `$app/state` | Svelte 5 / SvelteKit 2 | Direct property access instead of store subscription |
| Per-card SSR queries | Fetch-once + client rebucket | This phase | Eliminates 10+ parallel SSR queries |

## Open Questions

1. **Combined view or server-side join?**
   - What we know: visit_attribution_v has is_cash; transactions_filterable_v has gross_cents + sales_type
   - What's unclear: Whether CREATE OR REPLACE on transactions_filterable_v can add a join to visit_attribution_mv without breaking existing dependents
   - Recommendation: Create new combined view or alter transactions_filterable_v (Option 3 above). Planner should verify no other code depends on exact column set.

2. **Supabase client in .svelte.ts store file**
   - What we know: The widest-window cache needs to fetch via supabase client
   - What's unclear: How to access `locals.supabase` (server) vs browser client in the store
   - Recommendation: Pass the supabase client as a parameter to store functions. In `+page.svelte`, create the client via `$app/state` page data and pass it down.

3. **Retention data: SSR or client-side?**
   - What we know: Retention curve data comes from retention_curve_v and is NOT filtered by range/grain in the same way
   - What's unclear: Whether retention should also move to client-side or stay SSR
   - Recommendation: Keep retention as SSR for now. It's a separate data source (cohort-based, not daily-grain). Phase 10 may revisit.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 1.x + Playwright (e2e) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run --reporter=dot` |
| Full suite command | `npx vitest run && npx playwright test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VA-11 | Only 2 filter toggles visible; all tiles respect both | e2e | `npx playwright test tests/e2e/filter-bar.spec.ts` | Exists (needs update) |
| VA-12 | Grain/range change <200ms, no SSR round-trip | unit + e2e | `npx vitest run tests/unit/dashboardStore.test.ts` | Wave 0 |
| VA-13 | 2 KPI tiles (Revenue + Transactions), dynamic title | e2e | `npx playwright test tests/e2e/dashboard-happy-path.spec.ts` | Exists (needs update) |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=dot`
- **Per wave merge:** `npx vitest run && npx playwright test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/dashboardStore.test.ts` -- covers VA-12 client-side rebucketing logic
- [ ] `tests/unit/filters.test.ts` -- covers VA-11 schema changes (payment_method removed, is_cash added)
- [ ] Update `tests/e2e/filter-bar.spec.ts` -- VA-11 (2 toggles visible, no FilterSheet)
- [ ] Update `tests/e2e/dashboard-happy-path.spec.ts` -- VA-13 (2 tiles not 5)

## Sources

### Primary (HIGH confidence)
- SvelteKit `$app/navigation` docs (replaceState signature) -- https://svelte.dev/docs/kit/$app-navigation
- SvelteKit shallow routing docs -- https://svelte.dev/docs/kit/shallow-routing
- Existing codebase: `src/lib/components/GrainToggle.svelte` (segmented toggle pattern)
- Existing codebase: `src/lib/filters.ts` (zod schema pattern)
- Existing codebase: `src/routes/+page.server.ts` (current 12-query SSR pattern)
- Existing codebase: `supabase/migrations/0020_visit_attribution_mv.sql` (is_cash source)
- Existing codebase: `supabase/migrations/0018_transactions_filterable_v.sql` (gross_cents source)

### Secondary (MEDIUM confidence)
- date-fns `startOfWeek`/`startOfMonth` for grain bucketing -- standard library functions, well-documented
- Svelte 5 `.svelte.ts` rune support -- documented in Svelte 5 docs, verified by project already using `$state` in `.svelte` files

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in use, no new deps
- Architecture: HIGH -- patterns verified from SvelteKit docs + existing codebase
- Pitfalls: HIGH -- identified from reading actual code (goto vs replaceState, missing columns, E2E fixtures)

**Research date:** 2026-04-16
**Valid until:** 2026-05-16
