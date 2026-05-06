<script lang="ts">
  // Calendar customer counts — stacked bars by visit_seq + cash, with a
  // forecast overlay (per-model lines + CI bands + hover affordance).
  // Uses tx_count metric. Sibling CalendarRevenueCard is the same shape
  // but on revenue_cents; both delegate forecast logic to the shared
  // `createForecastOverlay` factory + `<ForecastOverlay>` SVG component
  // + `<ForecastTooltipRows>` tooltip rows.
  import { Chart, Svg, Axis, Bars, Spline, Text, Tooltip } from 'layerchart';
  import { scaleTime } from 'd3-scale';
  import { timeDay, timeMonday, timeMonth } from 'd3-time';
  import { addDays, differenceInDays, parseISO, format, startOfMonth, startOfWeek } from 'date-fns';
  import { page } from '$app/state';
  import { t } from '$lib/i18n/messages';
  import EmptyState from './EmptyState.svelte';
  import VisitSeqLegend from './VisitSeqLegend.svelte';
  import ForecastLegend from './ForecastLegend.svelte';
  import ForecastOverlay from './ForecastOverlay.svelte';
  import ForecastTooltipRows from './ForecastTooltipRows.svelte';
  import ModelAvailabilityDisclosure from './ModelAvailabilityDisclosure.svelte';
  import EventBadgeStrip from './EventBadgeStrip.svelte';
  import { VISIT_SEQ_COLORS, CASH_COLOR } from '$lib/chartPalettes';
  import { formatIntShort } from '$lib/format';
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

  const yAxisFormat = (n: number) => formatIntShort(n, 'txn');
  const txnSuffix = $derived(t(page.data.locale, 'txn_suffix'));
  const formatTxn = (n: number) => `${n} ${txnSuffix}`;
  const formatForecast = (n: number) => formatIntShort(n);

  const VISIT_KEYS = ['1st', '2nd', '3rd', '4x', '5x', '6x', '7x', '8x+'] as const;

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
    return shapeForChart(nested, 'tx_count', bucketRange(w.from, w.to, grain)).map((r) => {
      const rawBucket = r.bucket as string;
      return {
        ...r,
        bucket: formatBucketLabel(rawBucket, grain),
        bucket_d: bucketKeyToDate(rawBucket, grain)
      };
    });
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

  // Phase 16.3 D-05: rangeStart for events-feed backfill — earlier of
  // historical-leftmost OR forecast-window-leftmost (16.1 widening).
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

  // Shared forecast-overlay state (fetch + reactive derivations + bucketCenter
  // + hoveredBucketIso). Identical shape across CalendarCountsCard and
  // CalendarRevenueCard — only the kpi key differs.
  const overlay = createForecastOverlay({
    kpi: 'invoice_count',
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

  // Phase 16.3 D-02 / D-06: pixel slots for EventBadgeStrip — caller-owned
  // band-position math (see EventBadgeStrip §"caller owns scale"). chartW is
  // `number | undefined` (computeChartWidth returns undefined when the chart
  // fits without scroll); fall back to cardW.
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
</script>

<div data-testid="calendar-counts-card" class="rounded-xl border border-zinc-200 bg-white p-4">
  <h2 class="text-base font-semibold text-zinc-900">{t(page.data.locale, 'cal_counts_title')}</h2>
  <p class="mt-1 text-xs text-zinc-500 text-balance">
    {t(page.data.locale, 'cal_counts_description')}
  </p>
  {#if getFiltered().length === 0}
    <EmptyState card="calendar-counts" />
  {:else}
    <div bind:clientWidth={cardW} class="mt-4 h-64 overflow-x-auto overscroll-x-contain chart-touch-safe">
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
        padding={{ left: 64, right: 8, top: 24, bottom: 24 }}
        tooltipContext={{ mode: 'band', touchEvents: 'auto' }}
      >
        <Svg>
          <Axis placement="left" format={yAxisFormat} grid rule />
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
                value={isPartial ? `~${formatIntShort(totals[i])}` : formatIntShort(totals[i])}
                textAnchor="middle"
                class="pointer-events-none text-[10px] font-medium {isPartial ? 'fill-zinc-400' : 'fill-zinc-700'}"
              />
            {/if}
          {/each}
        </Svg>
        <Tooltip.Root>
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
                    <Tooltip.Item label={s.label} color={s.color} value={formatTxn(fullRow[s.key] as number)} />
                  {/each}
                  <Tooltip.Item label={t(page.data.locale, 'tooltip_total')} value={formatTxn(bucketIdx >= 0 ? totals[bucketIdx] : 0)} />
                {/if}
                {#if topRows.length > 0 && hasForecast}
                  <li class="border-t border-zinc-200 my-1" style:grid-column="1 / -1" aria-hidden="true"></li>
                {/if}
                <ForecastTooltipRows
                  {bucketIso}
                  seriesByModel={overlay.seriesByModel}
                  formatValue={formatForecast}
                />
              </Tooltip.List>
            {/if}
          {/snippet}
        </Tooltip.Root>
      </Chart>

      <!-- Phase 16.3 D-02 / D-06: EventBadgeStrip mounts inside the
           horizontal-scroll wrapper (scrolls in sync with bars). Below the
           chart canvas, above x-axis tick labels (which render inside the SVG
           via Axis placement="bottom"). 44px fixed height — empty events
           array still occupies the space (D-06 prevents card-height jitter). -->
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
