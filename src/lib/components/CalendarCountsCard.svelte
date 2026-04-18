<script lang="ts">
  // VA-05: Calendar customer counts — same stacked-bar shape as revenue card,
  // tx_count metric instead of revenue_cents. Title + testid differ only.
  // D-06 gradient + D-07 cash segment + D-08 shared legend.
  import { BarChart, Bars, Spline, Text, Tooltip } from 'layerchart';
  import EmptyState from './EmptyState.svelte';
  import VisitSeqLegend from './VisitSeqLegend.svelte';
  import { VISIT_SEQ_COLORS, CASH_COLOR } from '$lib/chartPalettes';
  import { formatIntShort } from '$lib/format';
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

  const yAxisFormat = (n: number) => formatIntShort(n, 'txn');

  const VISIT_KEYS = ['1st', '2nd', '3rd', '4x', '5x', '6x', '7x', '8x+'] as const;

  const chartData = $derived.by(() => {
    const filtered = getFiltered();
    const grain = getFilters().grain as 'day' | 'week' | 'month';
    const nested = aggregateByBucketAndVisitSeq(filtered, grain);
    return shapeForChart(nested, 'tx_count').map((r) => ({
      ...r,
      bucket: formatBucketLabel(r.bucket as string, grain)
    }));
  });

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

  const visibleKeys = $derived(series.map(s => s.key));
  const trendData = $derived(bucketTrend(chartData, 'bucket', visibleKeys));
  const totals = $derived(bucketTotals(chartData, visibleKeys));

  let cardW = $state(0);
  const chartW = $derived(computeChartWidth(chartData.length, cardW));
</script>

<div data-testid="calendar-counts-card" class="rounded-xl border border-zinc-200 bg-white p-4">
  <h2 class="text-base font-semibold text-zinc-900">Transactions per period — by visit number</h2>
  {#if chartData.length === 0}
    <EmptyState card="calendar-counts" />
  {:else}
    <div bind:clientWidth={cardW} class="mt-4 h-64 overflow-x-auto overscroll-x-contain chart-touch-safe">
      <BarChart
        data={chartData}
        x="bucket"
        {series}
        seriesLayout="stack"
        orientation="vertical"
        bandPadding={0.2}
        width={chartW}
        padding={{ left: 64, right: 8, top: 24, bottom: 24 }}
        props={{ xAxis: { ticks: MAX_X_TICKS }, yAxis: { format: yAxisFormat } }}
        tooltipContext={{ touchEvents: 'auto' }}
      >
        {#snippet marks({ context })}
          {#each context.series.visibleSeries as s, i (s.key)}
            <Bars
              seriesKey={s.key}
              rounded={context.series.isStacked && i !== context.series.visibleSeries.length - 1 ? 'none' : 'edge'}
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
            {#if totals[i] > 0}
              <Text
                x={bandCenterX(context.xScale, row.bucket)}
                y={(context.yScale(totals[i]) ?? 0) - 6}
                value={formatIntShort(totals[i])}
                textAnchor="middle"
                class="pointer-events-none fill-zinc-700 text-[10px] font-medium"
              />
            {/if}
          {/each}
        {/snippet}
        <Tooltip.Root>
          {#snippet children({ data: row })}
            <Tooltip.Header>{row.bucket}</Tooltip.Header>
            <Tooltip.List>
              {#each series as s (s.key)}
                {#if ((row[s.key] as number) ?? 0) > 0}
                  <Tooltip.Item label={s.label} value={`${row[s.key]} txn`} />
                {/if}
              {/each}
              <Tooltip.Item label="Total" value={`${totals[chartData.indexOf(row)] ?? 0} txn`} />
            </Tooltip.List>
          {/snippet}
        </Tooltip.Root>
      </BarChart>
    </div>
    <VisitSeqLegend {showCash} />
  {/if}
</div>
