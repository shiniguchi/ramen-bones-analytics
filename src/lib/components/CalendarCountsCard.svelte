<script lang="ts">
  // VA-05: Calendar customer counts — same stacked-bar shape as revenue card,
  // tx_count metric instead of revenue_cents. Title + testid differ only.
  // D-06 gradient + D-07 cash segment + D-08 shared legend.
  import { Chart, Svg, Axis, Bars, Spline, Text, Tooltip } from 'layerchart';
  import { page } from '$app/state';
  import { t } from '$lib/i18n/messages';
  import EmptyState from './EmptyState.svelte';
  import VisitSeqLegend from './VisitSeqLegend.svelte';
  import { VISIT_SEQ_COLORS, CASH_COLOR } from '$lib/chartPalettes';
  import { formatIntShort } from '$lib/format';
  import { bandCenterX, bucketTotals, bucketTrend } from '$lib/trendline';
  import {
    getFiltered,
    getFilters,
    getWindow,
    aggregateByBucketAndVisitSeq,
    shapeForChart,
    formatBucketLabel,
    bucketRange,
    computeChartWidth,
    MAX_X_TICKS
  } from '$lib/dashboardStore.svelte';

  const yAxisFormat = (n: number) => formatIntShort(n, 'txn');

  const VISIT_KEYS = ['1st', '2nd', '3rd', '4x', '5x', '6x', '7x', '8x+'] as const;

  const chartData = $derived.by(() => {
    const filtered = getFiltered();
    const grain = getFilters().grain as 'day' | 'week' | 'month';
    const w = getWindow();
    const nested = aggregateByBucketAndVisitSeq(filtered, grain);
    return shapeForChart(nested, 'tx_count', bucketRange(w.from, w.to, grain)).map((r) => ({
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let chartCtx = $state<any>();
</script>

<div data-testid="calendar-counts-card" class="rounded-xl border border-zinc-200 bg-white p-4">
  <h2 class="text-base font-semibold text-zinc-900">{t(page.data.locale, 'cal_counts_title')}</h2>
  {#if getFiltered().length === 0}
    <EmptyState card="calendar-counts" />
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
        padding={{ left: 64, right: 8, top: 24, bottom: 24 }}
        tooltipContext={{ mode: 'band', touchEvents: 'auto' }}
      >
        <Svg>
          <Axis placement="left" format={yAxisFormat} grid rule />
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
                value={formatIntShort(totals[i])}
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
                  <Tooltip.Item label={s.label} color={s.color} value={`${fullRow[s.key]} ${t(page.data.locale, 'txn_suffix')}`} />
                {/if}
              {/each}
              <Tooltip.Item label={t(page.data.locale, 'tooltip_total')} value={`${bucketIdx >= 0 ? totals[bucketIdx] : 0} ${t(page.data.locale, 'txn_suffix')}`} />
            </Tooltip.List>
          {/snippet}
        </Tooltip.Root>
      </Chart>
    </div>
    <VisitSeqLegend {showCash} />
  {/if}
</div>
