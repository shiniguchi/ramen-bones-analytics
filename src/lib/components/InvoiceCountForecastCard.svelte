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
  import { t } from '$lib/i18n/messages';
  import { formatIntShort } from '$lib/format';
  import { clientFetch } from '$lib/clientFetch';
  import { getFilters } from '$lib/dashboardStore.svelte';
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
    <EmptyState card="forecast-loading" />
  {:else}
    <div class="mt-4 h-64 chart-touch-safe">
      <Chart
        bind:context={chartCtx}
        data={rows.map(r => ({ ...r, target_date_d: parseISO(r.target_date) }))}
        x="target_date_d"
        y="yhat_mean"
        xScale={scaleTime()}
        yScale={scaleLinear()}
        xDomain={xDomain}
        yDomain={yDomain}
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

          <!-- Forecast lines -->
          {#each Array.from(seriesByModel.entries()) as [modelName, modelRows] (modelName + '-line')}
            {@const isNaive = modelName === 'naive_dow'}
            <Spline
              data={modelRows.map(r => ({ ...r, d: parseISO(r.target_date) }))}
              x={(r: { d: Date }) => r.d}
              y={(r: { yhat_mean: number }) => r.yhat_mean}
              curve={curveMonotoneX}
              stroke={FORECAST_MODEL_COLORS[modelName]}
              stroke-width={isNaive ? 1 : 2}
              stroke-dasharray={isNaive ? '4 4' : undefined}
            />
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

          <Highlight points lines />
        </Svg>

        <Tooltip.Root contained="window" class="max-w-[92vw]">
          {#snippet children({ data })}
            {#if data}
              <ForecastHoverPopup
                hoveredRow={{
                  target_date: format(data.target_date_d as Date, 'yyyy-MM-dd'),
                  model_name: (data.model_name as string) ?? 'sarimax',
                  yhat_mean: data.yhat_mean as number,
                  yhat_lower: data.yhat_lower as number,
                  yhat_upper: data.yhat_upper as number,
                  horizon_days: data.horizon_days as number
                }}
                qualityByModelHorizon={new Map()}
                cumulativeDeviationEur={null}
                lastRun={lastRun}
              />
            {/if}
          {/snippet}
        </Tooltip.Root>
      </Chart>
    </div>

    <ForecastLegend {availableModels} {visibleModels} ontoggle={toggleModel} />
  {/if}
</div>
