<script lang="ts">
  // Feedback #4: revenue share per item per period — mirrors CalendarItemsCard
  // structure but uses item_revenue_cents (migration 0029) instead of item_count.
  // Stacked bars = ratio view. Top-20 ranked by REVENUE (not count), rest → "Other".
  // Dashed trend line overlays total revenue per bucket via bucketTrend.
  import { BarChart, Bars, Spline } from 'layerchart';
  import EmptyState from './EmptyState.svelte';
  import { ITEM_COLORS, OTHER_COLOR } from '$lib/chartPalettes';
  import { rollupTopNWithOther } from '$lib/itemCountsRollup';
  import { formatEURShort } from '$lib/format';
  import { bucketTrend } from '$lib/trendline';
  import {
    bucketKey,
    getFilters,
    formatBucketLabel,
    computeChartWidth,
    MAX_X_TICKS
  } from '$lib/dashboardStore.svelte';

  type ItemCountRow = {
    business_date: string;
    item_name: string;
    sales_type: string | null;
    is_cash: boolean;
    item_count: number;
    item_revenue_cents: number;
  };

  let { data }: { data: ItemCountRow[] } = $props();

  const filtered = $derived.by(() => {
    const f = getFilters();
    return data.filter((r) => {
      if (f.sales_type !== 'all' && r.sales_type !== f.sales_type) return false;
      if (f.is_cash === 'cash' && !r.is_cash) return false;
      if (f.is_cash === 'card' && r.is_cash) return false;
      return true;
    });
  });

  // Rank items by total REVENUE across the filtered window. rollupTopNWithOther
  // is generic on the numeric field name — pass item_revenue_cents as item_count.
  const topItems = $derived.by(() => {
    const totals = new Map<string, number>();
    for (const r of filtered) {
      totals.set(r.item_name, (totals.get(r.item_name) ?? 0) + r.item_revenue_cents);
    }
    const rows = Array.from(totals.entries()).map(([item_name, item_count]) => ({
      item_name,
      item_count
    }));
    return rollupTopNWithOther(rows, 20).map((r) => r.item_name);
  });

  const chartData = $derived.by(() => {
    const grain = getFilters().grain as 'day' | 'week' | 'month';
    const topSet = new Set(topItems.filter((n) => n !== 'Other'));
    const bucketMap = new Map<string, Record<string, number | string>>();
    for (const r of filtered) {
      const bucket = bucketKey(r.business_date, grain);
      let row = bucketMap.get(bucket);
      if (!row) {
        row = { bucket };
        bucketMap.set(bucket, row);
      }
      const col = topSet.has(r.item_name) ? r.item_name : 'Other';
      // Convert cents → EUR integers up front so Y-axis is euros.
      row[col] = ((row[col] as number) ?? 0) + Math.round(r.item_revenue_cents / 100);
    }
    return Array.from(bucketMap.values())
      .map((row) => {
        for (const name of topItems) {
          if (!(name in row)) row[name] = 0;
        }
        return row;
      })
      .sort((a, b) => String(a.bucket).localeCompare(String(b.bucket)))
      .map((row) => ({ ...row, bucket: formatBucketLabel(row.bucket as string, grain) }));
  });

  const series = $derived.by(() =>
    topItems.map((name, i) => ({
      key: name,
      label: name,
      color: name === 'Other' ? OTHER_COLOR : ITEM_COLORS[i % ITEM_COLORS.length]
    }))
  );

  const trendData = $derived(bucketTrend(chartData, 'bucket', topItems));

  let cardW = $state(0);
  const chartW = $derived(computeChartWidth(chartData.length, cardW));
</script>

<div
  data-testid="calendar-item-revenue-card"
  class="rounded-xl border border-zinc-200 bg-white p-4"
>
  <h2 class="text-base font-semibold text-zinc-900">Revenue per period — top 20 menu items</h2>
  <p class="mt-1 text-xs text-zinc-500">Share of revenue per period. Rest grouped as "Other".</p>
  {#if chartData.length === 0}
    <EmptyState card="calendar-items" />
  {:else}
    <div
      bind:clientWidth={cardW}
      class="mt-4 h-64 overflow-x-auto overscroll-x-contain chart-touch-safe"
    >
      <BarChart
        data={chartData}
        x="bucket"
        {series}
        seriesLayout="stack"
        orientation="vertical"
        bandPadding={0.2}
        width={chartW}
        padding={{ left: 40, right: 8, top: 8, bottom: 24 }}
        props={{ xAxis: { ticks: MAX_X_TICKS }, yAxis: { format: formatEURShort } }}
        tooltipContext={{ touchEvents: 'auto' }}
      >
        {#snippet marks({ context })}
          {#each context.series.visibleSeries as s, i (s.key)}
            <Bars
              seriesKey={s.key}
              rounded={context.series.isStacked && i !== context.series.visibleSeries.length - 1
                ? 'none'
                : 'edge'}
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
        {/snippet}
      </BarChart>
    </div>
  {/if}
</div>
