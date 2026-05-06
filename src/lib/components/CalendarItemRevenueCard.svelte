<script lang="ts">
  // Feedback #4: revenue share per item per period — mirrors CalendarItemsCard
  // structure but uses item_revenue_cents (migration 0029) instead of item_count.
  // Stacked bars = ratio view. Top-20 ranked by REVENUE (not count), rest → "Other".
  // Dashed trend line overlays total revenue per bucket via bucketTrend.
  import { Chart, Svg, Axis, Bars, Spline, Text, Tooltip } from 'layerchart';
  import { page } from '$app/state';
  import { t } from '$lib/i18n/messages';
  import { formatEUR } from '$lib/format';
  import EmptyState from './EmptyState.svelte';
  import EventBadgeStrip from './EventBadgeStrip.svelte';
  import { ITEM_COLORS, OTHER_COLOR } from '$lib/chartPalettes';
  import { rollupTopNWithOther } from '$lib/itemCountsRollup';
  import { formatEURShort } from '$lib/format';
  import { bandCenterX, bucketTotals, bucketTrend } from '$lib/trendline';
  import {
    bucketKey,
    bucketRange,
    getFilters,
    getWindow,
    formatBucketLabel,
    computeChartWidth,
    MAX_X_TICKS
  } from '$lib/dashboardStore.svelte';
  import { clientFetch } from '$lib/clientFetch';
  import type { ForecastEvent } from '$lib/forecastEventClamp';
  import { parseISO } from 'date-fns';

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
    const daysSet = new Set(f.days);
    return data.filter((r) => {
      if (f.sales_type !== 'all' && r.sales_type !== f.sales_type) return false;
      if (f.is_cash === 'cash' && !r.is_cash) return false;
      if (f.is_cash === 'card' && r.is_cash) return false;
      const dow = ((parseISO(r.business_date).getDay() + 6) % 7) + 1;
      if (!daysSet.has(dow)) return false;
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
    const w = getWindow();
    const topSet = new Set(topItems.filter((n) => n !== 'Other'));
    const bucketMap = new Map<string, Record<string, number | string>>();
    // Zero-fill: pre-seed every expected bucket so periods with no filtered data
    // still render as visible 0 bars (e.g. Mon/Tue when days filter = Wed-Sun).
    for (const bucket of bucketRange(w.from, w.to, grain)) {
      bucketMap.set(bucket, { bucket });
    }
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
      // Phase 16.3: keep raw ISO key as bucket_iso BEFORE replacing `bucket`
      // with the display label — EventBadgeStrip aligns events to bucket dates.
      .map((row) => ({
        ...row,
        bucket_iso: row.bucket as string,
        bucket: formatBucketLabel(row.bucket as string, grain)
      }));
  });

  const series = $derived.by(() =>
    topItems.map((name, i) => ({
      key: name,
      label: name,
      color: name === 'Other' ? OTHER_COLOR : ITEM_COLORS[i % ITEM_COLORS.length]
    }))
  );

  const trendData = $derived(bucketTrend(chartData, 'bucket', topItems));
  const totals = $derived(bucketTotals(chartData, topItems));

  let cardW = $state(0);
  const chartW = $derived(computeChartWidth(chartData.length, cardW));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let chartCtx = $state<any>();

  // Phase 16.3 D-09: actuals-only chart wires EventBadgeStrip via a standalone
  // /api/forecast call reading only the events field. Option (a) per CONTEXT.md.
  let events = $state<ForecastEvent[]>([]);
  let lastFetchedKey: string | null = null;
  $effect(() => {
    const grain = getFilters().grain as 'day' | 'week' | 'month';
    const earliestIso = chartData[0]?.bucket_iso;
    if (!earliestIso) return;
    const rs = earliestIso.length === 7 ? `${earliestIso}-01` : earliestIso;
    const key = `${grain}|${rs}`;
    if (lastFetchedKey === key) return;
    lastFetchedKey = key;
    clientFetch<{ events: ForecastEvent[] }>(
      `/api/forecast?kpi=revenue_eur&granularity=${grain}&range_start=${encodeURIComponent(rs)}`
    )
      .then((d) => { events = d.events ?? []; })
      .catch(() => { events = []; });
  });

  // Phase 16.3 D-02: pixel slots for EventBadgeStrip — caller-owned band-position
  // math. chartW is `number | undefined`; fall back to cardW.
  const stripWidth = $derived(chartW ?? cardW);
  const eventBuckets = $derived.by(() => {
    if (chartData.length === 0 || stripWidth === 0) return [];
    const slotWidth = stripWidth / chartData.length;
    return chartData.map((row, i) => ({
      iso: row.bucket_iso,
      left: i * slotWidth,
      width: slotWidth
    }));
  });
</script>

<div
  data-testid="calendar-item-revenue-card"
  class="rounded-xl border border-zinc-200 bg-white p-4"
>
  <h2 class="text-base font-semibold text-zinc-900">{t(page.data.locale, 'cal_item_revenue_title')}</h2>
  <p class="mt-1 text-xs text-zinc-500 text-balance">{t(page.data.locale, 'cal_item_revenue_description')}</p>
  {#if filtered.length === 0}
    <EmptyState card="calendar-items" />
  {:else}
    <div
      bind:clientWidth={cardW}
      class="mt-4 h-64 overflow-x-auto overscroll-x-contain chart-touch-safe"
    >
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
        <Tooltip.Root contained={false} classes={{ root: "w-48" }}>
          {#snippet children({ data: row })}
            {@const bucketIdx = chartData.findIndex((r) => r.bucket === row?.bucket)}
            {@const fullRow = bucketIdx >= 0 ? chartData[bucketIdx] : row}
            <Tooltip.Header>{fullRow?.bucket}</Tooltip.Header>
            <Tooltip.List>
              {#each topItems as name, i (name)}
                {#if ((fullRow?.[name] as number) ?? 0) > 0}
                  <Tooltip.Item
                    label={name}
                    color={name === 'Other' ? OTHER_COLOR : ITEM_COLORS[i % ITEM_COLORS.length]}
                    value={formatEUR((fullRow[name] as number) * 100)}
                  />
                {/if}
              {/each}
              <Tooltip.Item label={t(page.data.locale, 'tooltip_total')} value={formatEUR((bucketIdx >= 0 ? totals[bucketIdx] : 0) * 100)} />
            </Tooltip.List>
          {/snippet}
        </Tooltip.Root>
      </Chart>

      <!-- Phase 16.3 D-02 / D-06: EventBadgeStrip mounts inside scroll wrapper.
           44px fixed (D-06 prevents card-height jitter on filter changes). -->
      <EventBadgeStrip
        events={events}
        buckets={eventBuckets}
        grain={getFilters().grain as 'day' | 'week' | 'month'}
        width={stripWidth}
      />
    </div>
  {/if}
</div>
