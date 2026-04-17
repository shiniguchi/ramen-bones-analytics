---
phase: quick
plan: 260417-mfo
type: execute
wave: 1
depends_on: []
files_modified:
  - src/routes/+page.svelte
  - src/lib/components/FilterBar.svelte
  - src/lib/components/SegmentedToggle.svelte
  - src/lib/components/CohortRetentionCard.svelte
autonomous: true
requirements: [UI-FIX-LOADING, UI-FIX-OVERFLOW, UI-FIX-COHORT-GRAIN]

must_haves:
  truths:
    - "Changing a filter shows a visible spinner in the FilterBar while the UI updates"
    - "The 'Takeaway' sales-type button label renders on one line without overflow on mobile"
    - "Cohort Retention card respects the active grain: day shows weekly + hint, week shows weekly, month shows re-bucketed monthly cohorts"
  artifacts:
    - path: "src/routes/+page.svelte"
      provides: "isUpdating state + withUpdate wrapper threading isLoading into FilterBar"
      contains: "withUpdate"
    - path: "src/lib/components/FilterBar.svelte"
      provides: "isLoading prop + inline spinner in Row 1"
      contains: "animate-spin"
    - path: "src/lib/components/SegmentedToggle.svelte"
      provides: "whitespace-nowrap on button class to prevent label wrap"
      contains: "whitespace-nowrap"
    - path: "src/lib/components/CohortRetentionCard.svelte"
      provides: "Grain-aware cohort chart: weekly default, monthly re-bucketed client-side, day hint"
      contains: "weeklyToMonthly"
  key_links:
    - from: "src/routes/+page.svelte"
      to: "src/lib/components/FilterBar.svelte"
      via: "isLoading={isUpdating} prop binding"
      pattern: "isLoading=\\{isUpdating\\}"
    - from: "src/lib/components/CohortRetentionCard.svelte"
      to: "src/lib/dashboardStore.svelte"
      via: "getFilters().grain reactive read"
      pattern: "getFilters\\(\\)\\.grain"
---

<objective>
Ship 3 mobile UI fixes reported by the founder on 2026-04-17:
1. No feedback when filters change (looks frozen) — add inline loading spinner
2. "Takeaway" label wraps/overflows in SegmentedToggle on narrow phones — add whitespace-nowrap
3. Cohort Retention card ignores the grain toggle — make it grain-aware (day = hint, week = weekly, month = re-bucketed monthly)

Purpose: Close three visible regressions before the founder's next UAT pass. Small, surgical, no behavior change outside the three touchpoints.
Output: 4 files modified, DEV-verified on a 375px viewport.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/routes/+page.svelte
@src/lib/components/FilterBar.svelte
@src/lib/components/SegmentedToggle.svelte
@src/lib/components/CohortRetentionCard.svelte
@src/lib/dashboardStore.svelte.ts
@src/lib/sparseFilter.ts

<interfaces>
<!-- Key contracts the executor needs. Do NOT go spelunking the codebase — use these. -->

From src/lib/dashboardStore.svelte.ts:
  getFilters(): { grain: 'day' | 'week' | 'month'; ... }  // reactive getter (Phase 09 pattern)

From src/lib/sparseFilter.ts:
  export type RetentionRow = {
    cohort_week: string;        // YYYY-MM-DD (ISO Monday)
    period_weeks: number;
    retention_rate: number;     // 0..1
    cohort_size_week: number;
  };
  export function pickVisibleCohorts(rows: RetentionRow[]): RetentionRow[];

From src/lib/components/FilterBar.svelte (existing Props, to be extended):
  interface Props {
    filters: FiltersState;
    rangeWindow: RangeWindow;
    onrangechange: (...) => void;
    onsalestype:   (...) => void;
    oncashfilter:  (...) => void;
    // NEW: isLoading: boolean;
  }
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add FilterBar loading spinner + withUpdate wrapper</name>
  <files>src/routes/+page.svelte, src/lib/components/FilterBar.svelte</files>
  <action>
**`src/routes/+page.svelte`:**
After the line `const storeWindow = $derived(getWindow())` (around line 50), insert:
```typescript
let isUpdating = $state(false);
function withUpdate(fn: () => void) {
  isUpdating = true;
  fn();
  setTimeout(() => { isUpdating = false; }, 300);
}
```
Wrap the bodies of the three existing handlers — preserve their internal logic verbatim, only wrap:
- `handleRangeChange`: `withUpdate(() => { ...existing body... })`
- `handleSalesType`:    `withUpdate(() => { ...existing body... })`
- `handleCashFilter`:   `withUpdate(() => { ...existing body... })`

In the `<FilterBar ...>` element in the template, add the new prop: `isLoading={isUpdating}`.

**`src/lib/components/FilterBar.svelte`:**
- Add `isLoading: boolean` to the Props interface.
- Add `isLoading` to the `$props()` destructure.
- Replace the existing Row 1 div (`<div class="mb-2">...`) with:
```svelte
<div class="mb-2 flex items-center gap-2">
  <DatePickerPopover {filters} window={rangeWindow} {onrangechange} />
  {#if isLoading}
    <svg class="h-4 w-4 shrink-0 animate-spin text-zinc-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
    </svg>
  {/if}
</div>
```

Do NOT touch Row 2 or other sections of FilterBar. Do NOT change the three handler internals — only wrap them.
  </action>
  <verify>
    <automated>npm run check &amp;&amp; npm run test:unit -- --run FilterBar</automated>
  </verify>
  <done>Changing any filter (range, sales type, cash) shows a spinning SVG next to the date picker for ~300ms; typecheck clean; FilterBar unit tests still pass.</done>
</task>

<task type="auto">
  <name>Task 2: Fix SegmentedToggle Takeaway overflow</name>
  <files>src/lib/components/SegmentedToggle.svelte</files>
  <action>
On line 17 (the button `class=` attribute), insert `whitespace-nowrap` so the button class string becomes:
```
class="min-h-11 min-w-0 flex-1 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors
```
(Preserve every other class and trailing portion of the attribute exactly as-is — only add `whitespace-nowrap` between `font-medium` and `transition-colors`.)

No other changes in this file. No prop/interface changes.
  </action>
  <verify>
    <automated>npm run check</automated>
  </verify>
  <done>"Takeaway" renders on a single line in the sales-type toggle at 375px width; no text wraps or clips; typecheck clean.</done>
</task>

<task type="auto">
  <name>Task 3: Make CohortRetentionCard grain-aware</name>
  <files>src/lib/components/CohortRetentionCard.svelte</files>
  <action>
Replace the entire existing `<script lang="ts">` block with this new script (verbatim from the full_implementation_spec):

```svelte
<script lang="ts">
  import { Chart, Svg, Axis, Spline, Highlight, Tooltip } from 'layerchart';
  import { scaleLinear } from 'd3-scale';
  import EmptyState from './EmptyState.svelte';
  import { pickVisibleCohorts, type RetentionRow } from '$lib/sparseFilter';
  import { getFilters } from '$lib/dashboardStore.svelte';

  let { data }: { data: RetentionRow[] } = $props();

  const palette = ['#2563eb', '#0891b2', '#7c3aed', '#db2777'];

  // Reactive grain — drives all branching below.
  const grain = $derived(getFilters().grain);

  // D-17 day hint — weekly data shown, day not applicable.
  const showDayHint = $derived(grain === 'day');
  // Monthly approximation notice.
  const showMonthNote = $derived(grain === 'month');

  // --- Monthly re-bucket (client-side, weighted average by cohort_size_week) ---
  type MonthlyRow = {
    cohort_month: string;   // YYYY-MM
    period_months: number;
    retention_rate: number;
    cohort_size_month: number;
  };

  function weeklyToMonthly(rows: RetentionRow[]): MonthlyRow[] {
    type Acc = { sumW: number; sumSize: number; maxSize: number };
    const buckets = new Map<string, Acc>();
    for (const r of rows) {
      const key = `${r.cohort_week.slice(0, 7)}|${Math.round(r.period_weeks / 4.33)}`;
      const b = buckets.get(key) ?? { sumW: 0, sumSize: 0, maxSize: 0 };
      b.sumW    += r.retention_rate * r.cohort_size_week;
      b.sumSize += r.cohort_size_week;
      b.maxSize  = Math.max(b.maxSize, r.cohort_size_week);
      buckets.set(key, b);
    }
    return Array.from(buckets.entries())
      .map(([key, b]) => {
        const [cohort_month, pm] = key.split('|');
        return {
          cohort_month,
          period_months: Number(pm),
          retention_rate: b.sumSize > 0 ? b.sumW / b.sumSize : 0,
          cohort_size_month: b.maxSize
        };
      })
      .sort((a, b) => a.cohort_month.localeCompare(b.cohort_month) || a.period_months - b.period_months);
  }

  // Weekly path: existing sparse-filter + last-4 slice (unchanged).
  const visibleRows = $derived(pickVisibleCohorts(data));

  const allSparse = $derived.by(() => {
    if (data.length === 0 || grain === 'month') return false;
    const sizes = new Map<string, number>();
    for (const r of data) {
      const cur = sizes.get(r.cohort_week) ?? 0;
      if (r.cohort_size_week > cur) sizes.set(r.cohort_week, r.cohort_size_week);
    }
    return Array.from(sizes.values()).every(s => s < 5);
  });

  // Unified series — branches on grain.
  const series = $derived.by(() => {
    if (grain === 'month') {
      const monthly = weeklyToMonthly(data);
      const cohortSizes = new Map<string, number>();
      for (const r of monthly) {
        const cur = cohortSizes.get(r.cohort_month) ?? 0;
        if (r.cohort_size_month > cur) cohortSizes.set(r.cohort_month, r.cohort_size_month);
      }
      const allMonths = Array.from(cohortSizes.keys()).sort();
      const nonSparse = allMonths.filter(m => (cohortSizes.get(m) ?? 0) >= 5);
      const chosen = new Set((nonSparse.length > 0 ? nonSparse : allMonths).slice(-4));
      const byCohort = new Map<string, MonthlyRow[]>();
      for (const r of monthly.filter(r => chosen.has(r.cohort_month))) {
        if (!byCohort.has(r.cohort_month)) byCohort.set(r.cohort_month, []);
        byCohort.get(r.cohort_month)!.push(r);
      }
      return Array.from(byCohort.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([cohort, rows], i) => ({ cohort, rows, color: palette[i % palette.length] }));
    }
    // Weekly (day or week grain) — existing logic.
    const byCohort = new Map<string, RetentionRow[]>();
    for (const r of visibleRows) {
      if (!byCohort.has(r.cohort_week)) byCohort.set(r.cohort_week, []);
      byCohort.get(r.cohort_week)!.push(r);
    }
    return Array.from(byCohort.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cohort, rows], i) => ({ cohort, rows, color: palette[i % palette.length] }));
  });

  // Chart x-axis key and label depend on grain.
  const xKey    = $derived(grain === 'month' ? 'period_months' : 'period_weeks');
  const xLabel  = $derived(grain === 'month' ? 'Months since first visit' : 'Weeks since first visit');
  const xTipKey = $derived(grain === 'month' ? 'Month' : 'Week');
</script>
```

Then in the template, replace the existing hint blocks and the `<Chart ...>` block with exactly this markup (keeping any surrounding Card/header structure that already exists):

```svelte
{#if showDayHint}
  <p data-testid="cohort-clamp-hint" class="mt-2 text-xs text-amber-600">
    Cohort view shows weekly — day granularity not applicable.
  </p>
{/if}
{#if showMonthNote}
  <p data-testid="cohort-month-note" class="mt-2 text-xs text-zinc-400">
    Monthly cohorts approximated from weekly data.
  </p>
{/if}
{#if allSparse && series.length > 0}
  <p data-testid="sparse-hint" class="mt-2 text-xs text-amber-600">
    Cohort sizes are small — retention lines may swing a lot. Give it a few more weeks of data.
  </p>
{/if}

{#if series.length === 0}
  <EmptyState card="cohort" />
{:else}
  <div class="mt-4 h-64">
    <Chart
      data={series.flatMap((s, i) => s.rows.map(r => ({ ...r, cohortLabel: s.cohort, color: palette[i % palette.length] })))}
      x={xKey}
      y="retention_rate"
      xScale={scaleLinear()}
      yScale={scaleLinear()}
      yDomain={[0, 1]}
      padding={{ left: 32, bottom: 24, top: 8, right: 8 }}
    >
      <Svg>
        <Axis placement="left" format={(v: number) => `${Math.round(v * 100)}%`} grid />
        <Axis placement="bottom" label={xLabel} />
        {#each series as s, i}
          <Spline
            data={s.rows}
            x={xKey}
            y="retention_rate"
            class="stroke-2"
            stroke={palette[i % palette.length]}
          />
        {/each}
        <Highlight points lines />
        <Tooltip.Root let:data>
          <Tooltip.Header>
            {data?.cohort_month ?? data?.cohort_week} · {xTipKey} {data?.[xKey]}
          </Tooltip.Header>
          <Tooltip.List>
            <Tooltip.Item label="Retention" value={`${Math.round((data?.retention_rate ?? 0) * 100)}%`} />
            <Tooltip.Item label="Cohort size" value={`${data?.cohort_size_month ?? data?.cohort_size_week ?? 0} customers`} />
          </Tooltip.List>
        </Tooltip.Root>
      </Svg>
    </Chart>
  </div>
{/if}
```

Notes:
- Do NOT add a new prop to the component; `grain` is read reactively via `getFilters()` per the Phase 09 dashboardStore pattern.
- Phase 10 existing testid `cohort-clamp-hint` copy is preserved byte-identical for the day branch (keeps VA-06/09/10 tests green).
- Monthly branch uses `period_months`/`cohort_size_month` — the Tooltip template handles both shapes via `??`.
  </action>
  <verify>
    <automated>npm run check &amp;&amp; npm run test:unit -- --run CohortRetention</automated>
  </verify>
  <done>With grain=day, card shows "Cohort view shows weekly — day granularity not applicable." hint and weekly lines. With grain=week, card renders weekly lines (existing behavior, no hint). With grain=month, card shows "Monthly cohorts approximated..." note, uses Months x-axis, and re-buckets weekly rows into monthly cohorts (weighted average).</done>
</task>

</tasks>

<verification>
After all 3 tasks land, run the full test + typecheck gate and DEV smoke:

1. `npm run check` — no type errors across the 4 touched files
2. `npm run test:unit -- --run` — FilterBar, CohortRetention, and sparseFilter suites green
3. Push to `main` → wait for CF Pages deploy (workflow `deploy.yml`) → open DEV URL in Chrome MCP at 375×667:
   - Flip any filter → spinner appears for ~300ms next to date picker
   - Inspect sales-type toggle → "Takeaway" sits on one line
   - Toggle grain day → cohort hint visible, weekly lines shown
   - Toggle grain week → no hint, weekly lines
   - Toggle grain month → month note visible, monthly re-bucketed lines with "Months since first visit" axis
</verification>

<success_criteria>
- Three discrete UX regressions closed, independently verifiable on DEV at 375px
- Zero changes to SSR loader, SQL views, or MVs — purely client-side component work
- No new dependencies; no prop-drilling additions beyond FilterBar.isLoading
- Phase 10 cohort-clamp-hint testid contract preserved byte-identical
</success_criteria>

<output>
After completion, create `.planning/quick/260417-mfo-3-ui-fixes-loading-spinner-takeaway-over/260417-mfo-SUMMARY.md` capturing: what changed, DEV verification screenshots/notes, and any deviations from this plan.
</output>
