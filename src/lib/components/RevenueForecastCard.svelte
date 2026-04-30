<script lang="ts">
  // RevenueForecastCard — composed forecast card for Phase 15.
  //
  // Layout:
  //   header (title + stale-data + uncalibrated-CI badges)
  //   description (1-line)
  //   HorizonToggle row
  //   <Chart> with:
  //     • Area (CI band, sarimax_bau, 15% fill — D-02)
  //     • Spline (per-model lines, naive dashed gray — D-10)
  //     • Rule at today (gray-500 — D-03)
  //     • EventMarker layer (D-09)
  //     • Tooltip.Root → ForecastHoverPopup (FUI-04 / C-06 — Svelte 5 snippet pattern)
  //   ForecastLegend chip row (D-04)
  //
  // The card is presentational: it OWNS horizon / granularity / visibleModels
  // local UI state but receives the resolved forecast / quality / uplift
  // payloads from the parent (+page.svelte) via props. The parent runs the
  // three deferred clientFetch calls behind LazyMount per Phase 11 D-03.
  // Two-way binding (`bind:horizon`, `bind:granularity`) lets the parent
  // re-fetch /api/forecast on chip clicks via $effect.
  //
  // LayerChart 2.x context: <Svg> only exposes `{ ref }` to its children
  // snippet, NOT xScale/height. To slot EventMarker (which needs xScale +
  // height as props), we bind the chart context via `bind:context={chartCtx}`
  // on <Chart> and reference chartCtx.xScale / chartCtx.height inside <Svg>.
  // Same pattern as CalendarRevenueCard.svelte:96.
  import { Chart, Svg, Axis, Spline, Area, Rule, Highlight, Tooltip } from 'layerchart';
  import { scaleTime, scaleLinear } from 'd3-scale';
  import { curveMonotoneX } from 'd3-shape';
  import { addDays, parseISO, format } from 'date-fns';
  import { page } from '$app/state';
  import { t } from '$lib/i18n/messages';
  import { formatEURShort } from '$lib/format';
  import EmptyState from './EmptyState.svelte';
  import HorizonToggle from './HorizonToggle.svelte';
  import ForecastLegend from './ForecastLegend.svelte';
  import EventMarker from './EventMarker.svelte';
  import ForecastHoverPopup from './ForecastHoverPopup.svelte';
  import { FORECAST_MODEL_COLORS } from '$lib/chartPalettes';
  import {
    type Horizon,
    type Granularity,
    DEFAULT_GRANULARITY
  } from '$lib/forecastValidation';
  import type { ForecastEvent } from '$lib/forecastEventClamp';

  // ----- Prop types (parent feeds resolved client-fetch payloads) -----
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
  } | null;
  type QualityRow = {
    model_name: string;
    kpi_name: string;
    horizon_days: number;
    rmse: number;
    mape: number;
    mean_bias: number;
    direction_hit_rate: number | null;
    evaluated_at: string;
  };
  type UpliftPayload = {
    campaign_start: string;
    cumulative_deviation_eur: number;
    as_of: string;
  } | null;

  let {
    forecastData,
    qualityData,
    campaignUpliftData,
    stalenessHours,
    horizon = $bindable(7 as Horizon),
    granularity = $bindable(DEFAULT_GRANULARITY[7])
  }: {
    forecastData: ForecastPayload;
    qualityData: QualityRow[];
    campaignUpliftData: UpliftPayload;
    stalenessHours: number;
    horizon?: Horizon;
    granularity?: Granularity;
  } = $props();

  // ----- Local UI state -----
  let visibleModels = $state(new Set<string>(['sarimax_bau', 'naive_dow']));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let chartCtx = $state<any>();

  function toggleModel(modelName: string) {
    const next = new Set(visibleModels);
    if (next.has(modelName)) next.delete(modelName);
    else next.add(modelName);
    visibleModels = next;
  }

  // ----- Derivations -----
  const rows = $derived(forecastData?.rows ?? []);
  const actuals = $derived(forecastData?.actuals ?? []);
  const events = $derived(forecastData?.events ?? []);
  const lastRun = $derived(forecastData?.last_run ?? null);

  const availableModels = $derived(Array.from(new Set(rows.map(r => r.model_name))));

  // Build per-model row arrays. Naive baseline always shown when present
  // (FUI-02). Other models honor visibleModels.
  const seriesByModel = $derived.by(() => {
    const map = new Map<string, ForecastRow[]>();
    for (const r of rows) {
      if (!visibleModels.has(r.model_name) && r.model_name !== 'naive_dow') continue;
      if (!map.has(r.model_name)) map.set(r.model_name, []);
      map.get(r.model_name)!.push(r);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.target_date.localeCompare(b.target_date));
    }
    return map;
  });

  // CI band: only the primary forecast (sarimax_bau) renders its band.
  // Other models' bands would create visual mush at 375px.
  const PRIMARY_MODEL = 'sarimax_bau';
  const bandRows = $derived(seriesByModel.get(PRIMARY_MODEL) ?? []);

  const xDomain = $derived.by((): [Date, Date] => {
    const today = new Date();
    return [today, addDays(today, horizon)];
  });

  const yDomain = $derived.by((): [number, number] => {
    const all = bandRows.length > 0 ? bandRows : rows;
    if (all.length === 0) return [0, 1];
    let lo = Infinity, hi = -Infinity;
    for (const r of all) {
      if (r.yhat_lower < lo) lo = r.yhat_lower;
      if (r.yhat_upper > hi) hi = r.yhat_upper;
    }
    for (const a of actuals) {
      if (a.value < lo) lo = a.value;
      if (a.value > hi) hi = a.value;
    }
    const pad = (hi - lo) * 0.1 || 100;
    return [Math.max(0, lo - pad), hi + pad];
  });

  const today = $derived(new Date());

  // forecast_quality lookup map keyed by `${model_name}|${horizon_days}`.
  const qualityMap = $derived.by(() => {
    const m = new Map<string, QualityRow>();
    for (const q of qualityData) {
      if (q.kpi_name !== 'revenue_eur') continue;
      m.set(`${q.model_name}|${q.horizon_days}`, q);
    }
    return m;
  });

  // ----- Badges -----
  const showStaleBadge = $derived(stalenessHours > 24);
  // Uncalibrated-CI: fires on 1yr horizon. Phase 17 backtest gate is the
  // condition for dropping the badge once history >= 730 days.
  const showUncalibratedBadge = $derived(horizon === 365);

  // ----- HorizonToggle handlers — write back through the bindable props -----
  function onHorizonChange(h: Horizon) { horizon = h; }
  function onGranularityChange(g: Granularity) { granularity = g; }
</script>

<div data-testid="revenue-forecast-card" class="rounded-xl border border-zinc-200 bg-white p-4">
  <!-- Header -->
  <div class="flex items-center justify-between gap-2">
    <h2 class="text-base font-semibold text-zinc-900">
      {t(page.data.locale, 'forecast_card_title')}
    </h2>
    <div class="flex items-center gap-1.5">
      {#if showStaleBadge}
        <span
          data-testid="forecast-stale-badge"
          class="rounded bg-yellow-50 px-1.5 py-0.5 text-[10px] font-medium text-yellow-700 ring-1 ring-inset ring-yellow-200"
        >
          {t(page.data.locale, 'empty_forecast_stale_heading')}
        </span>
      {/if}
      {#if showUncalibratedBadge}
        <span
          data-testid="forecast-uncalibrated-badge"
          class="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200"
        >
          {t(page.data.locale, 'forecast_uncalibrated_badge')}
        </span>
      {/if}
    </div>
  </div>
  <p class="mt-1 text-xs text-zinc-500 text-balance">
    {t(page.data.locale, 'forecast_card_description')}
  </p>

  <!-- Horizon row -->
  <div class="mt-3">
    <HorizonToggle
      {horizon}
      onhorizonchange={onHorizonChange}
      ongranularitychange={onGranularityChange}
    />
  </div>

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
          <Axis placement="left"   format={formatEURShort} grid />
          <Axis placement="bottom" format={(d: Date) => format(d, 'MMM d')} />

          <!-- CI band (back layer) — sarimax_bau only -->
          {#if bandRows.length > 0}
            <Area
              data={bandRows.map(r => ({ ...r, d: parseISO(r.target_date) }))}
              x={(r: { d: Date }) => r.d}
              y0={(r: { yhat_lower: number }) => r.yhat_lower}
              y1={(r: { yhat_upper: number }) => r.yhat_upper}
              curve={curveMonotoneX}
              fill={FORECAST_MODEL_COLORS[PRIMARY_MODEL]}
              fillOpacity={0.15}
            />
          {/if}

          <!-- Per-model forecast lines -->
          {#each Array.from(seriesByModel.entries()) as [modelName, modelRows] (modelName)}
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

          <!-- Actuals overlay (historical context) -->
          {#if actuals.length > 0}
            <Spline
              data={actuals.map(a => ({ d: parseISO(a.date), v: a.value }))}
              x={(p: { d: Date }) => p.d}
              y={(p: { v: number }) => p.v}
              stroke="#0f172a"
              stroke-width={2}
            />
          {/if}

          <!-- "Today" reference rule -->
          <Rule x={today} stroke="#71717a" stroke-width={1} />

          <!-- EventMarker layer — slotted inside Svg so it shares the axes.
               LayerChart's <Svg> children-snippet only exposes { ref };
               we read xScale + height from the chart context (bind:context). -->
          {#if chartCtx}
            <EventMarker
              {events}
              xScale={(d) => chartCtx.xScale(typeof d === 'string' ? parseISO(d) : d)}
              height={chartCtx.height}
            />
          {/if}

          <Highlight points lines />
        </Svg>

        <!-- Tooltip.Root with snippet children — Svelte 5 / LayerChart 2.x
             contract per memory feedback_svelte5_tooltip_snippet.
             let:data throws invalid_default_snippet at runtime. -->
        <Tooltip.Root contained="window" class="max-w-[92vw]">
          {#snippet children({ data })}
            {#if data}
              <ForecastHoverPopup
                hoveredRow={{
                  target_date: format(data.target_date_d as Date, 'yyyy-MM-dd'),
                  model_name: (data.model_name as string) ?? PRIMARY_MODEL,
                  yhat_mean: data.yhat_mean as number,
                  yhat_lower: data.yhat_lower as number,
                  yhat_upper: data.yhat_upper as number,
                  horizon_days: data.horizon_days as number
                }}
                qualityByModelHorizon={qualityMap}
                cumulativeDeviationEur={campaignUpliftData?.cumulative_deviation_eur ?? null}
                lastRun={lastRun}
              />
            {/if}
          {/snippet}
        </Tooltip.Root>
      </Chart>
    </div>

    <!-- Legend chip row (D-04) -->
    <ForecastLegend
      availableModels={availableModels}
      visibleModels={visibleModels}
      ontoggle={toggleModel}
    />
  {/if}
</div>
