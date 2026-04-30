<script lang="ts">
  // ForecastHoverPopup — body content for the LayerChart hover-popup snippet slot.
  // Phase 15 FUI-04.
  //
  // IMPORTANT: This component does NOT own the LayerChart hover wrapper.
  // The parent (RevenueForecastCard in 15-08) owns the wrapper and renders
  // this component INSIDE its {#snippet children({ data })} block. Per
  // memory feedback_svelte5_tooltip_snippet, the wrapper + the legacy
  // slot-prop pattern throws invalid_default_snippet at runtime in
  // Svelte 5; {#snippet children} is the only correct pattern.
  //
  // Auto-flip on right-edge overflow is handled by the parent wrapper's
  // built-in `contained="window"` prop (CalendarRevenueCard precedent).
  //
  // 6 fields per FUI-04:
  //   1. Forecast value + 95% CI for the hovered date
  //   2. Horizon (days from today)
  //   3. last_7_days RMSE / MAPE / bias / direction-hit-rate
  //   4. Cumulative deviation since campaign launch
  //   5. Last refit timestamp ("ago" formatted)
  //   6. (model name is the visual header; not numbered as a "field")
  //
  // Empty-state for accuracy block: when qualityByModelHorizon has no row
  // for (model_name, horizon_days), render the
  // empty_forecast_quality_empty_body copy (FUI-08, key from 15-01 Task 3).
  import { page } from '$app/state';
  import { t } from '$lib/i18n/messages';
  import { formatEUR } from '$lib/format';
  import { formatDistanceToNowStrict } from 'date-fns';

  type HoveredRow = {
    target_date: string;
    model_name: string;
    yhat_mean: number;
    yhat_lower: number;
    yhat_upper: number;
    horizon_days: number;
  };

  type QualityKeyMap = ReadonlyMap<string, {
    rmse: number;
    mape: number;
    mean_bias: number;
    direction_hit_rate: number | null;
  }>;

  let {
    hoveredRow,
    qualityByModelHorizon,
    cumulativeDeviationEur,
    lastRun
  }: {
    hoveredRow: HoveredRow;
    qualityByModelHorizon: QualityKeyMap;
    cumulativeDeviationEur: number | null;
    lastRun: string | null;
  } = $props();

  const loc = $derived(page.data.locale);

  // Look up forecast_quality row for the hovered model + horizon.
  const qualityKey = $derived(`${hoveredRow.model_name}|${hoveredRow.horizon_days}`);
  const quality = $derived(qualityByModelHorizon.get(qualityKey) ?? null);

  const horizonText = $derived.by(() => {
    const n = hoveredRow.horizon_days;
    return t(loc, n === 1 ? 'popup_horizon_days_one' : 'popup_horizon_days_many', { n });
  });

  const lastRefitAgo = $derived.by(() => {
    if (!lastRun) return null;
    return formatDistanceToNowStrict(new Date(lastRun), { roundingMethod: 'floor' });
  });
</script>

<div data-testid="forecast-hover-popup" class="min-w-[200px] max-w-[280px] rounded-lg border border-zinc-200 bg-white p-3 shadow-md">
  <!-- Header: model name + date -->
  <div class="flex items-baseline justify-between gap-2 border-b border-zinc-100 pb-1.5">
    <span class="text-xs font-semibold text-zinc-900">{hoveredRow.model_name}</span>
    <span class="text-[10px] tabular-nums text-zinc-500">{hoveredRow.target_date}</span>
  </div>

  <!-- Field 1: forecast value + 95% CI -->
  <div class="mt-2 space-y-0.5">
    <div class="flex items-baseline justify-between gap-2 text-[11px]">
      <span class="text-zinc-500">{t(loc, 'popup_forecast')}</span>
      <span data-testid="popup-forecast-value" class="font-semibold tabular-nums text-zinc-900">
        {formatEUR(hoveredRow.yhat_mean * 100)}
      </span>
    </div>
    <div class="flex items-baseline justify-between gap-2 text-[10px] text-zinc-500">
      <span>{t(loc, 'popup_ci_95')}</span>
      <span data-testid="popup-ci-low-high" class="tabular-nums">
        {formatEUR(hoveredRow.yhat_lower * 100)}&nbsp;–&nbsp;{formatEUR(hoveredRow.yhat_upper * 100)}
      </span>
    </div>
  </div>

  <!-- Field 2: horizon -->
  <p data-testid="popup-horizon" class="mt-2 text-[10px] text-zinc-500">
    {horizonText}
  </p>

  <!-- Field 3: 4 quality metrics — or empty state -->
  {#if quality}
    <div class="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 border-t border-zinc-100 pt-1.5 text-[10px]">
      <span class="text-zinc-500">{t(loc, 'popup_rmse')}</span>
      <span data-testid="popup-rmse" class="tabular-nums text-right text-zinc-900">{quality.rmse.toFixed(0)}</span>

      <span class="text-zinc-500">{t(loc, 'popup_mape')}</span>
      <span data-testid="popup-mape" class="tabular-nums text-right text-zinc-900">{(quality.mape * 100).toFixed(1)}%</span>

      <span class="text-zinc-500">{t(loc, 'popup_bias')}</span>
      <span data-testid="popup-bias" class="tabular-nums text-right text-zinc-900">{quality.mean_bias.toFixed(1)}</span>

      {#if quality.direction_hit_rate !== null}
        <span class="text-zinc-500">{t(loc, 'popup_direction_hit')}</span>
        <span data-testid="popup-direction-hit" class="tabular-nums text-right text-zinc-900">{Math.round(quality.direction_hit_rate * 100)}%</span>
      {/if}
    </div>
  {:else}
    <p
      data-testid="popup-quality-empty"
      class="mt-2 border-t border-zinc-100 pt-1.5 text-[10px] italic text-zinc-400"
    >
      {t(loc, 'empty_forecast_quality_empty_body')}
    </p>
  {/if}

  <!-- Field 4: cumulative deviation since campaign -->
  {#if cumulativeDeviationEur !== null}
    <div class="mt-2 flex items-baseline justify-between gap-2 border-t border-zinc-100 pt-1.5 text-[10px]">
      <span class="text-zinc-500">{t(loc, 'popup_uplift_since_campaign')}</span>
      <span
        data-testid="popup-uplift"
        class="tabular-nums font-medium {cumulativeDeviationEur >= 0 ? 'text-emerald-600' : 'text-red-600'}"
      >
        {cumulativeDeviationEur >= 0 ? '+' : ''}{formatEUR(cumulativeDeviationEur * 100)}
      </span>
    </div>
  {/if}

  <!-- Field 5: last refit timestamp -->
  {#if lastRefitAgo}
    <p data-testid="popup-last-refit" class="mt-2 text-[10px] text-zinc-400">
      {t(loc, 'popup_last_refit', { ago: lastRefitAgo })}
    </p>
  {/if}
</div>
