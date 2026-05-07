<script lang="ts">
  import { page } from '$app/state';
  import { t, type MessageKey } from '$lib/i18n/messages';
  import { FORECAST_MODEL_COLORS } from '$lib/chartPalettes';
  import type { BacktestMetric, ModelBacktestMetrics } from '$lib/forecastOverlay.svelte';

  type BacktestVerdict = 'PASS' | 'FAIL' | 'PENDING' | 'UNCALIBRATED' | null;
  type ModelBacktestRow = { h7?: BacktestVerdict; h35?: BacktestVerdict; h120?: BacktestVerdict; h365?: BacktestVerdict };

  let {
    availableModels,
    grain,
    kpi = 'revenue_eur',
    backtestStatus = null,
    backtestMetrics = null,
    backtestLastMeasured = null
  }: {
    availableModels: readonly string[];
    grain: 'day' | 'week' | 'month';
    kpi?: 'revenue_eur' | 'invoice_count';
    backtestStatus?: { [model: string]: ModelBacktestRow } | null;
    backtestMetrics?: { [model: string]: ModelBacktestMetrics } | null;
    backtestLastMeasured?: string | null;
  } = $props();

  function fmtDate(iso: string | null | undefined): string {
    if (!iso) return '';
    return iso.slice(0, 10);
  }

  const HORIZON_KEY: Record<number, keyof ModelBacktestRow> = { 7: 'h7', 35: 'h35', 120: 'h120', 365: 'h365' };

  type ModelInfo = {
    key: string;
    minDay: number | null;
    minWeek: number | null;
    minMonth: number | null;
    enabledByFlag: boolean;
  };

  const MODELS: ModelInfo[] = [
    { key: 'sarimax',       minDay: 30,  minWeek: 104, minMonth: 24, enabledByFlag: true  },
    { key: 'prophet',       minDay: 30,  minWeek: 8,   minMonth: 4,  enabledByFlag: true  },
    { key: 'ets',           minDay: 30,  minWeek: 104, minMonth: 24, enabledByFlag: true  },
    { key: 'theta',         minDay: 30,  minWeek: 104, minMonth: 24, enabledByFlag: true  },
    { key: 'naive_dow',     minDay: 7,   minWeek: 1,   minMonth: 1,  enabledByFlag: true  },
    { key: 'chronos',       minDay: null, minWeek: null, minMonth: null, enabledByFlag: false },
    { key: 'neuralprophet', minDay: null, minWeek: null, minMonth: null, enabledByFlag: false }
  ];

  // Which external signals each model uses (architectural fact, not user-configurable)
  const MODEL_INPUTS: Record<string, string> = {
    naive_dow:             'Day-of-week avg',
    naive_dow_with_holidays: 'DoW + holidays / events',
    sarimax:               'DoW + holidays + weather',
    prophet:               'DoW + holidays + weather',
    ets:                   'Univariate',
    theta:                 'Univariate',
    chronos:               '—',
    neuralprophet:         '—',
  };

  const rmseUnit = $derived(kpi === 'revenue_eur' ? '€' : 'orders');

  const naiveTitleKey  = $derived(kpi === 'revenue_eur' ? 'model_avail_ctx_naive_title_revenue' : 'model_avail_ctx_naive_title_count');
  const naiveBodyKey   = $derived(kpi === 'revenue_eur' ? 'model_avail_ctx_naive_body_revenue'  : 'model_avail_ctx_naive_body_count');

  const h7Rankings = $derived(
    (() => {
      const withData = MODELS
        .map(m => ({ key: m.key, rmse: backtestMetrics?.[m.key]?.h7?.rmse ?? null }))
        .filter((m): m is { key: string; rmse: number } => m.rmse !== null)
        .sort((a, b) => a.rmse - b.rmse);
      return Object.fromEntries(withData.map((m, i) => [m.key, i + 1]));
    })()
  );

  const sortedModels = $derived(
    [...MODELS].sort((a, b) => {
      const ra = h7Rankings[a.key] ?? Infinity;
      const rb = h7Rankings[b.key] ?? Infinity;
      if (!a.enabledByFlag && b.enabledByFlag) return 1;
      if (a.enabledByFlag && !b.enabledByFlag) return -1;
      return ra - rb;
    })
  );

  function rankBadgeClass(rank: number | null): string {
    switch (rank) {
      case 1:  return 'bg-emerald-100 text-emerald-800 font-bold';
      case 2:  return 'bg-sky-100 text-sky-800 font-semibold';
      case 3:  return 'bg-amber-100 text-amber-800 font-semibold';
      default: return 'bg-zinc-100 text-zinc-600';
    }
  }

  function verdictIcon(status: BacktestVerdict | undefined): string {
    switch (status) {
      case 'PASS':         return '✓';
      case 'FAIL':         return '✗';
      case 'UNCALIBRATED': return '?';
      default:             return '';
    }
  }

  function verdictIconClass(status: BacktestVerdict | undefined): string {
    switch (status) {
      case 'PASS':         return 'text-emerald-600';
      case 'FAIL':         return 'text-rose-600';
      case 'UNCALIBRATED': return 'text-amber-500';
      default:             return 'text-zinc-400';
    }
  }

  function statusKey(info: ModelInfo, available: boolean): MessageKey {
    if (available) return 'model_avail_status_available';
    if (!info.enabledByFlag) return 'model_avail_status_phase17';
    return `model_avail_status_short_${grain}` as MessageKey;
  }

  const unitLabel = $derived(t(page.data.locale, `model_avail_unit_${grain}` as MessageKey));

  function minForGrain(info: ModelInfo): number | null {
    if (!info.enabledByFlag) return null;
    return grain === 'day' ? info.minDay : grain === 'week' ? info.minWeek : info.minMonth;
  }

  let detailsOpen = $state(false);
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

      <!-- Model table -->
      <div class="-mx-3 overflow-x-auto overscroll-x-contain px-3">
        <table class="w-full min-w-[760px] text-[11px]">
          <thead>
            <tr class="border-b border-zinc-200 text-zinc-500">
              <th class="pb-1 text-left font-medium whitespace-nowrap">{t(page.data.locale, 'model_avail_col_model')}</th>
              <th class="pb-1 text-left font-medium whitespace-nowrap">{t(page.data.locale, 'model_avail_col_status')}</th>
              <th class="pb-1 pr-4 text-right font-medium whitespace-nowrap">{t(page.data.locale, 'model_avail_col_min')}</th>
              <th class="pb-1 pl-2 text-left font-medium whitespace-nowrap">{t(page.data.locale, 'model_avail_col_inputs')}</th>
              <th class="pb-1 pl-2 text-left font-medium whitespace-nowrap">{t(page.data.locale, 'model_avail_col_why')}</th>
              <th class="pb-1 pl-2 text-left font-medium whitespace-nowrap">
                {t(page.data.locale, 'model_avail_col_backtest')}
                <span class="ml-1 font-normal text-zinc-400">(7d RMSE {rmseUnit}, ↓ better)</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {#each sortedModels as info (info.key)}
              {@const available = availableModels.includes(info.key)}
              {@const minVal = minForGrain(info)}
              {@const h7Rmse = backtestMetrics?.[info.key]?.h7?.rmse ?? null}
              {@const h7Status = backtestStatus?.[info.key]?.h7 ?? null}
              {@const rank = h7Rankings[info.key] ?? null}
              <tr class="{rank === 1 ? 'bg-emerald-50/60' : ''}">
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
                <td class="py-0.5 pl-2 align-top text-zinc-500 whitespace-nowrap">
                  {MODEL_INPUTS[info.key] ?? '—'}
                </td>
                <td class="py-0.5 pl-2 align-top text-zinc-500">
                  {t(page.data.locale, `model_avail_why_${info.key}` as MessageKey)}
                </td>
                <td class="py-0.5 pl-2 align-top" data-testid="backtest-pill-{info.key}-h7">
                  {#if !info.enabledByFlag}
                    <span class="text-zinc-300">—</span>
                  {:else if h7Rmse !== null}
                    <span class="inline-flex items-center gap-1.5">
                      <span class="rounded px-1.5 py-0.5 text-[10px] tabular-nums {rankBadgeClass(rank)}">
                        {rank !== null ? `#${rank}` : ''}
                      </span>
                      <span class="tabular-nums font-medium text-zinc-700">{Math.round(h7Rmse)}</span>
                      <span class="{verdictIconClass(h7Status)}" title={h7Status ?? ''}>{verdictIcon(h7Status)}</span>
                    </span>
                    <div class="mt-0.5 flex gap-2 text-[10px] text-zinc-400">
                      {#each [35, 120, 365] as h}
                        {@const m = backtestMetrics?.[info.key]?.[HORIZON_KEY[h]]}
                        <span data-testid="backtest-pill-{info.key}-h{h}">
                          h{h}: {m?.rmse ? Math.round(m.rmse) : '—'}
                        </span>
                      {/each}
                    </div>
                  {:else if h7Status === 'PENDING'}
                    <span class="italic text-zinc-400">measuring…</span>
                  {:else}
                    <span class="text-zinc-300">—</span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <!-- Context sections -->
      <div class="mt-4 space-y-3 border-t border-zinc-200 pt-3 text-[11px]">

        <!-- Gate logic -->
        <div>
          <p class="font-semibold text-zinc-700">{t(page.data.locale, 'model_avail_ctx_gate_title')}</p>
          <p class="mt-0.5 text-zinc-500">{t(page.data.locale, 'model_avail_ctx_gate_body')}</p>
        </div>

        <!-- Fold methodology -->
        <div>
          <p class="font-semibold text-zinc-700">{t(page.data.locale, 'model_avail_ctx_folds_title')}</p>
          <p class="mt-0.5 text-zinc-500">{t(page.data.locale, 'model_avail_ctx_folds_body')}</p>
        </div>

        <!-- Why naive wins — KPI-specific -->
        <div>
          <p class="font-semibold text-zinc-700">{t(page.data.locale, naiveTitleKey as MessageKey)}</p>
          <p class="mt-0.5 text-zinc-500">{t(page.data.locale, naiveBodyKey as MessageKey)}</p>
        </div>

        <!-- Future flip -->
        <div>
          <p class="font-semibold text-zinc-700">{t(page.data.locale, 'model_avail_ctx_future_title')}</p>
          <p class="mt-0.5 text-zinc-500">{t(page.data.locale, 'model_avail_ctx_future_body')}</p>
        </div>

      </div>

      <!-- Technical footnote -->
      <p class="mt-3 text-[11px] text-zinc-400 space-y-0.5">
        <span class="block">{t(page.data.locale, 'model_avail_backtest_memo_day')}</span>
        <span class="block">{t(page.data.locale, 'model_avail_backtest_memo_week_month')}</span>
        {#if backtestLastMeasured}
          <span class="block tabular-nums">Last evaluated: {fmtDate(backtestLastMeasured)}</span>
        {/if}
      </p>
    </div>
  {/if}
</div>
