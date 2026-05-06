<script lang="ts">
  // Calendar revenue — stacked bars by visit_seq + cash, with a forecast
  // overlay (per-model lines + CI bands + hover affordance). Uses
  // revenue_cents metric; values converted to EUR for display.
  // Sibling CalendarCountsCard is the same shape on tx_count; both delegate
  // forecast logic to the shared `createForecastOverlay` factory + the
  // `<ForecastOverlay>` SVG component + `<ForecastTooltipRows>` tooltip rows.
  import { Chart, Svg, Axis, Bars, Spline, Text, Tooltip } from 'layerchart';
  import { scaleTime } from 'd3-scale';
  import { timeDay, timeMonday, timeMonth } from 'd3-time';
  import { addDays, differenceInDays, parseISO, format, startOfMonth, startOfWeek } from 'date-fns';
  import { page } from '$app/state';
  import { t } from '$lib/i18n/messages';
  import { formatEUR, formatEURShort } from '$lib/format';
  import EmptyState from './EmptyState.svelte';
  import VisitSeqLegend from './VisitSeqLegend.svelte';
  import ForecastLegend from './ForecastLegend.svelte';
  import ForecastOverlay from './ForecastOverlay.svelte';
  import ForecastTooltipRows from './ForecastTooltipRows.svelte';
  import ModelAvailabilityDisclosure from './ModelAvailabilityDisclosure.svelte';
  import EventBadgeStrip from './EventBadgeStrip.svelte';
  import { VISIT_SEQ_COLORS, CASH_COLOR } from '$lib/chartPalettes';
  import { bucketTotals, bucketTrend } from '$lib/trendline';
  import { createForecastOverlay } from '$lib/forecastOverlay.svelte';
  import type { Granularity } from '$lib/forecastValidation';
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

  // Stack order = series array order. Light (1st) at bottom, dark (8x+) at top.
  const VISIT_KEYS = ['1st', '2nd', '3rd', '4x', '5x', '6x', '7x', '8x+'] as const;
  // Every numeric column emitted by shapeForChart for the revenue_cents metric
  // (all visit_seq buckets + cash). Driven by upstream dashboardStore.shapeForChart.
  const SERIES_KEYS = [...VISIT_KEYS, 'cash'] as const;

  // Tooltip / forecast number formatters. Values in chartData are EUR
  // integers (already /100 from cents). formatEUR takes cents — multiply by
  // 100 to convert back at format time.
  const formatEurFromEuros = (n: number) => formatEUR(n * 100);

  // Convert raw bucket key (yyyy-MM-dd or yyyy-MM) to a Date anchor at the
  // bucket's left edge. Required for scaleTime + xInterval bar dimensioning.
  function bucketKeyToDate(bucket: string, grain: Granularity): Date {
    if (grain === 'month') return parseISO(bucket + '-01');
    return parseISO(bucket); // day/week — week key is the Monday yyyy-MM-dd
  }

  const chartData = $derived.by(() => {
    const filtered = getFiltered();
    const grain = getFilters().grain as Granularity;
    const w = getWindow();
    const nested = aggregateByBucketAndVisitSeq(filtered, grain);
    return shapeForChart(nested, 'revenue_cents', bucketRange(w.from, w.to, grain)).map((r) => {
      const rawBucket = r.bucket as string;
      // Convert cents → EUR integers up front so the y-axis is in euros.
      // Keep bucket/bucket_d as the LAST spread so they retain strict types
      // (the SERIES_KEYS spread comes from a Record<string, number> reducer).
      const cents = SERIES_KEYS.reduce<Record<string, number>>((acc, k) => {
        const v = r[k];
        acc[k] = typeof v === 'number' ? Math.round(v / 100) : 0;
        return acc;
      }, {});
      return {
        ...r,
        ...cents,
        bucket: formatBucketLabel(rawBucket, grain),
        bucket_d: bucketKeyToDate(rawBucket, grain)
      };
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
  const visibleKeys = $derived(series.map((s) => s.key));
  const trendData = $derived(bucketTrend(chartData, 'bucket', visibleKeys));
  const totals = $derived(bucketTotals(chartData, visibleKeys));

  // Pick d3-time interval matching the grain (Bar.svelte uses
  // xInterval.floor/offset to compute bar width on time scales).
  const xInterval = $derived.by(() => {
    const grain = getFilters().grain as Granularity;
    if (grain === 'week') return timeMonday;
    if (grain === 'month') return timeMonth;
    return timeDay;
  });

  // X-axis tick formatter — switches based on grain (drops year for mobile fit).
  const formatXTick = $derived.by(() => {
    const grain = getFilters().grain as Granularity;
    return (d: Date) => (grain === 'month' ? format(d, 'MMM') : format(d, 'MMM d'));
  });

  // Bar-range left edge — bars start here. Used by chartXDomain widening
  // and pastForecastBuckets count below.
  const startAligned = $derived.by<Date>(() => {
    const w = getWindow();
    const grain = getFilters().grain as Granularity;
    const fromD = parseISO(w.from);
    return grain === 'month' ? startOfMonth(fromD)
      : grain === 'week' ? startOfWeek(fromD, { weekStartsOn: 1 })
      : fromD;
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let chartCtx = $state<any>();

  // Phase 16.3 D-05: rangeStart for events-feed backfill. Earlier of
  // historical-data leftmost bucket OR forecast-window leftmost (16.1 widening).
  // overlay.forecastWindowStart populates AFTER the first forecast fetch — so
  // rangeStart starts as historical leftmost only and tightens once the
  // forecast lands. lastFetchedKey widening in Plan 16.3-06 ensures the
  // events query re-fires.
  function rangeStartIso(): string | null {
    const histFirst = chartData[0]?.bucket_d;
    const fcFirst = overlay.forecastWindowStart;
    if (!histFirst && !fcFirst) return null;
    if (!histFirst) return format(fcFirst!, 'yyyy-MM-dd');
    if (!fcFirst) return format(histFirst, 'yyyy-MM-dd');
    return format(
      histFirst.getTime() < fcFirst.getTime() ? histFirst : fcFirst,
      'yyyy-MM-dd'
    );
  }

  // Shared forecast-overlay state. Identical shape across CalendarCountsCard
  // and CalendarRevenueCard — only the kpi key differs.
  const overlay = createForecastOverlay({
    kpi: 'revenue_eur',
    grain: () => getFilters().grain as Granularity,
    chartData: () => chartData,
    xInterval: () => xInterval,
    chartCtx: () => chartCtx,
    rangeStart: rangeStartIso // Phase 16.3 D-05
  });

  // X-domain: bars span [from, to]; forecast lines render in the +365d gap.
  // Widen LEFT edge to overlay.forecastWindowStart when past-forecast extends
  // before startAligned.
  const chartXDomain = $derived.by<[Date, Date]>(() => {
    const ws = overlay.forecastWindowStart;
    const lo = ws !== null && ws < startAligned ? ws : startAligned;
    return [lo, addDays(new Date(), 365)];
  });

  // Count of past-forecast buckets that extend BEFORE startAligned (LEFT side
  // of the bar range). Feeds totalSlots so the chart canvas widens to fit.
  const pastForecastBuckets = $derived.by<number>(() => {
    const ws = overlay.forecastWindowStart;
    if (ws === null || ws >= startAligned) return 0;
    const grain = getFilters().grain as Granularity;
    if (grain === 'day') return Math.max(0, differenceInDays(startAligned, ws));
    if (grain === 'week') return Math.max(0, Math.floor(differenceInDays(startAligned, ws) / 7));
    return Math.max(0,
      (startAligned.getFullYear() - ws.getFullYear()) * 12
      + (startAligned.getMonth() - ws.getMonth())
    );
  });

  // Scroll overflow: when bars don't fit at mobile width, force a wider chart
  // and let the wrapper scroll horizontally. Forecast horizon adds ~365 day-slots
  // worth of x-axis distance — without scaling chartW up, bars would be crushed.
  let cardW = $state(0);
  const totalSlots = $derived.by(() => {
    const fcRows = overlay.forecastData?.rows ?? [];
    const fcDates = new Set(fcRows.map((r) => r.target_date));
    return chartData.length + fcDates.size + pastForecastBuckets;
  });
  const chartW = $derived(computeChartWidth(totalSlots, cardW));

  // Phase 16.3 D-02 / D-06: pixel slots for EventBadgeStrip. Each historical
  // bucket maps to its left-edge x-coordinate; width is the slot width. The
  // strip is generic (D-02 keeps the component xScale-agnostic) so the caller
  // owns the pixel math. Fixed 44px strip height holds layout stable on empty
  // events arrays (D-06 — no card-height jitter on filter changes).
  // chartW is `number | undefined` (computeChartWidth returns undefined when
  // the chart fits without scroll); fall back to cardW for the strip width.
  const stripWidth = $derived(chartW ?? cardW);
  const eventBuckets = $derived.by(() => {
    if (chartData.length === 0 || stripWidth === 0) return [];
    const slotWidth = stripWidth / chartData.length;
    return chartData.map((row, i) => ({
      iso: format(row.bucket_d, 'yyyy-MM-dd'),
      left: i * slotWidth,
      width: slotWidth
    }));
  });

  // Auto-scroll to "today" so the forecast tail is visible on first render.
  // Without this, the chart canvas can be 19k+ px wide (year of bars + 365d
  // forecast) and the forecast lines render off-screen — users had to scroll
  // right ~16x to discover them. We position today at ~60% of the visible
  // viewport: most of the area shows recent past, with near-future hinted on
  // the right edge. Skip if the user has already scrolled (scrollLeft > 0).
  let scrollerRef = $state<HTMLDivElement>();
  let lastSetScrollLeft = 0;
  $effect(() => {
    const w = chartW;
    if (!overlay.forecastData || !scrollerRef || w === 0) return;
    if (scrollerRef.scrollLeft !== lastSetScrollLeft) return;
    const el = scrollerRef;
    const histBuckets = chartData.length;
    const fcBuckets = new Set((overlay.forecastData.rows ?? []).map((r) => r.target_date)).size;
    const total = histBuckets + pastForecastBuckets + fcBuckets;
    if (total === 0) return;
    const todayPct = (histBuckets + pastForecastBuckets) / total;
    let attempts = 0;
    const tryPosition = () => {
      if (el.scrollLeft !== lastSetScrollLeft) return;
      // Inner SVG width lags chartW by 1-2 frames; poll RAF until it catches up.
      if (el.scrollWidth < w * 0.9 && attempts < 30) {
        attempts++;
        requestAnimationFrame(tryPosition);
        return;
      }
      const todayX = el.scrollWidth * todayPct;
      const target = Math.max(0, todayX - el.clientWidth * 0.6);
      el.scrollLeft = target;
      lastSetScrollLeft = target;
    };
    requestAnimationFrame(tryPosition);
  });
</script>

<div data-testid="calendar-revenue-card" class="rounded-xl border border-zinc-200 bg-white p-4">
  <h2 class="text-base font-semibold text-zinc-900">{t(page.data.locale, 'cal_revenue_title')}</h2>
  <p class="mt-1 text-xs text-zinc-500 text-balance">
    {t(page.data.locale, 'cal_revenue_description')}
  </p>
  {#if getFiltered().length === 0}
    <EmptyState card="calendar-revenue" />
  {:else}
    <div bind:this={scrollerRef} bind:clientWidth={cardW} class="mt-4 h-64 overflow-x-auto overscroll-x-contain chart-touch-safe">
      {#if cardW > 0}
      <Chart
        bind:context={chartCtx}
        data={chartData}
        x="bucket_d"
        xScale={scaleTime()}
        {xInterval}
        xDomain={chartXDomain}
        {series}
        seriesLayout="stack"
        valueAxis="y"
        width={chartW}
        padding={{ left: 40, right: 8, top: 24, bottom: 24 }}
        tooltipContext={{ mode: 'band', touchEvents: 'auto' }}
      >
        <Svg>
          <Axis placement="left" format={formatEURShort} grid rule />
          <Axis placement="bottom" ticks={MAX_X_TICKS} format={formatXTick} rule />
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
              data={trendData.map((r, i) => ({
                ...r,
                bucket_d: chartData[i]?.bucket_d ?? new Date()
              }))}
              x={(r: { bucket_d: Date }) => overlay.bucketCenter(r.bucket_d)}
              y="trend"
              class="stroke-zinc-900 stroke-[1.5] opacity-70"
              stroke-dasharray="3 3"
            />
          {/if}

          <ForecastOverlay
            seriesByModel={overlay.seriesByModel}
            bucketCenter={overlay.bucketCenter}
            hoveredBucketIso={overlay.hoveredBucketIso}
            {chartCtx}
          />

          {#each chartData as row, i (String(row.bucket_d))}
            {#if totals[i] > 0 && chartCtx && row.bucket_d instanceof Date}
              {@const x0 = chartCtx.xScale(row.bucket_d) ?? 0}
              {@const x1 = chartCtx.xScale(xInterval.offset(row.bucket_d, 1)) ?? x0}
              {@const _today = new Date()}
              {@const _grain = getFilters().grain as Granularity}
              {@const isPartial = _grain === 'month'
                ? row.bucket_d.getFullYear() === _today.getFullYear() && row.bucket_d.getMonth() === _today.getMonth()
                : _grain === 'week'
                ? startOfWeek(row.bucket_d, { weekStartsOn: 1 }).getTime() === startOfWeek(_today, { weekStartsOn: 1 }).getTime()
                : false}
              <Text
                x={(x0 + x1) / 2}
                y={(chartCtx.yScale(totals[i]) ?? 0) - 6}
                value={isPartial ? `~${formatEURShort(totals[i])}` : formatEURShort(totals[i])}
                textAnchor="middle"
                class="pointer-events-none text-[10px] font-medium {isPartial ? 'fill-zinc-400' : 'fill-zinc-700'}"
              />
            {/if}
          {/each}
        </Svg>
        <Tooltip.Root contained={false}>
          {#snippet children({ data: row })}
            {@const bucketIdx = chartData.findIndex((r) => r.bucket === row?.bucket)}
            {@const fullRow = bucketIdx >= 0 ? chartData[bucketIdx] : row}
            {@const bucketIso = fullRow?.bucket_d instanceof Date ? format(fullRow.bucket_d, 'yyyy-MM-dd') : null}
            {@const topRows = series.filter((s) => ((fullRow?.[s.key] as number) ?? 0) > 0)}
            {@const hasForecast = bucketIso !== null && Array.from(overlay.seriesByModel.values())
              .some((rows) => rows.some((r) => r.target_date === bucketIso))}
            {#if topRows.length > 0 || hasForecast}
              <Tooltip.Header>{fullRow?.bucket}</Tooltip.Header>
              <Tooltip.List>
                {#if topRows.length > 0}
                  {#each topRows as s (s.key)}
                    <Tooltip.Item label={s.label} color={s.color} value={formatEurFromEuros(fullRow[s.key] as number)} />
                  {/each}
                  <Tooltip.Item label={t(page.data.locale, 'tooltip_total')} value={formatEurFromEuros(bucketIdx >= 0 ? totals[bucketIdx] : 0)} />
                {/if}
                {#if topRows.length > 0 && hasForecast}
                  <li class="border-t border-zinc-200 my-1" style:grid-column="1 / -1" aria-hidden="true"></li>
                {/if}
                <ForecastTooltipRows
                  {bucketIso}
                  seriesByModel={overlay.seriesByModel}
                  formatValue={formatEurFromEuros}
                />
              </Tooltip.List>
            {/if}
          {/snippet}
        </Tooltip.Root>
      </Chart>

      <!-- Phase 16.3 D-02 / D-06: EventBadgeStrip mounts inside the
           horizontal-scroll wrapper so the strip scrolls in sync with the
           bars. Sits BELOW the chart canvas, ABOVE x-axis tick labels (which
           render inside the SVG via Axis placement="bottom"). Fixed 44px row
           — empty events array still occupies the space (D-06 prevents
           card-height jitter on filter changes). -->
      <EventBadgeStrip
        events={overlay.events}
        buckets={eventBuckets}
        grain={getFilters().grain as 'day' | 'week' | 'month'}
        width={stripWidth}
      />
      {/if}
    </div>
    <VisitSeqLegend {showCash} />
    {#if overlay.forecastData && overlay.availableModels.length > 0}
      <ForecastLegend
        availableModels={overlay.availableModels}
        visibleModels={overlay.visibleModels}
        ontoggle={overlay.toggleModel}
      />
      <ModelAvailabilityDisclosure
        availableModels={overlay.availableModels}
        grain={getFilters().grain}
        backtestStatus={overlay.forecastData?.modelBacktestStatus ?? null}
      />
    {/if}
  {/if}
</div>
