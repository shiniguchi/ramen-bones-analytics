<script lang="ts">
  // VA-04: Calendar revenue — stacked bars by visit_seq bucket per grain.
  // D-06 sequential blue gradient + D-07 cash 9th segment + D-08 gradient legend.
  // LayerChart 2.x high-level BarChart — verified props in node_modules/layerchart.
  // Self-subscribes to dashboardStore via getter calls inside $derived.by() —
  // same pattern as KpiTile. No prop-drilling of data/grain/filters.
  import { Chart, Svg, Axis, Bars, Spline, Text, Tooltip } from 'layerchart';
  import { formatEUR } from '$lib/format';
  import EmptyState from './EmptyState.svelte';
  import VisitSeqLegend from './VisitSeqLegend.svelte';
  import { VISIT_SEQ_COLORS, CASH_COLOR } from '$lib/chartPalettes';
  import { formatEURShort } from '$lib/format';
  import { bandCenterX, bucketTotals, bucketTrend } from '$lib/trendline';
  import {
    getFiltered,
    getFilters,
    aggregateByBucketAndVisitSeq,
    shapeForChart,
    formatBucketLabel,
    computeChartWidth,
    MAX_X_TICKS
  } from '$lib/dashboardStore.svelte';

  // Stack order = series array order. Light (1st) at bottom, dark (8x+) at top (D-06).
  const VISIT_KEYS = ['1st', '2nd', '3rd', '4x', '5x', '6x', '7x', '8x+'] as const;
  // Every numeric column emitted by shapeForChart for the revenue_cents metric
  // (all visit_seq buckets + the cash segment). Driven by the same stacked shape
  // produced upstream in dashboardStore.svelte.ts shapeForChart.
  const SERIES_KEYS = [...VISIT_KEYS, 'cash'] as const;

  const chartData = $derived.by(() => {
    const filtered = getFiltered();
    const grain = getFilters().grain as 'day' | 'week' | 'month';
    const nested = aggregateByBucketAndVisitSeq(filtered, grain);
    // shapeForChart emits integer CENTS for every series column. Convert each
    // column to EUR integer here so the Y-axis renders euros, not raw cents.
    return shapeForChart(nested, 'revenue_cents').map((r) => {
      const row: Record<string, string | number> = {
        ...r,
        bucket: formatBucketLabel(r.bucket as string, grain)
      };
      for (const k of SERIES_KEYS) {
        const v = r[k];
        row[k] = typeof v === 'number' ? Math.round(v / 100) : 0;
      }
      return row;
    });
  });

  // Dynamic series list respects the cash filter:
  //  - 'card'  → 8 visit_seq series only (hide cash 9th)
  //  - 'cash'  → cash series only (hide all visit_seq)
  //  - 'all'   → 9 series (default)
  const series = $derived.by(() => {
    const cashFilter = getFilters().is_cash;
    const visitSeries = VISIT_KEYS.map((key, i) => ({
      key,
      label: key,
      color: VISIT_SEQ_COLORS[i]
    }));
    if (cashFilter === 'card') return visitSeries;
    if (cashFilter === 'cash') return [{ key: 'cash', label: 'Cash', color: CASH_COLOR }];
    return [...visitSeries, { key: 'cash', label: 'Cash', color: CASH_COLOR }];
  });

  const showCash = $derived(getFilters().is_cash !== 'card');

  // Series keys currently visible (drives the trend-line sum).
  const visibleKeys = $derived(series.map(s => s.key));
  const trendData = $derived(bucketTrend(chartData, 'bucket', visibleKeys));
  const totals = $derived(bucketTotals(chartData, visibleKeys));

  // Scroll overflow: when bars don't fit at mobile width, force a wider chart
  // and let the wrapper scroll horizontally. Stays responsive for short ranges.
  let cardW = $state(0);
  const chartW = $derived(computeChartWidth(chartData.length, cardW));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let chartCtx = $state<any>();
</script>

<div data-testid="calendar-revenue-card" class="rounded-xl border border-zinc-200 bg-white p-4">
  <h2 class="text-base font-semibold text-zinc-900">Revenue per period — by visit number</h2>
  {#if chartData.length === 0}
    <EmptyState card="calendar-revenue" />
  {:else}
    <div bind:clientWidth={cardW} class="mt-4 h-64 overflow-x-auto overscroll-x-contain chart-touch-safe">
      <Chart
        bind:context={chartCtx}
        data={chartData}
        x="bucket"
        {series}
        seriesLayout="stack"
        bandPadding={0.2}
        valueAxis="y"
        width={chartW}
        padding={{ left: 40, right: 8, top: 24, bottom: 24 }}
        tooltipContext={{ mode: 'band', touchEvents: 'auto' }}
      >
        <Svg>
          <Axis placement="left" format={formatEURShort} grid rule />
          <Axis placement="bottom" ticks={MAX_X_TICKS} rule />
          {#each series as s, i (s.key)}
            <Bars
              seriesKey={s.key}
              rounded={i !== series.length - 1 ? 'none' : 'edge'}
              radius={4}
              strokeWidth={1}
            />
          {/each}
          {#if trendData.length >= 2}
            <Spline
              data={trendData}
              x="bucket"
              y="trend"
              class="stroke-zinc-900 stroke-[1.5] opacity-70"
              stroke-dasharray="3 3"
            />
          {/if}
          {#each chartData as row, i (row.bucket)}
            {#if totals[i] > 0 && chartCtx}
              <Text
                x={bandCenterX(chartCtx.xScale, row.bucket)}
                y={(chartCtx.yScale(totals[i]) ?? 0) - 6}
                value={formatEURShort(totals[i])}
                textAnchor="middle"
                class="pointer-events-none fill-zinc-700 text-[10px] font-medium"
              />
            {/if}
          {/each}
        </Svg>
        <Tooltip.Root>
          {#snippet children({ data: row })}
            {@const bucketIdx = chartData.findIndex((r) => r.bucket === row?.bucket)}
            {@const fullRow = bucketIdx >= 0 ? chartData[bucketIdx] : row}
            <Tooltip.Header>{fullRow?.bucket}</Tooltip.Header>
            <Tooltip.List>
              {#each series as s (s.key)}
                {#if ((fullRow?.[s.key] as number) ?? 0) > 0}
                  <Tooltip.Item label={s.label} color={s.color} value={formatEUR((fullRow[s.key] as number) * 100)} />
                {/if}
              {/each}
              <Tooltip.Item label="Total" value={formatEUR((bucketIdx >= 0 ? totals[bucketIdx] : 0) * 100)} />
            </Tooltip.List>
          {/snippet}
        </Tooltip.Root>
      </Chart>
    </div>
    <VisitSeqLegend {showCash} />
  {/if}
</div>
