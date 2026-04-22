<script lang="ts">
  // CohortRetentionCard — cohort retention curves + north-star benchmark overlay.
  //
  // Layers (back→front):
  //   1. Benchmark band (Area): lower_p20..upper_p80 shaded amber
  //   2. Benchmark mid (Spline): weighted P50, dashed amber
  //   3. Benchmark anchors (Points): tappable dots at W1/W4/W12/W26/W52 (or monthly equivalents)
  //   4. Cohort splines: the restaurant's actual data (front layer)
  //   5. Highlight: LayerChart's hover guide
  //
  // quick-260418-28j Pass 2 established monthly SQL-side cohorts.
  // quick-260418-bm4 layers the curated north-star benchmark on top.
  import { Chart, Svg, Axis, Spline, Highlight, Tooltip, Area, Points } from 'layerchart';
  import { scaleLinear } from 'd3-scale';
  import { curveStepAfter } from 'd3-shape';
  import EmptyState from './EmptyState.svelte';
  import NorthStarSourcePopover, { type BenchmarkSourceRow } from './NorthStarSourcePopover.svelte';
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
  import { interpolateBenchmark, type BenchmarkAnchor } from '$lib/benchmarkInterp';

  let {
    dataWeekly,
    dataMonthly,
    benchmarkAnchors = [],
    benchmarkSources = [],
    monthsOfHistory = 0
  }: {
    dataWeekly: RetentionRow[];
    dataMonthly: RetentionMonthlyRow[];
    benchmarkAnchors?: BenchmarkAnchor[];
    benchmarkSources?: BenchmarkSourceRow[];
    // Phase 11-02 D-04 no-regression: derived client-side from the /api/retention
    // weekly payload in +page.svelte, then fed here as a reactive prop so the
    // clamp/caveat copy continues to render with the correct N once the deferred
    // fetch resolves. Defaults to 0 so existing callers that don't pass it work.
    monthsOfHistory?: number;
  } = $props();

  const palette = COHORT_LINE_PALETTE;

  // Reactive grain drives the chart rendering. quick-260420-wdf: interp toggle
  // retired — benchmark curve is hardcoded to log-linear (matches cold-cohort
  // decay shape better than linear between public-source anchors).
  const grain = $derived(getFilters().grain);
  const dayFilterActive = $derived(getFilters().days.length !== 7);

  const showClampHint = $derived(grain === 'day');

  const visibleRows = $derived(pickVisibleCohorts(dataWeekly));

  const allSparse = $derived.by(() => {
    if (dataWeekly.length === 0 || grain === 'month') return false;
    const sizes = new Map<string, number>();
    for (const r of dataWeekly) {
      const cur = sizes.get(r.cohort_week) ?? 0;
      if (r.cohort_size_week > cur) sizes.set(r.cohort_week, r.cohort_size_week);
    }
    return Array.from(sizes.values()).every(s => s < SPARSE_MIN_COHORT_SIZE);
  });

  // Cohort series (unchanged from prior versions).
  const series = $derived.by(() => {
    if (grain === 'month') {
      if (dataMonthly.length === 0) return [];
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
    const byCohort = new Map<string, RetentionRow[]>();
    for (const r of visibleRows) {
      if (!byCohort.has(r.cohort_week)) byCohort.set(r.cohort_week, []);
      byCohort.get(r.cohort_week)!.push(r);
    }
    return Array.from(byCohort.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cohort, rows], i) => ({ cohort, rows, color: palette[i % palette.length] }));
  });

  // Benchmark series — interpolated for the current grain + interp mode.
  // Restricted to MONTHLY grain: no public source reports cold-cohort
  // restaurant retention at weekly resolution, so interpolating W0=100%
  // down to M1 across 4 weeks invents values that don't exist (e.g. 78%
  // "active in week 1" when the true cold-cohort rate is 5-10%).
  const benchmarkSeries = $derived.by(() => {
    if (grain !== 'month') return [];
    return interpolateBenchmark(benchmarkAnchors, 'log-linear', 'month');
  });
  const benchmarkAnchorsOnly = $derived(benchmarkSeries.filter(p => p.isAnchor && p.period > 0));
  const hasBenchmark = $derived(benchmarkSeries.length > 0);

  const xKey    = $derived(grain === 'month' ? 'period_months' : 'period_weeks');
  const xLabel  = $derived(grain === 'month' ? 'Months since first visit' : 'Weeks since first visit');
  const xTipKey = $derived(grain === 'month' ? 'Month' : 'Week');
  const xDomainMax = $derived(grain === 'month' ? MAX_PERIOD_MONTHS : MAX_PERIOD_WEEKS);

  // Popover state.
  let popoverOpen = $state(false);
  let popoverPeriod = $state(0);
  const popoverAnchor = $derived.by(() => {
    if (!popoverOpen) return null;
    // Find the DB anchor whose unit matches popoverPeriod under current grain.
    // For monthly grain, map period_months back to period_weeks via canonical mapping.
    const periodWeeks = grain === 'month'
      ? ({ 1: 4, 3: 12, 6: 26, 12: 52 } as Record<number, number>)[popoverPeriod]
      : popoverPeriod;
    if (periodWeeks === undefined) return null;
    return benchmarkAnchors.find(a => a.period_weeks === periodWeeks) ?? null;
  });
  const popoverSources = $derived.by(() => {
    if (!popoverOpen) return [];
    const periodWeeks = grain === 'month'
      ? ({ 1: 4, 3: 12, 6: 26, 12: 52 } as Record<number, number>)[popoverPeriod]
      : popoverPeriod;
    if (periodWeeks === undefined) return [];
    return benchmarkSources.filter(s => s.period_weeks === periodWeeks);
  });
  const popoverLabel = $derived(
    grain === 'month'
      ? `Month ${popoverPeriod}`
      : `Week ${popoverPeriod}`
  );

  function onAnchorClick(period: number) {
    popoverPeriod = period;
    popoverOpen = true;
  }
</script>

<div data-testid="cohort-card" class="rounded-xl border border-zinc-200 bg-white p-4">
  <!-- Card header -->
  <div class="flex items-center justify-between gap-2">
    <div class="flex items-baseline gap-2">
      <h2 class="text-base font-semibold text-zinc-900">Retention rate by acquisition grouping</h2>
      {#if showClampHint}
        <span
          data-testid="cohort-clamp-hint"
          class="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
          title={`Daily cohorts have too few repeat customers to chart (min ${SPARSE_MIN_COHORT_SIZE}). Showing weekly cohorts instead.`}
        >Weekly view</span>
      {/if}
    </div>
  </div>

  {#if dayFilterActive}
    <p
      data-testid="cohort-day-filter-caveat"
      class="mt-1 text-[11px] text-amber-600"
    >
      Day filter does not apply to cohort retention — cohorts use all days.
    </p>
  {/if}

  {#if monthsOfHistory > 0 && monthsOfHistory < 3}
    <p
      data-testid="cohort-months-of-history"
      class="mt-2 text-xs text-zinc-500"
    >
      Only {monthsOfHistory} {monthsOfHistory === 1 ? 'month' : 'months'} of history — cohort curves will stabilize with more data.
    </p>
  {/if}

  {#if allSparse && series.length > 0}
    <p
      data-testid="sparse-hint"
      class="mt-2 text-xs text-amber-600"
    >
      Group sizes are small — retention lines may swing a lot. Give it a few more weeks of data.
    </p>
  {/if}

  {#if series.length === 0 && !hasBenchmark}
    <EmptyState card="cohort" />
  {:else}
    <div class="mt-4 h-64 chart-touch-safe">
      <Chart
        data={series.flatMap((s, i) => s.rows.map(r => ({ ...r, cohortLabel: s.cohort, color: palette[i % palette.length] })))}
        x={xKey}
        y="retention_rate"
        xScale={scaleLinear()}
        yScale={scaleLinear()}
        xDomain={[0, xDomainMax]}
        yDomain={[0, 1]}
        padding={{ left: 32, bottom: 24, top: 8, right: 8 }}
        tooltipContext={{ mode: 'bisect-x', touchEvents: 'auto' }}
      >
        <Svg>
          <!-- Benchmark band + mid (back layers — drawn first) -->
          {#if hasBenchmark}
            <Area
              data={benchmarkSeries}
              x={(d: { period: number }) => d.period}
              y0={(d: { lower: number }) => d.lower}
              y1={(d: { upper: number }) => d.upper}
              curve={curveStepAfter}
              fill="#fbbf24"
              fillOpacity={0.18}
            />
            <Spline
              data={benchmarkSeries}
              x={(d: { period: number }) => d.period}
              y={(d: { mid: number }) => d.mid}
              curve={curveStepAfter}
              stroke="#d97706"
              stroke-width={2}
              stroke-dasharray="6 3"
            />
          {/if}

          <!-- Axes + cohort lines -->
          <Axis placement="left" format={(v: number) => `${Math.round(v * 100)}%`} grid />
          <Axis placement="bottom" label={xLabel} />
          {#each series as s, i}
            <Spline
              data={s.rows}
              x={xKey}
              y="retention_rate"
              curve={curveStepAfter}
              class="stroke-2"
              stroke={palette[i % palette.length]}
            />
          {/each}
          <Highlight points lines />

          <!-- Benchmark anchor dots — rendered LAST so they sit on top of
               cohort splines and are tappable. Each visible dot has an
               invisible r=18 hit circle so mobile taps land reliably. -->
          {#if hasBenchmark}
            <Points
              data={benchmarkAnchorsOnly}
              x={(d: { period: number }) => d.period}
              y={(d: { mid: number }) => d.mid}
              r={5}
            >
              {#snippet children({ points })}
                {#each points as p}
                  <circle
                    cx={p.x} cy={p.y} r={6}
                    fill="#d97706" stroke="white" stroke-width={2}
                    pointer-events="none"
                  />
                  <!-- Invisible tap target (18px radius = ~36px diameter) -->
                  <circle
                    cx={p.x} cy={p.y} r={18}
                    fill="transparent"
                    class="cursor-pointer"
                    role="button"
                    tabindex="0"
                    aria-label={`View benchmark sources for ${grain === 'month' ? 'month' : 'week'} ${p.xValue}`}
                    onclick={() => onAnchorClick(p.xValue)}
                    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') onAnchorClick(p.xValue); }}
                  />
                {/each}
              {/snippet}
            </Points>
          {/if}
        </Svg>
        <Tooltip.Root contained="window" class="max-w-[92vw]">
          {#snippet children({ data })}
            {@const period = data?.[xKey] as number | undefined}
            {@const rowsAtPeriod = period == null ? [] : series
              .map((s) => {
                const hit = s.rows.find((r) => r[xKey as keyof typeof r] === period);
                if (!hit) return null;
                const size = grain === 'month'
                  ? (hit as RetentionMonthlyRow).cohort_size_month
                  : (hit as RetentionRow).cohort_size_week;
                return { cohort: s.cohort, color: s.color, rate: hit.retention_rate, size };
              })
              .filter((x): x is NonNullable<typeof x> => x !== null && x.rate > 0)
              .sort((a, b) => a.cohort.localeCompare(b.cohort))}
            {@const bmPt = period == null ? null : benchmarkSeries.find(p => p.period === period)}
            <Tooltip.Header>{xTipKey} {period}</Tooltip.Header>
            <Tooltip.List>
              {#if rowsAtPeriod.length === 0 && !bmPt}
                <Tooltip.Item label="No data" value="" />
              {:else}
                {#each rowsAtPeriod as r (r.cohort)}
                  {@const pct = r.rate * 100}
                  {@const pctLabel = pct < 1 ? '<1%' : `${Math.round(pct)}%`}
                  <Tooltip.Item
                    label={r.cohort}
                    color={r.color}
                    value={`${pctLabel} · ${Math.round(r.rate * r.size)} of ${r.size} returned`}
                  />
                {/each}
                {#if bmPt}
                  <Tooltip.Item
                    label={bmPt.isAnchor ? 'North-star (anchor)' : 'North-star'}
                    color="#d97706"
                    value={`${Math.round(bmPt.mid * 100)}% · range ${Math.round(bmPt.lower * 100)}–${Math.round(bmPt.upper * 100)}%`}
                  />
                {/if}
              {/if}
            </Tooltip.List>
          {/snippet}
        </Tooltip.Root>
      </Chart>
    </div>
  {/if}

  <!-- Source-chip affordance — tappable fallback for mobile where chart
       dots can be fiddly. Each chip opens the same popover. -->
  {#if hasBenchmark && benchmarkAnchorsOnly.length > 0}
    <div
      data-testid="benchmark-source-chips"
      class="mt-3 flex flex-wrap items-center gap-1.5 text-xs"
    >
      <span class="text-zinc-500">See sources for:</span>
      {#each benchmarkAnchorsOnly as p (p.period)}
        <button
          type="button"
          onclick={() => onAnchorClick(p.period)}
          class="min-h-9 rounded-md bg-amber-50 px-2.5 py-1 font-medium text-amber-700 ring-1 ring-inset ring-amber-200 hover:bg-amber-100 active:bg-amber-200 transition-colors"
        >
          {grain === 'month' ? 'M' : 'W'}{p.period}
        </button>
      {/each}
    </div>
  {/if}

  <!-- Disclaimer — small grey, below chart -->
  {#if hasBenchmark}
    <p
      data-testid="benchmark-disclaimer"
      class="mt-3 text-[10px] leading-snug text-zinc-400"
    >
      North-star band (monthly grain only): curated for your restaurant using weighted P20/P80 bounds.
      Member-program data divided by 2.5 for cold-cohort parity; cumulative-window sources multiplied by 0.5 for active-in-period semantic.
      Points between M1/M3/M6/M12 anchors are interpolated (log-linear) — no public source reports restaurant retention at weekly resolution, so weekly tab shows your cohorts alone.
    </p>
  {/if}
</div>

<NorthStarSourcePopover
  bind:open={popoverOpen}
  period={popoverPeriod}
  grainLabel={popoverLabel}
  anchor={popoverAnchor
    ? { lower_p20: popoverAnchor.lower_p20, mid_p50: popoverAnchor.mid_p50, upper_p80: popoverAnchor.upper_p80, source_count: popoverSources.length }
    : null}
  sources={popoverSources}
/>
