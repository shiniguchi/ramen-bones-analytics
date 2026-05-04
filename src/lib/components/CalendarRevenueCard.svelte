<script lang="ts">
  // VA-04: Calendar revenue — stacked bars by visit_seq bucket per grain.
  // D-06 sequential blue gradient + D-07 cash 9th segment + D-08 gradient legend.
  //
  // Phase 15-12: Forecast overlay — per-model lines (Spline) + low-opacity CI bands
  // (Area) on top of visit_seq stacked bars. X-axis extends to last_actual + 365d
  // so forecast values render in the empty space to the right of the last bar.
  //
  // Scale strategy: bars use a TIME scale (scaleTime + xInterval=day|week|month) so
  // bars and forecast lines share the same x-axis. Bar.svelte's xInterval branch
  // computes width via interval.floor()/offset() — the canonical LayerChart pattern
  // for date-axis bars. bucket key (yyyy-MM-dd or yyyy-MM) is parsed to a Date and
  // stored as `bucket_d`; the original bucket label is kept in `bucket` for
  // tooltip display only.
  //
  // Self-subscribes to dashboardStore via getter calls inside $derived.by() —
  // same pattern as KpiTile. No prop-drilling of data/grain/filters.
  import { Chart, Svg, Axis, Bars, Spline, Area, Text, Tooltip } from 'layerchart';
  import { scaleTime } from 'd3-scale';
  import { timeDay, timeMonday, timeMonth } from 'd3-time';
  import { addDays, differenceInDays, parseISO, format, startOfMonth, startOfWeek } from 'date-fns';
  import { page } from '$app/state';
  import { t, type MessageKey } from '$lib/i18n/messages';
  import { formatEUR } from '$lib/format';
  import EmptyState from './EmptyState.svelte';
  import VisitSeqLegend from './VisitSeqLegend.svelte';
  import ForecastLegend from './ForecastLegend.svelte';
  import { VISIT_SEQ_COLORS, CASH_COLOR, FORECAST_MODEL_COLORS } from '$lib/chartPalettes';
  import { formatEURShort } from '$lib/format';
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

  // Stack order = series array order. Light (1st) at bottom, dark (8x+) at top (D-06).
  const VISIT_KEYS = ['1st', '2nd', '3rd', '4x', '5x', '6x', '7x', '8x+'] as const;
  // Every numeric column emitted by shapeForChart for the revenue_cents metric
  // (all visit_seq buckets + the cash segment). Driven by the same stacked shape
  // produced upstream in dashboardStore.svelte.ts shapeForChart.
  const SERIES_KEYS = [...VISIT_KEYS, 'cash'] as const;

  // ----- Forecast overlay state (Phase 15-12) -----
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
    const url = `/api/forecast?kpi=revenue_eur&granularity=${grain}`;
    clientFetch<ForecastPayload>(url)
      .then((data) => { forecastData = data; })
      .catch(() => { forecastData = null; });
  });

  // Group forecast rows per model, filtered by visibleModels. naive_dow is
  // gated by visibleModels too (parent owns the default-on state via the
  // initial Set). Each model's rows sorted by target_date for clean splines.
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
  // splitSeriesByModel.past arrays inherit ascending sort from seriesByModel.
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
    // expectedBuckets zero-fills periods with no filtered data so they render as
    // visible zero bars (e.g. Mon/Tue when days filter = Wed-Sun).
    return shapeForChart(nested, 'revenue_cents', bucketRange(w.from, w.to, grain)).map((r) => {
      const rawBucket = r.bucket as string;
      const row: Record<string, string | number | Date> = {
        ...r,
        bucket: formatBucketLabel(rawBucket, grain),
        bucket_d: bucketKeyToDate(rawBucket, grain)
      };
      for (const k of SERIES_KEYS) {
        const v = r[k];
        row[k] = typeof v === 'number' ? Math.round(v / 100) : 0;
      }
      return row;
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

  // Series keys currently visible (drives the trend-line sum).
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

  // D-03 scroll-to-today fix input — count of past-forecast buckets that extend
  // BEFORE startAligned (i.e., outside the bar range, on the LEFT). Pre-D-15:
  // forecastWindowStart is null OR >= startAligned → 0 → identical scroll math.
  const pastForecastBuckets = $derived.by<number>(() => {
    if (forecastWindowStart === null) return 0;
    if (forecastWindowStart >= startAligned) return 0;
    const grain = getFilters().grain as 'day' | 'week' | 'month';
    if (grain === 'day') return Math.max(0, differenceInDays(startAligned, forecastWindowStart));
    if (grain === 'week') return Math.max(0, Math.floor(differenceInDays(startAligned, forecastWindowStart) / 7));
    // month
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

  // Auto-scroll to "today" so the forecast tail is visible on first render.
  // Without this, the chart canvas can be 19k+ px wide (year of historical bars
  // + 365d forecast horizon) and the forecast lines render off-screen — users
  // had to scroll right ~16x to discover them. We position today at ~60% of the
  // visible viewport: most of the visible area shows recent past, with the
  // near-future forecast hinted on the right edge.
  //
  // Compute todayX from the chartXDomain proportion directly rather than via
  // chartCtx.xScale — xScale can be stale when the effect fires (xInterval +
  // forecast-extended domain interplay) and returns a position that doesn't
  // match the actual SVG path coords. Pure date math is deterministic.
  // Skip if the user has already scrolled (scrollLeft > 0).
  let scrollerRef = $state<HTMLDivElement>();
  let lastSetScrollLeft = 0;
  $effect(() => {
    // Position the scroll container so today's edge (= where actuals end
    // and the forecast tail begins) sits at ~60% of the viewport width.
    // Without this, the chart canvas can be 19k+ px wide (year of bars +
    // 365d forecast) and forecast lines render off-screen by default.
    //
    // Use bucket-count proportion rather than date math: chartData.length
    // is the historical bar count, fcDates.size is the forecast count.
    // Today is exactly at the boundary, so todayPct = bars / (bars+forecast).
    // This is robust to chartXDomain reactivity timing — both counts come
    // from the same Svelte tick that built the chart.
    //
    // Depend on chartW so we re-run when the canvas grows; the chart's
    // inner SVG dimensions lag chartW by 1-2 frames, so poll RAF until
    // scrollWidth catches up. lastSetScrollLeft tracks our own writes so
    // user-scrolling stops auto-positioning but layout-driven width
    // changes don't.
    const w = chartW;
    if (!forecastData || !scrollerRef || w === 0) return;
    if (scrollerRef.scrollLeft !== lastSetScrollLeft) return;
    const el = scrollerRef;
    const histBuckets = chartData.length;
    // D-15: split forecast counts into past (LEFT-extending) + future (RIGHT)
    // so today still lands at the boundary between past-segment and future.
    // pastForecastBuckets is the LEFT extension beyond the bar range.
    // fcBuckets here counts ALL forecast distinct dates (past + future);
    // we add pastForecastBuckets to the numerator so today sits at the
    // (past-extension + bars + in-range-past-forecast) | future boundary.
    const fcBuckets = new Set((forecastData.rows ?? []).map((r) => r.target_date)).size;
    const total = histBuckets + pastForecastBuckets + fcBuckets;
    if (total === 0) return;
    const todayPct = (histBuckets + pastForecastBuckets) / total;
    let attempts = 0;
    const tryPosition = () => {
      if (el.scrollLeft !== lastSetScrollLeft) return;
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
                value={formatEURShort(totals[i])}
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
                    <Tooltip.Item label={s.label} color={s.color} value={formatEUR((fullRow[s.key] as number) * 100)} />
                  {/each}
                  <Tooltip.Item label={t(page.data.locale, 'tooltip_total')} value={formatEUR((bucketIdx >= 0 ? totals[bucketIdx] : 0) * 100)} />
                {/if}
                {#if topRows.length > 0 && modelRows.length > 0}
                  <li class="border-t border-zinc-200 my-1" aria-hidden="true"></li>
                {/if}
                {#if modelRows.length > 0}
                  {#each modelRows as { name, row: fr } (`mr-${name}`)}
                    <Tooltip.Item
                      label={t(page.data.locale, `forecast_model_${name}` as MessageKey)}
                      color={FORECAST_MODEL_COLORS[name]}
                      value={formatEUR(fr.yhat_mean * 100)}
                    />
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
    {/if}
  {/if}
</div>
