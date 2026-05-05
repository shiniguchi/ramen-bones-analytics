<script lang="ts">
  // InvoiceCountForecastCard — sibling of RevenueForecastCard for invoice_count.
  // Phase 15-15 / D-18: self-fetches /api/forecast?kpi=invoice_count and renders
  // forecast Spline lines + Area CI bands per visible model. Same shape as
  // RevenueForecastCard (15-14) but counts are integers — no cent→EUR division
  // and y-axis uses formatIntShort.
  import { Chart, Svg, Axis, Spline, Area, Highlight, Tooltip } from 'layerchart';
  import { scaleTime, scaleLinear } from 'd3-scale';
  import { curveMonotoneX } from 'd3-shape';
  import { parseISO, format } from 'date-fns';
  import { page } from '$app/state';
  import { t, type MessageKey } from '$lib/i18n/messages';
  import { formatIntShort } from '$lib/format';
  import { clientFetch } from '$lib/clientFetch';
  import { getFilters, computeChartWidth } from '$lib/dashboardStore.svelte';
  import EmptyState from './EmptyState.svelte';
  import ForecastLegend from './ForecastLegend.svelte';
  import EventMarker from './EventMarker.svelte';
  import ForecastHoverPopup from './ForecastHoverPopup.svelte';
  import { FORECAST_MODEL_COLORS } from '$lib/chartPalettes';
  import type { ForecastEvent } from '$lib/forecastEventClamp';

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
    events: ForecastEvent[];
    last_run: string | null;
    kpi: string;
    granularity: 'day' | 'week' | 'month';
  };

  let forecastData = $state<ForecastPayload | null>(null);
  let visibleModels = $state(new Set<string>(['sarimax', 'naive_dow']));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let chartCtx = $state<any>();

  // Plain non-reactive flag — same fix as v1 36a06aa.
  let lastFetchedGrain: string | null = null;

  $effect(() => {
    const g = getFilters().grain;
    if (g === lastFetchedGrain) return;
    lastFetchedGrain = g;
    void clientFetch<ForecastPayload>(`/api/forecast?kpi=invoice_count&granularity=${g}`)
      .then(f => { forecastData = f; })
      .catch(e => console.error('[InvoiceCountForecastCard]', e));
  });

  // Empty-state variant selector. Day-grain empty = pre-first-run; week/month
  // empty = day works but new per-grain pipeline hasn't fired yet (Phase 15-10).
  const emptyCard = $derived(
    getFilters().grain === 'day' ? 'forecast-loading' : 'forecast-grain-pending'
  );

  function toggleModel(m: string) {
    const next = new Set(visibleModels);
    next.has(m) ? next.delete(m) : next.add(m);
    visibleModels = next;
  }

  const rows = $derived(forecastData?.rows ?? []);
  const actuals = $derived(forecastData?.actuals ?? []);
  const events = $derived(forecastData?.events ?? []);
  const lastRun = $derived(forecastData?.last_run ?? null);
  const availableModels = $derived(Array.from(new Set(rows.map(r => r.model_name))));

  const seriesByModel = $derived.by(() => {
    const m = new Map<string, ForecastRow[]>();
    for (const r of rows) {
      if (!visibleModels.has(r.model_name)) continue;
      if (!m.has(r.model_name)) m.set(r.model_name, []);
      m.get(r.model_name)!.push(r);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.target_date.localeCompare(b.target_date));
    return m;
  });

  // Past/future boundary — server-truth derived from /api/forecast actuals.
  // null when actuals is empty (cold-start) → all rows render as future.
  // Mirror of CalendarRevenueCard.svelte:112-117 (16.1-01).
  const lastActualDate = $derived<string | null>(
    (forecastData?.actuals ?? []).reduce<string | null>(
      (max, a) => (max === null || a.date > max) ? a.date : max,
      null
    )
  );

  // Partition each model's rows by past/future relative to lastActualDate.
  // Mirror of CalendarRevenueCard.svelte:120-136 (16.1-01).
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

  // D-17: horizontal-scroll wrapper pattern lifted from CalendarRevenueCard:194-263.
  // Forecast cards' xDomain stays unchanged (data-driven from rows themselves);
  // we only widen the SCROLL canvas via totalSlots → computeChartWidth.
  let cardW = $state(0);
  let scrollerRef = $state<HTMLDivElement | undefined>();
  let lastSetScrollLeft = 0;

  const pastBuckets = $derived.by<number>(() => {
    let total = 0;
    for (const split of splitSeriesByModel.values()) {
      if (split.past.length > total) total = split.past.length;
    }
    return total;
  });

  const futureBuckets = $derived.by<number>(() => {
    let total = 0;
    for (const split of splitSeriesByModel.values()) {
      if (split.future.length > total) total = split.future.length;
    }
    return total;
  });

  const totalSlots = $derived(pastBuckets + futureBuckets);
  const chartW = $derived(computeChartWidth(totalSlots, cardW));
  const todayPct = $derived(totalSlots > 0 ? pastBuckets / totalSlots : 0);

  // Auto-scroll to "today" so today lands at ~60% of the visible viewport on
  // first paint. Mirror of CalendarRevenueCard.svelte:288-334 RAF effect.
  // Re-fires when chartW (canvas pixel width) changes — incl. grain toggles.
  $effect(() => {
    const w = chartW;
    if (!forecastData || !scrollerRef || !w || w === 0) return;
    if (scrollerRef.scrollLeft !== lastSetScrollLeft) return;
    if (totalSlots === 0) return;
    const el = scrollerRef;
    const pct = todayPct;
    let attempts = 0;
    const tryPosition = () => {
      if (el.scrollLeft !== lastSetScrollLeft) return;
      if (el.scrollWidth < w * 0.9 && attempts < 30) {
        attempts++;
        requestAnimationFrame(tryPosition);
        return;
      }
      const todayX = el.scrollWidth * pct;
      const target = Math.max(0, todayX - el.clientWidth * 0.6);
      el.scrollLeft = target;
      lastSetScrollLeft = target;
    };
    requestAnimationFrame(tryPosition);
  });

  const xDomain = $derived.by((): [Date, Date] => {
    if (rows.length === 0 && actuals.length === 0) return [new Date(), new Date()];
    const allDates = [...rows.map(r => r.target_date), ...actuals.map(a => a.date)].sort();
    return [parseISO(allDates[0]), parseISO(allDates[allDates.length - 1])];
  });

  const yDomain = $derived.by((): [number, number] => {
    let lo = Infinity, hi = -Infinity;
    for (const r of rows) {
      if (visibleModels.has(r.model_name)) {
        if (r.yhat_lower < lo) lo = r.yhat_lower;
        if (r.yhat_upper > hi) hi = r.yhat_upper;
      }
    }
    for (const a of actuals) {
      if (a.value < lo) lo = a.value;
      if (a.value > hi) hi = a.value;
    }
    if (!isFinite(lo)) return [0, 1];
    const pad = (hi - lo) * 0.1 || 1;
    return [Math.max(0, lo - pad), hi + pad];
  });
</script>

<div data-testid="invoice-forecast-card" class="rounded-xl border border-zinc-200 bg-white p-4">
  <h2 class="text-base font-semibold text-zinc-900">{t(page.data.locale, 'invoice_forecast_card_title')}</h2>
  <p class="mt-1 text-xs text-zinc-500 text-balance">{t(page.data.locale, 'invoice_forecast_card_description')}</p>

  {#if rows.length === 0}
    <EmptyState card={emptyCard} />
  {:else}
    <div bind:this={scrollerRef} bind:clientWidth={cardW} class="mt-4 h-64 overflow-x-auto overscroll-x-contain chart-touch-safe">
      <Chart
        bind:context={chartCtx}
        data={rows.map(r => ({ ...r, target_date_d: parseISO(r.target_date) }))}
        x="target_date_d"
        y="yhat_mean"
        xScale={scaleTime()}
        yScale={scaleLinear()}
        xDomain={xDomain}
        yDomain={yDomain}
        width={chartW}
        padding={{ left: 40, bottom: 24, top: 12, right: 8 }}
        tooltipContext={{ mode: 'bisect-x', touchEvents: 'auto' }}
      >
        <Svg>
          <Axis placement="left" format={(n: number) => formatIntShort(n)} grid />
          <Axis placement="bottom" format={(d: Date) => format(d, 'MMM d')} />

          <!-- CI bands (option B: all visible models, low opacity) -->
          {#each Array.from(seriesByModel.entries()) as [modelName, modelRows] (modelName + '-band')}
            <Area
              data={modelRows.map(r => ({ ...r, d: parseISO(r.target_date) }))}
              x={(r: { d: Date }) => r.d}
              y0={(r: { yhat_lower: number }) => r.yhat_lower}
              y1={(r: { yhat_upper: number }) => r.yhat_upper}
              curve={curveMonotoneX}
              fill={FORECAST_MODEL_COLORS[modelName]}
              fillOpacity={0.06}
            />
          {/each}

          <!-- Past-forecast lines — solid faded ~70% opacity (D-02; mirror of
               CalendarRevenueCard:398-411 16.1-01 pattern). naive_dow keeps
               its dashed gray; others render solid faded. curveMonotoneX
               preserved on both branches per RESEARCH.md §16.1-05. -->
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
                curve={curveMonotoneX}
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
                curve={curveMonotoneX}
              />
            {/if}
          {/each}

          <!-- Actuals line (overlay during back-test window) -->
          {#if actuals.length > 0}
            <Spline
              data={actuals.map(a => ({ d: parseISO(a.date), v: a.value }))}
              x={(p: { d: Date }) => p.d}
              y={(p: { v: number }) => p.v}
              stroke="#0f172a"
              stroke-width={2}
            />
          {/if}

          <!-- Event markers -->
          {#if chartCtx}
            <EventMarker
              {events}
              xScale={(d) => chartCtx.xScale(typeof d === 'string' ? parseISO(d) : d)}
              height={chartCtx.height}
            />
          {/if}

          <!-- Phase 16.2-02 (D-05): per-Spline Highlight binding so each visible
               model's dot lands on its own Spline path. Replaces the chart-level
               <Highlight points lines /> which used bisect-x and drifted dots
               off-line for non-leading models. -->
          {#each Array.from(splitSeriesByModel.entries()) as [modelName, split] (`hl-${modelName}`)}
            {#if split.past.length > 0 || split.future.length > 0}
              {@const modelData = [...split.past, ...split.future].map((r) => ({ ...r, d: parseISO(r.target_date) }))}
              <Highlight
                data={modelData}
                x={(r: { d: Date }) => r.d}
                y={(r: { yhat_mean: number }) => r.yhat_mean}
                points={{ fill: FORECAST_MODEL_COLORS[modelName] }}
                lines={false}
              />
            {/if}
          {/each}
        </Svg>

        <!-- Phase 16.2-02 (D-04, C-01): multi-model Tooltip.List filtered by
             visibleModels. Replaces ForecastHoverPopup single-row consumer
             (kept on disk for diff legibility; v1.4 cleanup task). -->
        <Tooltip.Root contained="window" class="max-w-[92vw]">
          {#snippet children({ data })}
            {@const bucketIso = data?.target_date_d instanceof Date
              ? format(data.target_date_d, 'yyyy-MM-dd')
              : null}
            {@const modelRows = bucketIso === null
              ? []
              : Array.from(splitSeriesByModel.entries())
                  .filter(([name]) => visibleModels.has(name))
                  .map(([name, split]) => {
                    const r = split.past.find((x) => x.target_date === bucketIso)
                           ?? split.future.find((x) => x.target_date === bucketIso);
                    return r ? { name, row: r } : null;
                  })
                  .filter((x): x is { name: string; row: ForecastRow } => x !== null)}
            {#if modelRows.length > 0}
              <Tooltip.Header>{format(data.target_date_d as Date, 'MMM d')}</Tooltip.Header>
              <Tooltip.List>
                {#each modelRows as { name, row: fr } (`mr-${name}`)}
                  <Tooltip.Item
                    label={t(page.data.locale, `forecast_model_${name}` as MessageKey)}
                    color={FORECAST_MODEL_COLORS[name]}
                    value={formatIntShort(fr.yhat_mean as number)}
                  />
                {/each}
              </Tooltip.List>
            {/if}
          {/snippet}
        </Tooltip.Root>
      </Chart>
    </div>

    <ForecastLegend {availableModels} {visibleModels} ontoggle={toggleModel} />
  {/if}
</div>
