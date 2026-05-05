<script lang="ts">
  // VA-05: Calendar customer counts — same stacked-bar shape as revenue card,
  // tx_count metric instead of revenue_cents. Title + testid differ only.
  // D-06 gradient + D-07 cash segment + D-08 shared legend.
  //
  // Phase 15-13: Forecast overlay — per-model lines (Spline) + low-opacity CI bands
  // (Area) on top of visit_seq stacked bars. Mirrors CalendarRevenueCard's 15-12
  // overlay; the y-values from /api/forecast?kpi=invoice_count are integer counts
  // (no /100 divisor — invoice_count is INTEGER COUNT, unlike revenue_cents).
  //
  // Scale strategy: bars use a TIME scale (scaleTime + xInterval=day|week|month) so
  // bars and forecast lines share the same x-axis. bucket key (yyyy-MM-dd or
  // yyyy-MM) is parsed to a Date and stored as `bucket_d`; the original bucket
  // label is kept in `bucket` for tooltip display only.
  import { Chart, Svg, Axis, Bars, Spline, Area, Text, Tooltip } from 'layerchart';
  import { scaleTime } from 'd3-scale';
  import { timeDay, timeMonday, timeMonth } from 'd3-time';
  import { addDays, differenceInDays, parseISO, format, startOfMonth, startOfWeek } from 'date-fns';
  import { page } from '$app/state';
  import { t, type MessageKey } from '$lib/i18n/messages';
  import EmptyState from './EmptyState.svelte';
  import VisitSeqLegend from './VisitSeqLegend.svelte';
  import ForecastLegend from './ForecastLegend.svelte';
  import ModelAvailabilityDisclosure from './ModelAvailabilityDisclosure.svelte';
  import { VISIT_SEQ_COLORS, CASH_COLOR, FORECAST_MODEL_COLORS } from '$lib/chartPalettes';
  import { formatIntShort } from '$lib/format';
  import { bucketTotals, bucketTrend } from '$lib/trendline';
  import { clientFetch } from '$lib/clientFetch';
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

  // ----- Forecast overlay state (Phase 15-13) -----
  type ForecastRow = {
    target_date: string;
    model_name: string;
    yhat_mean: number;
    yhat_lower: number;
    yhat_upper: number;
    horizon_days: number;
  };
  type ForecastPayload = {
    rows: ForecastRow[];
    actuals: { date: string; value: number }[];
    events: unknown[];
    last_run: string | null;
    kpi: 'revenue_eur' | 'invoice_count';
    granularity: 'day' | 'week' | 'month';
  };

  let forecastData = $state<ForecastPayload | null>(null);
  let visibleModels = $state(new Set<string>(['sarimax', 'naive_dow']));
  let lastFetchedGrain = $state<string | null>(null);

  function toggleModel(modelName: string) {
    // Always create a NEW Set to trigger Svelte 5 reactivity
    const next = new Set(visibleModels);
    if (next.has(modelName)) next.delete(modelName);
    else next.add(modelName);
    visibleModels = next;
  }

  // Re-fetch /api/forecast when grain changes. Guard with lastFetchedGrain
  // to prevent reactive loops if the response itself touches reactive state.
  $effect(() => {
    const grain = getFilters().grain as 'day' | 'week' | 'month';
    if (lastFetchedGrain === grain) return;
    lastFetchedGrain = grain;
    const url = `/api/forecast?kpi=invoice_count&granularity=${grain}`;
    clientFetch<ForecastPayload>(url)
      .then((data) => { forecastData = data; })
      .catch(() => { forecastData = null; });
  });

  // Group forecast rows per model, filtered by visibleModels.
  const seriesByModel = $derived.by(() => {
    const map = new Map<string, ForecastRow[]>();
    const rows = forecastData?.rows ?? [];
    for (const r of rows) {
      if (!visibleModels.has(r.model_name)) continue;
      if (!map.has(r.model_name)) map.set(r.model_name, []);
      map.get(r.model_name)!.push(r);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.target_date.localeCompare(b.target_date));
    }
    return map;
  });

  // Past/future boundary — server-truth derived from /api/forecast actuals.
  // null when actuals is empty (cold-start) → all rows render as future.
  const lastActualDate = $derived<string | null>(
    (forecastData?.actuals ?? []).reduce<string | null>(
      (max, a) => (max === null || a.date > max) ? a.date : max,
      null
    )
  );

  // Partition each model's rows by past/future relative to lastActualDate.
  const splitSeriesByModel = $derived.by<Map<string, { past: ForecastRow[]; future: ForecastRow[] }>>(() => {
    const out = new Map<string, { past: ForecastRow[]; future: ForecastRow[] }>();
    for (const [modelName, modelRows] of seriesByModel.entries()) {
      if (lastActualDate === null) {
        out.set(modelName, { past: [], future: modelRows });
        continue;
      }
      const past: ForecastRow[] = [];
      const future: ForecastRow[] = [];
      for (const r of modelRows) {
        if (r.target_date < lastActualDate) past.push(r);
        else future.push(r);
      }
      out.set(modelName, { past, future });
    }
    return out;
  });

  // D-03: leftmost past-forecast date for chartXDomain widening.
  // null when no past rows exist (pre-D-15 / cold-start) → chartXDomain stays unchanged.
  const forecastWindowStart = $derived.by<Date | null>(() => {
    let minIso: string | null = null;
    for (const split of splitSeriesByModel.values()) {
      if (split.past.length === 0) continue;
      const first = split.past[0].target_date;
      if (minIso === null || first < minIso) minIso = first;
    }
    return minIso === null ? null : parseISO(minIso);
  });

  const availableModels = $derived(
    Array.from(new Set((forecastData?.rows ?? []).map((r) => r.model_name)))
  );

  // Convert raw bucket key (yyyy-MM-dd or yyyy-MM) to a Date anchor at the
  // bucket's left edge. Required for scaleTime + xInterval bar dimensioning.
  function bucketKeyToDate(bucket: string, grain: 'day' | 'week' | 'month'): Date {
    if (grain === 'month') return parseISO(bucket + '-01');
    return parseISO(bucket); // day/week — week key is the Monday yyyy-MM-dd
  }

  const chartData = $derived.by(() => {
    const filtered = getFiltered();
    const grain = getFilters().grain as 'day' | 'week' | 'month';
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

  const visibleKeys = $derived(series.map(s => s.key));
  const trendData = $derived(bucketTrend(chartData, 'bucket', visibleKeys));
  const totals = $derived(bucketTotals(chartData, visibleKeys));

  // Pick d3-time interval matching the grain (Bar.svelte uses
  // xInterval.floor/offset to compute bar width on time scales).
  const xInterval = $derived.by(() => {
    const grain = getFilters().grain as 'day' | 'week' | 'month';
    if (grain === 'week') return timeMonday;
    if (grain === 'month') return timeMonth;
    return timeDay;
  });

  // X-axis tick formatter — switches based on grain (drops year for mobile fit).
  const formatXTick = $derived.by(() => {
    const grain = getFilters().grain as 'day' | 'week' | 'month';
    return (d: Date) => (grain === 'month' ? format(d, 'MMM') : format(d, 'MMM d'));
  });

  // Bar-range left edge — bars start here. Used by chartXDomain widening (D-03)
  // and pastForecastBuckets count below.
  const startAligned = $derived.by<Date>(() => {
    const w = getWindow();
    const grain = getFilters().grain as 'day' | 'week' | 'month';
    const fromD = parseISO(w.from);
    return grain === 'month' ? startOfMonth(fromD)
      : grain === 'week' ? startOfWeek(fromD, { weekStartsOn: 1 })
      : fromD;
  });

  // X-domain: bars span [from, to]; forecast lines render in the +365d gap.
  // D-03: widen LEFT edge to forecastWindowStart when past-forecast extends
  // before startAligned (post-D-15). Pre-D-15: forecastWindowStart is null
  // and the domain stays [startAligned, today + 365d] (existing behavior).
  const chartXDomain = $derived.by<[Date, Date]>(() => {
    const lo = forecastWindowStart !== null && forecastWindowStart < startAligned
      ? forecastWindowStart
      : startAligned;
    return [lo, addDays(new Date(), 365)];
  });

  // D-03: count of past-forecast buckets that extend BEFORE startAligned (i.e.,
  // outside the bar range, on the LEFT). Pre-D-15: null/empty → 0 → identical
  // chart-width math. Counts card has no scroll-to-today effect; this feeds
  // totalSlots so the chart canvas widens to accommodate the LEFT extension.
  const pastForecastBuckets = $derived.by<number>(() => {
    if (forecastWindowStart === null) return 0;
    if (forecastWindowStart >= startAligned) return 0;
    const grain = getFilters().grain as 'day' | 'week' | 'month';
    if (grain === 'day') return Math.max(0, differenceInDays(startAligned, forecastWindowStart));
    if (grain === 'week') return Math.max(0, Math.floor(differenceInDays(startAligned, forecastWindowStart) / 7));
    return Math.max(0,
      (startAligned.getFullYear() - forecastWindowStart.getFullYear()) * 12
      + (startAligned.getMonth() - forecastWindowStart.getMonth())
    );
  });

  // Scroll overflow: when bars don't fit at mobile width, force a wider chart
  // and let the wrapper scroll horizontally. Forecast horizon adds ~365 day-slots
  // worth of x-axis distance — without scaling chartW up, bars would be crushed.
  // After D-15, also account for past-forecast buckets that extend LEFT of bars.
  let cardW = $state(0);
  const totalSlots = $derived.by(() => {
    const fcRows = forecastData?.rows ?? [];
    const fcDates = new Set(fcRows.map((r) => r.target_date));
    return chartData.length + fcDates.size + pastForecastBuckets;
  });
  const chartW = $derived(computeChartWidth(totalSlots, cardW));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let chartCtx = $state<any>();
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
      <Chart
        bind:context={chartCtx}
        data={chartData}
        x="bucket_d"
        xScale={scaleTime()}
        xInterval={xInterval}
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
              x={(r: { bucket_d: Date }) => r.bucket_d}
              y="trend"
              class="stroke-zinc-900 stroke-[1.5] opacity-70"
              stroke-dasharray="3 3"
            />
          {/if}

          <!-- Forecast CI bands (back layer) — one Area per visible model. -->
          {#each Array.from(seriesByModel.entries()) as [modelName, modelRows] (`band-${modelName}`)}
            <Area
              data={modelRows.map((r) => ({ ...r, d: parseISO(r.target_date) }))}
              x={(r: { d: Date }) => r.d}
              y0={(r: { yhat_lower: number }) => r.yhat_lower}
              y1={(r: { yhat_upper: number }) => r.yhat_upper}
              fill={FORECAST_MODEL_COLORS[modelName]}
              fillOpacity={0.06}
            />
          {/each}

          <!-- Past-forecast lines — solid faded ~70% opacity (D-02; locked at 0.7).
               naive_dow keeps its dashed gray; others render solid faded. -->
          {#each Array.from(splitSeriesByModel.entries()) as [modelName, split] (`past-line-${modelName}`)}
            {@const isNaive = modelName === 'naive_dow'}
            {#if split.past.length > 0}
              <Spline
                data={split.past.map((r) => ({ ...r, d: parseISO(r.target_date) }))}
                x={(r: { d: Date }) => r.d}
                y={(r: { yhat_mean: number }) => r.yhat_mean}
                stroke={FORECAST_MODEL_COLORS[modelName]}
                strokeWidth={isNaive ? 1 : 2}
                strokeOpacity={0.7}
                stroke-dasharray={isNaive ? '4 4' : undefined}
              />
            {/if}
          {/each}

          <!-- Future-forecast lines — dashed for all models (D-02). -->
          {#each Array.from(splitSeriesByModel.entries()) as [modelName, split] (`future-line-${modelName}`)}
            {@const isNaive = modelName === 'naive_dow'}
            {#if split.future.length > 0}
              <Spline
                data={split.future.map((r) => ({ ...r, d: parseISO(r.target_date) }))}
                x={(r: { d: Date }) => r.d}
                y={(r: { yhat_mean: number }) => r.yhat_mean}
                stroke={FORECAST_MODEL_COLORS[modelName]}
                strokeWidth={isNaive ? 1 : 2}
                stroke-dasharray={'4 4'}
              />
            {/if}
          {/each}

          {#each chartData as row, i (String(row.bucket_d))}
            {#if totals[i] > 0 && chartCtx && row.bucket_d instanceof Date}
              {@const x0 = chartCtx.xScale(row.bucket_d) ?? 0}
              {@const x1 = chartCtx.xScale(xInterval.offset(row.bucket_d, 1)) ?? x0}
              <Text
                x={(x0 + x1) / 2}
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
            {@const bucketIso = fullRow?.bucket_d instanceof Date ? format(fullRow.bucket_d, 'yyyy-MM-dd') : null}
            {@const topRows = series.filter((s) => ((fullRow?.[s.key] as number) ?? 0) > 0)}
            {@const modelRows = bucketIso === null ? [] : Array.from(splitSeriesByModel.entries())
              .map(([name, split]) => {
                const r = split.past.find((x) => x.target_date === bucketIso)
                       ?? split.future.find((x) => x.target_date === bucketIso);
                return r ? { name, row: r } : null;
              })
              .filter((x): x is { name: string; row: ForecastRow } => x !== null)}
            {#if topRows.length > 0 || modelRows.length > 0}
              <Tooltip.Header>{fullRow?.bucket}</Tooltip.Header>
              <Tooltip.List>
                {#if topRows.length > 0}
                  {#each topRows as s (s.key)}
                    <Tooltip.Item label={s.label} color={s.color} value={`${fullRow[s.key]} ${t(page.data.locale, 'txn_suffix')}`} />
                  {/each}
                  <Tooltip.Item label={t(page.data.locale, 'tooltip_total')} value={`${bucketIdx >= 0 ? totals[bucketIdx] : 0} ${t(page.data.locale, 'txn_suffix')}`} />
                {/if}
                {#if topRows.length > 0 && modelRows.length > 0}
                  <li class="border-t border-zinc-200 my-1" aria-hidden="true"></li>
                {/if}
                {#if modelRows.length > 0}
                  <!-- 16.2-03 Item 3: hand-rolled flex row replaces Tooltip.Item for
                       model rows. See CalendarRevenueCard rationale comment for full
                       context — same fix pattern, integer formatter for invoice counts. -->
                  {#each modelRows as { name, row: fr } (`mr-${name}`)}
                    <li class="flex items-center justify-between gap-3 py-0.5 text-xs">
                      <span class="flex items-center gap-1.5 min-w-0">
                        <span
                          class="inline-block h-2 w-2 flex-shrink-0 rounded-full"
                          style:background-color={FORECAST_MODEL_COLORS[name]}
                        ></span>
                        <span class="truncate">{t(page.data.locale, `forecast_model_${name}` as MessageKey)}</span>
                      </span>
                      <span class="flex-shrink-0 whitespace-nowrap tabular-nums">
                        {formatIntShort(fr.yhat_mean)}
                      </span>
                    </li>
                  {/each}
                {/if}
              </Tooltip.List>
            {/if}
          {/snippet}
        </Tooltip.Root>
      </Chart>
    </div>
    <VisitSeqLegend {showCash} />
    {#if forecastData && availableModels.length > 0}
      <ForecastLegend {availableModels} {visibleModels} ontoggle={toggleModel} />
      <ModelAvailabilityDisclosure {availableModels} grain={getFilters().grain} />
    {/if}
  {/if}
</div>
