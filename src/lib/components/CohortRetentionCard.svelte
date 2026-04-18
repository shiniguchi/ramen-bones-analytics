<script lang="ts">
  // CohortRetentionCard — cohort retention curves via LayerChart Spline (D-11..D-15).
  // quick-260418-28j Pass 2: monthly grain now reads pre-computed monthly cohorts
  // from retention_curve_monthly_v (migration 0027) instead of re-bucketing
  // weekly rows client-side. X-axis domain capped at 52 weeks / 12 months.
  // Up to 12 cohort lines render using COHORT_LINE_PALETTE.
  //
  // Props: dataWeekly (from retention_curve_v), dataMonthly (from retention_curve_monthly_v).
  // No range prop — this card is chip-independent (D-04 / Pitfall 6).
  // Phase 9: GrainToggle moved to FilterBar (D-14).
  import { Chart, Svg, Axis, Spline, Highlight, Tooltip } from 'layerchart';
  import { scaleLinear } from 'd3-scale';
  import EmptyState from './EmptyState.svelte';
  import {
    pickVisibleCohorts,
    SPARSE_MIN_COHORT_SIZE,
    MAX_PERIOD_WEEKS,
    MAX_PERIOD_MONTHS,
    MAX_COHORT_LINES,
    type RetentionRow,
    type RetentionMonthlyRow
  } from '$lib/sparseFilter';
  import { COHORT_LINE_PALETTE } from '$lib/chartPalettes';
  import { getFilters } from '$lib/dashboardStore.svelte';

  let {
    dataWeekly,
    dataMonthly
  }: { dataWeekly: RetentionRow[]; dataMonthly: RetentionMonthlyRow[] } = $props();

  // 12-color categorical palette for cohort lines (D-11). Sourced from chartPalettes
  // so the legacy inline 4-color literal is gone — single source of truth.
  const palette = COHORT_LINE_PALETTE;

  // Reactive grain — drives all branching below.
  const grain = $derived(getFilters().grain);

  // D-17: day-grain clamp hint. Copy is byte-identical to VA-09/VA-10 per the
  // Phase 10-07 contract so the three cohort-semantic cards stay visually in sync.
  const showClampHint = $derived(grain === 'day');

  // Weekly path: existing sparse-filter + MAX_COHORT_LINES slice.
  const visibleRows = $derived(pickVisibleCohorts(dataWeekly));

  // Sparse hint only meaningful on weekly paths — month branch runs against
  // SQL-computed monthly cohorts (cohort_size_month already materialized), so
  // "all sparse" isn't computed there.
  const allSparse = $derived.by(() => {
    if (dataWeekly.length === 0 || grain === 'month') return false;
    const sizes = new Map<string, number>();
    for (const r of dataWeekly) {
      const cur = sizes.get(r.cohort_week) ?? 0;
      if (r.cohort_size_week > cur) sizes.set(r.cohort_week, r.cohort_size_week);
    }
    return Array.from(sizes.values()).every(s => s < SPARSE_MIN_COHORT_SIZE);
  });

  // Unified series — branches on grain. Monthly path is SQL-backed.
  const series = $derived.by(() => {
    if (grain === 'month') {
      if (dataMonthly.length === 0) return [];
      // Group cohort_size_month per cohort_month (all rows for the same cohort
      // share the same size, but take max defensively for future view changes).
      const cohortSizes = new Map<string, number>();
      for (const r of dataMonthly) {
        const cur = cohortSizes.get(r.cohort_month) ?? 0;
        if (r.cohort_size_month > cur) cohortSizes.set(r.cohort_month, r.cohort_size_month);
      }
      const allCohorts = Array.from(cohortSizes.keys()).sort();
      const nonSparse = allCohorts.filter(c => (cohortSizes.get(c) ?? 0) >= SPARSE_MIN_COHORT_SIZE);
      const visible = nonSparse.length > 0 ? nonSparse : allCohorts;
      const chosen = new Set(visible.slice(-MAX_COHORT_LINES));
      const byCohort = new Map<string, RetentionMonthlyRow[]>();
      for (const r of dataMonthly.filter(r => chosen.has(r.cohort_month))) {
        if (!byCohort.has(r.cohort_month)) byCohort.set(r.cohort_month, []);
        byCohort.get(r.cohort_month)!.push(r);
      }
      return Array.from(byCohort.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([cohort, rows], i) => ({ cohort, rows, color: palette[i % palette.length] }));
    }
    // Weekly (day or week grain).
    const byCohort = new Map<string, RetentionRow[]>();
    for (const r of visibleRows) {
      if (!byCohort.has(r.cohort_week)) byCohort.set(r.cohort_week, []);
      byCohort.get(r.cohort_week)!.push(r);
    }
    return Array.from(byCohort.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cohort, rows], i) => ({ cohort, rows, color: palette[i % palette.length] }));
  });

  // Chart x-axis key, label, tooltip key depend on grain.
  const xKey    = $derived(grain === 'month' ? 'period_months' : 'period_weeks');
  const xLabel  = $derived(grain === 'month' ? 'Months since first visit' : 'Weeks since first visit');
  const xTipKey = $derived(grain === 'month' ? 'Month' : 'Week');

  // X-axis domain cap — 12 months or 52 weeks. Points past the cap don't render.
  const xDomainMax = $derived(grain === 'month' ? MAX_PERIOD_MONTHS : MAX_PERIOD_WEEKS);
</script>

<div data-testid="cohort-card" class="rounded-xl border border-zinc-200 bg-white p-4">
  <!-- Card header -->
  <div class="flex items-center justify-between gap-2">
    <h2 class="text-base font-semibold text-zinc-900">Retention rate by acquisition cohort</h2>
  </div>

  {#if showClampHint}
    <!-- D-17: cohort weekly-clamp hint — byte-identical copy across VA-06/09/10. -->
    <p
      data-testid="cohort-clamp-hint"
      class="mt-2 text-xs text-amber-600"
    >
      Cohort view shows weekly — other grains not applicable.
    </p>
  {/if}

  {#if allSparse && series.length > 0}
    <!-- Sparse hint: shown when all visible cohorts are below SPARSE_MIN_COHORT_SIZE (D-14) -->
    <p
      data-testid="sparse-hint"
      class="mt-2 text-xs text-amber-600"
    >
      Cohort sizes are small — retention lines may swing a lot. Give it a few more weeks of data.
    </p>
  {/if}

  {#if series.length === 0}
    <EmptyState card="cohort" />
  {:else}
    <div class="mt-4 h-64 chart-touch-safe">
      <!-- layerchart 2.x: explicit D3 scales (string presets removed in 2.x).
           xDomain capped at MAX_PERIOD_* so the chart doesn't trail off past
           the readable window on a 375px phone. -->
      <Chart
        data={series.flatMap((s, i) => s.rows.map(r => ({ ...r, cohortLabel: s.cohort, color: palette[i % palette.length] })))}
        x={xKey}
        y="retention_rate"
        xScale={scaleLinear()}
        yScale={scaleLinear()}
        xDomain={[0, xDomainMax]}
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
</div>
