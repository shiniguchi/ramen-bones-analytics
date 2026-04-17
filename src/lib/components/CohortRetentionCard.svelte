<script lang="ts">
  // CohortRetentionCard — cohort retention curves via LayerChart Spline (D-11..D-15).
  // Props: data only (from retention_curve_v).
  // NO range prop — this card is chip-independent (D-04 / Pitfall 6).
  // Phase 9: GrainToggle moved to FilterBar (D-14).
  // quick-260417-mfo: grain-aware — day shows weekly+hint, week shows weekly,
  // month re-buckets weekly rows into monthly cohorts (weighted average) and
  // surfaces an "approximated" note.
  import { Chart, Svg, Axis, Spline, Highlight, Tooltip } from 'layerchart';
  import { scaleLinear } from 'd3-scale';
  import EmptyState from './EmptyState.svelte';
  import { pickVisibleCohorts, type RetentionRow } from '$lib/sparseFilter';
  import { getFilters } from '$lib/dashboardStore.svelte';

  let { data }: { data: RetentionRow[] } = $props();

  // Chart palette for ≤4 cohort lines (375px legible).
  const palette = ['#2563eb', '#0891b2', '#7c3aed', '#db2777'];

  // Reactive grain — drives all branching below.
  const grain = $derived(getFilters().grain);

  // D-17: day-grain clamp hint. Copy is byte-identical to VA-09/VA-10 per the
  // Phase 10-07 contract ("Cohort view shows weekly — other grains not applicable.")
  // so the three cohort-semantic cards stay visually in sync.
  const showClampHint = $derived(grain === 'day');
  // Monthly approximation notice — surfaced because weekly rows are re-bucketed
  // client-side by dividing period_weeks by 4.33; not a true monthly cohort.
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

  // Sparse hint only meaningful on weekly paths — month branch pre-buckets
  // into ≤4 series internally so "all sparse" isn't computed there.
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

  {#if showMonthNote}
    <!-- Monthly re-bucket disclaimer — weekly rows divided by 4.33, weighted avg. -->
    <p
      data-testid="cohort-month-note"
      class="mt-2 text-xs text-zinc-400"
    >
      Monthly cohorts approximated from weekly data.
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
    <div class="mt-4 h-64">
      <!-- layerchart 2.x: explicit D3 scales (string presets removed in 2.x) -->
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
</div>
