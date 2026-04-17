<script lang="ts">
  // VA-05: Calendar customer counts — same stacked-bar shape as revenue card,
  // tx_count metric instead of revenue_cents. Title + testid differ only.
  // D-06 gradient + D-07 cash segment + D-08 shared legend.
  import { BarChart } from 'layerchart';
  import EmptyState from './EmptyState.svelte';
  import VisitSeqLegend from './VisitSeqLegend.svelte';
  import { VISIT_SEQ_COLORS, CASH_COLOR } from '$lib/chartPalettes';
  import {
    getFiltered,
    getFilters,
    aggregateByBucketAndVisitSeq,
    shapeForChart,
    formatBucketLabel,
    computeChartWidth,
    MAX_X_TICKS
  } from '$lib/dashboardStore.svelte';

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

  let cardW = $state(0);
  const chartW = $derived(computeChartWidth(chartData.length, cardW));
</script>

<div data-testid="calendar-counts-card" class="rounded-xl border border-zinc-200 bg-white p-4">
  <h2 class="text-base font-semibold text-zinc-900">Customers by visit</h2>
  {#if chartData.length === 0}
    <EmptyState card="calendar-counts" />
  {:else}
    <div bind:clientWidth={cardW} class="mt-4 h-64 overflow-x-auto">
      <BarChart
        data={chartData}
        x="bucket"
        {series}
        seriesLayout="stack"
        orientation="vertical"
        bandPadding={0.2}
        width={chartW}
        props={{ xAxis: { ticks: MAX_X_TICKS } }}
      />
    </div>
    <VisitSeqLegend {showCash} />
  {/if}
</div>
