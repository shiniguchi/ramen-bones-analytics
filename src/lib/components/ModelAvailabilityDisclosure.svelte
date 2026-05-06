<script lang="ts">
  // Phase 16.2 polish (2026-05-05): per-model availability disclosure beneath
  // the ForecastLegend chip row. Owner asked: "why don't I see SARIMAX, ETS,
  // Theta, Chronos, NeuralProphet at week/month?" Answer is structural — the
  // pipeline writes naive_dow + prophet at non-day grain by design (CONTEXT.md
  // 16.2 deferred entry; .planning/PROJECT.md "Forecast Model Availability
  // Matrix"). This component surfaces the rationale inline so the answer is
  // discoverable without reading docs.
  //
  // The min-data thresholds come from scripts/forecast/grain_helpers.py
  // (YEARLY_THRESHOLD_BY_GRAIN: 730 daily / 104 weekly / 24 monthly buckets
  // for SARIMAX/ETS/Theta yearly seasonality activation). prophet auto-degrades
  // gracefully below threshold so it works at lower bucket counts.
  // chronos/neuralprophet are feature-flagged off via FORECAST_ENABLED_MODELS
  // in .github/workflows/forecast-refresh.yml; they land in Phase 17.
  import { page } from '$app/state';
  import { t, type MessageKey } from '$lib/i18n/messages';
  import { FORECAST_MODEL_COLORS } from '$lib/chartPalettes';

  // Phase 17 BCK-01/BCK-02 — backtest verdict types.
  type BacktestVerdict = 'PASS' | 'FAIL' | 'PENDING' | 'UNCALIBRATED' | null;
  type ModelBacktestRow = { h7?: BacktestVerdict; h35?: BacktestVerdict; h120?: BacktestVerdict; h365?: BacktestVerdict };

  let {
    availableModels,
    grain,
    backtestStatus = null
  }: {
    availableModels: readonly string[];
    grain: 'day' | 'week' | 'month';
    backtestStatus?: { [model: string]: ModelBacktestRow } | null;
  } = $props();

  // Phase 17 — horizon list and key map for pill rendering.
  const HORIZONS = [7, 35, 120, 365] as const;
  const HORIZON_KEY: Record<number, keyof ModelBacktestRow> = { 7: 'h7', 35: 'h35', 120: 'h120', 365: 'h365' };

  // Returns Tailwind bg+text classes for a given verdict (or null/undefined fallback).
  function verdictColorClass(status: BacktestVerdict | undefined): string {
    switch (status) {
      case 'PASS':         return 'bg-emerald-100 text-emerald-800';
      case 'FAIL':         return 'bg-rose-100 text-rose-800';
      case 'PENDING':      return 'bg-zinc-100 text-zinc-700';
      case 'UNCALIBRATED': return 'bg-amber-100 text-amber-800';
      default:             return 'bg-zinc-50 text-zinc-400';
    }
  }

  // Returns the i18n MessageKey for the compact short-form verdict symbol.
  function verdictShortKey(status: BacktestVerdict | undefined): MessageKey {
    switch (status) {
      case 'PASS':         return 'model_avail_backtest_short_pass';
      case 'FAIL':         return 'model_avail_backtest_short_fail';
      case 'UNCALIBRATED': return 'model_avail_backtest_short_uncalibrated';
      default:             return 'model_avail_backtest_short_pending';
    }
  }

  type ModelInfo = {
    key: string;
    minDay: number | null;
    minWeek: number | null;
    minMonth: number | null;
    enabledByFlag: boolean;
  };

  // Min-data thresholds per grain — values represent "minimum buckets needed
  // for the model to BE available at this grain". Sources:
  //   day grain: ~30 buckets to fit AR/MA + weekly seasonality (sarimax/ets/theta).
  //     Prophet auto-degrades gracefully below this. Naive_DoW needs 7 days.
  //   week/month grain: scripts/forecast/grain_helpers.py YEARLY_THRESHOLD_BY_GRAIN
  //     (104 weeks / 24 months) is the HARD gate per workflow log error
  //     "Insufficient week history: 41 buckets (need >= 104)". Below threshold,
  //     sarimax/ets/theta fit refuses to run.
  //   prophet at week/month: works with much less (~8 weeks / ~4 months) per
  //     prophet_fit.py YEARLY_THRESHOLD_BY_GRAIN gating only yearly seasonality
  //     not the fit itself.
  //   naive_dow at week/month: trivial (just needs ≥1 bucket).
  //   chronos/neuralprophet: feature-flagged off via FORECAST_ENABLED_MODELS env
  //     in .github/workflows/forecast-refresh.yml — Phase 17 territory.
  const MODELS: ModelInfo[] = [
    { key: 'sarimax',       minDay: 30,  minWeek: 104, minMonth: 24, enabledByFlag: true  },
    { key: 'prophet',       minDay: 30,  minWeek: 8,   minMonth: 4,  enabledByFlag: true  },
    { key: 'ets',           minDay: 30,  minWeek: 104, minMonth: 24, enabledByFlag: true  },
    { key: 'theta',         minDay: 30,  minWeek: 104, minMonth: 24, enabledByFlag: true  },
    { key: 'naive_dow',     minDay: 7,   minWeek: 1,   minMonth: 1,  enabledByFlag: true  },
    { key: 'chronos',       minDay: null, minWeek: null, minMonth: null, enabledByFlag: false },
    { key: 'neuralprophet', minDay: null, minWeek: null, minMonth: null, enabledByFlag: false }
  ];

  let detailsOpen = $state(false);

  function minForGrain(info: ModelInfo): number | null {
    if (!info.enabledByFlag) return null;
    return grain === 'day' ? info.minDay : grain === 'week' ? info.minWeek : info.minMonth;
  }

  function statusKey(info: ModelInfo, available: boolean): MessageKey {
    if (available) return 'model_avail_status_available';
    if (!info.enabledByFlag) return 'model_avail_status_phase17';
    return `model_avail_status_short_${grain}` as MessageKey;
  }

  // Unit label for the current grain — shown inline in the Min-data cell.
  // Replaces the prior footnote that explained units separately.
  const unitLabel = $derived(t(page.data.locale, `model_avail_unit_${grain}` as MessageKey));
</script>

<div class="mt-2 text-xs">
  <button
    type="button"
    class="inline-flex items-center gap-1 text-zinc-600 hover:text-zinc-900 hover:underline underline-offset-2"
    aria-expanded={detailsOpen}
    aria-controls="model-availability-panel"
    onclick={() => (detailsOpen = !detailsOpen)}
    data-testid="model-avail-trigger"
  >
    {t(page.data.locale, 'model_avail_disclosure_trigger')}
    <span aria-hidden="true">{detailsOpen ? '⌄' : '›'}</span>
  </button>

  {#if detailsOpen}
    <div
      id="model-availability-panel"
      class="mt-2 rounded-md bg-zinc-50 p-3 text-zinc-600"
      data-testid="model-avail-panel"
    >
      <p class="mb-2 text-[11px]">{t(page.data.locale, 'model_avail_disclosure_intro')}</p>
      <!-- 16.2 polish (friend feedback 2026-05-05): horizontal-scroll wrapper so
           the 4-column table doesn't cramp on narrow viewports. min-w-[640px]
           gives columns breathing room; overflow-x-auto + overscroll-x-contain
           confines the scroll to this region (matches CalendarRevenueCard:200
           pattern). -mx-3 lets the table extend slightly past the panel's px-3
           padding for max usable width. -->
      <div class="-mx-3 overflow-x-auto overscroll-x-contain px-3">
        <table class="w-full min-w-[840px] text-[11px]">
          <thead>
          <tr class="border-b border-zinc-200 text-zinc-500">
            <th class="pb-1 text-left font-medium">{t(page.data.locale, 'model_avail_col_model')}</th>
            <th class="pb-1 text-left font-medium">{t(page.data.locale, 'model_avail_col_status')}</th>
            <th class="pb-1 pr-4 text-right font-medium">{t(page.data.locale, 'model_avail_col_min')}</th>
            <th class="pb-1 pl-2 text-left font-medium">{t(page.data.locale, 'model_avail_col_why')}</th>
            <th class="pb-1 pl-2 text-left font-medium">{t(page.data.locale, 'model_avail_col_backtest')}</th>
          </tr>
        </thead>
        <tbody>
          {#each MODELS as info (info.key)}
            {@const available = availableModels.includes(info.key)}
            {@const minVal = minForGrain(info)}
            <tr>
              <td class="py-0.5 align-top">
                <span class="inline-flex items-center gap-1.5">
                  <span
                    class="inline-block h-2 w-2 rounded-full {available ? '' : 'opacity-30'}"
                    style:background-color={FORECAST_MODEL_COLORS[info.key]}
                  ></span>
                  <span>{t(page.data.locale, `legend_model_${info.key}` as MessageKey)}</span>
                </span>
              </td>
              <td class="py-0.5 align-top {available ? 'text-emerald-700' : 'text-zinc-500'}">
                {t(page.data.locale, statusKey(info, available))}
              </td>
              <td class="py-0.5 pr-4 align-top text-right tabular-nums whitespace-nowrap">
                {minVal === null ? '—' : `${minVal} ${unitLabel}`}
              </td>
              <td class="py-0.5 pl-2 align-top text-zinc-500">
                {t(page.data.locale, `model_avail_why_${info.key}` as MessageKey)}
              </td>
              <!-- Phase 17 BCK-01/BCK-02 — 4 horizon verdict pills (h=7/35/120/365) -->
              <td class="py-0.5 pl-2 align-top">
                <div class="flex gap-1 text-[10px]">
                  {#each HORIZONS as h}
                    {@const status = backtestStatus?.[info.key]?.[HORIZON_KEY[h]] ?? null}
                    <span
                      class="rounded px-1.5 py-0.5 whitespace-nowrap {verdictColorClass(status)}"
                      data-testid="backtest-pill-{info.key}-h{h}"
                      title={t(page.data.locale, `model_avail_backtest_${(status ?? 'pending').toLowerCase()}` as MessageKey)}
                    >
                      {h}d {t(page.data.locale, verdictShortKey(status))}
                    </span>
                  {/each}
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
        </table>
      </div>
    </div>
  {/if}
</div>
