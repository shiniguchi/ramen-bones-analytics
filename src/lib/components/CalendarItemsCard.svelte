<script lang="ts">
  // VA-08: Calendar order item counts — stacked bars by item_name per grain.
  // Top-8 + "Other" rollup computed client-side per D-14 (window-dependent).
  // Metric = COUNT (D-16). Palette: schemeTableau10 slice + gray "Other" (D-15, D-07).
  //
  // Filters respected: sales_type + is_cash (via client-side filter on the prop)
  // and grain (via bucketKey rebucket). Range is already applied upstream by the
  // SSR query in Plan 10-08.
  import { LineChart } from 'layerchart';
  import EmptyState from './EmptyState.svelte';
  import { ITEM_COLORS, OTHER_COLOR } from '$lib/chartPalettes';
  import { rollupTopNWithOther } from '$lib/itemCountsRollup';
  import { formatIntShort } from '$lib/format';
  import { bucketKey, getFilters, formatBucketLabel, computeChartWidth, MAX_X_TICKS } from '$lib/dashboardStore.svelte';
  import { integerTicks } from '$lib/trendline';

  const yAxisFormat = (n: number) => formatIntShort(n, 'items');

  type ItemCountRow = {
    business_date: string;
    item_name: string;
    sales_type: string | null;
    is_cash: boolean;
    item_count: number;
  };

  let { data }: { data: ItemCountRow[] } = $props();

  // Apply client-side filters — mirrors dashboardStore.filterRows but for ItemCountRow shape.
  const filtered = $derived.by(() => {
    const f = getFilters();
    return data.filter(r => {
      if (f.sales_type !== 'all' && r.sales_type !== f.sales_type) return false;
      if (f.is_cash === 'cash' && !r.is_cash) return false;
      if (f.is_cash === 'card' && r.is_cash) return false;
      return true;
    });
  });

  // Pick top-20 items by total item_count across the filtered window (Pass 4 Item #1).
  const topItems = $derived.by(() => {
    const totals = new Map<string, number>();
    for (const r of filtered) {
      totals.set(r.item_name, (totals.get(r.item_name) ?? 0) + r.item_count);
    }
    const rows = Array.from(totals.entries()).map(([item_name, item_count]) => ({ item_name, item_count }));
    const rolled = rollupTopNWithOther(rows, 20);
    return rolled.map(r => r.item_name); // ordered item names (top-20 + maybe 'Other')
  });

  // Build wide-format chart data: one row per bucket with columns for each topItem + Other.
  const chartData = $derived.by(() => {
    const grain = getFilters().grain as 'day' | 'week' | 'month';
    const topSet = new Set(topItems.filter(n => n !== 'Other'));
    const bucketMap = new Map<string, Record<string, number | string>>();
    for (const r of filtered) {
      const bucket = bucketKey(r.business_date, grain);
      let row = bucketMap.get(bucket);
      if (!row) {
        row = { bucket };
        bucketMap.set(bucket, row);
      }
      const col = topSet.has(r.item_name) ? r.item_name : 'Other';
      row[col] = ((row[col] as number) ?? 0) + r.item_count;
    }
    // Zero-fill missing series keys for each bucket row — LayerChart stack math
    // can render hairline gaps when a key is missing on one bucket but present on another.
    return Array.from(bucketMap.values()).map(row => {
      for (const name of topItems) {
        if (!(name in row)) row[name] = 0;
      }
      return row;
    })
      .sort((a, b) => String(a.bucket).localeCompare(String(b.bucket)))
      .map(row => ({ ...row, bucket: formatBucketLabel(row.bucket as string, grain) }));
  });

  // Series config: ITEM_COLORS for top-8, OTHER_COLOR for "Other".
  const series = $derived.by(() =>
    topItems.map((name, i) => ({
      key: name,
      label: name,
      color: name === 'Other' ? OTHER_COLOR : ITEM_COLORS[i % ITEM_COLORS.length]
    }))
  );

  // Force integer y-axis ticks — per-item per-bucket counts can be 0..5,
  // where d3's default fractional ticks (0, 0.2, 0.4, 0.6, 0.8, 1) all
  // compact-format to "0 items". Explicit integer tick array prevents that.
  const yMax = $derived.by(() => {
    let m = 0;
    for (const row of chartData) {
      for (const k of topItems) {
        const v = (row as Record<string, unknown>)[k];
        if (typeof v === 'number' && v > m) m = v;
      }
    }
    return m;
  });
  const yTicks = $derived(integerTicks(yMax));

  let cardW = $state(0);
  const chartW = $derived(computeChartWidth(chartData.length, cardW));
</script>

<div data-testid="calendar-items-card" class="rounded-xl border border-zinc-200 bg-white p-4">
  <h2 class="text-base font-semibold text-zinc-900">Items sold per period — top 20 menu items</h2>
  <p class="mt-1 text-xs text-zinc-500">One line per item so you can spot what's trending up or down. Rest grouped as "Other".</p>
  {#if chartData.length === 0}
    <EmptyState card="calendar-items" />
  {:else}
    <div bind:clientWidth={cardW} class="mt-4 h-64 overflow-x-auto touch-auto overscroll-x-contain chart-touch-safe">
      <LineChart
        data={chartData}
        x="bucket"
        {series}
        width={chartW}
        padding={{ left: 40, right: 8, top: 8, bottom: 24 }}
        yDomain={[0, Math.max(1, yMax)]}
        props={{ xAxis: { ticks: MAX_X_TICKS }, yAxis: { format: yAxisFormat, ticks: yTicks } }}
        tooltipContext={{ touchEvents: 'auto' }}
      />
    </div>
  {/if}
</div>
