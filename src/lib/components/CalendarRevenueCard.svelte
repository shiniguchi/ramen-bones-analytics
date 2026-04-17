<script lang="ts">
  // VA-04: Calendar revenue — stacked bars by visit_seq bucket per grain.
  // D-06 sequential blue gradient + D-07 cash 9th segment + D-08 gradient legend.
  // LayerChart 2.x high-level BarChart — verified props in node_modules/layerchart.
  // Self-subscribes to dashboardStore via getter calls inside $derived.by() —
  // same pattern as KpiTile. No prop-drilling of data/grain/filters.
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

  // Stack order = series array order. Light (1st) at bottom, dark (8x+) at top (D-06).
  const VISIT_KEYS = ['1st', '2nd', '3rd', '4x', '5x', '6x', '7x', '8x+'] as const;

  const chartData = $derived.by(() => {
    const filtered = getFiltered();
    const grain = getFilters().grain as 'day' | 'week' | 'month';
    const nested = aggregateByBucketAndVisitSeq(filtered, grain);
    return shapeForChart(nested, 'revenue_cents').map((r) => ({
      ...r,
      bucket: formatBucketLabel(r.bucket as string, grain)
    }));
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

  // Scroll overflow: when bars don't fit at mobile width, force a wider chart
  // and let the wrapper scroll horizontally. Stays responsive for short ranges.
  let cardW = $state(0);
  const chartW = $derived(computeChartWidth(chartData.length, cardW));
</script>

<div data-testid="calendar-revenue-card" class="rounded-xl border border-zinc-200 bg-white p-4">
  <h2 class="text-base font-semibold text-zinc-900">Revenue by visit</h2>
  {#if chartData.length === 0}
    <EmptyState card="calendar-revenue" />
  {:else}
    <div bind:clientWidth={cardW} class="mt-4 h-64 overflow-x-auto touch-pan-x overscroll-x-contain">
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
