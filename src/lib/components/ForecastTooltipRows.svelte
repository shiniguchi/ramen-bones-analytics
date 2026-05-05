<script lang="ts">
  // Forecast section of the calendar bar chart's hover tooltip. Renders one
  // <li> per visible model showing label + mean (low–high). Each <li> spans
  // the full grid (1 / -1) so model rows don't pair into 2 columns inside
  // <Tooltip.List>'s `grid-template-columns: 1fr auto`.
  //
  // Used inside a <Tooltip.List>; expects bucketIso (ISO yyyy-MM-dd of the
  // hovered bar) and a value formatter so Counts and Revenue cards can each
  // pass their own (e.g., `n => '${n} 件'` vs `n => formatEUR(n*100)`).
  import { page } from '$app/state';
  import { t, type MessageKey } from '$lib/i18n/messages';
  import { FORECAST_MODEL_COLORS } from '$lib/chartPalettes';
  import type { ForecastRow } from '$lib/forecastOverlay.svelte';

  type Props = {
    bucketIso: string | null;
    seriesByModel: ReadonlyMap<string, readonly ForecastRow[]>;
    /** Format a single yhat number (mean / lower / upper) for display. */
    formatValue: (n: number) => string;
  };
  let { bucketIso, seriesByModel, formatValue }: Props = $props();

  // Pre-compute the visible model rows for the hovered bucket — one find per
  // model, drop nulls. Empty array = nothing to render (parent handles the
  // separator <li> based on this length via the snippet contract).
  const modelRows = $derived(
    bucketIso === null
      ? []
      : Array.from(seriesByModel.entries())
          .map(([name, rows]) => {
            const r = rows.find((x) => x.target_date === bucketIso);
            return r ? { name, row: r } : null;
          })
          .filter((x): x is { name: string; row: ForecastRow } => x !== null)
  );
</script>

{#each modelRows as { name, row: fr } (`mr-${name}`)}
  <li
    style:grid-column="1 / -1"
    class="flex items-center justify-between gap-3 py-0.5 text-xs"
  >
    <span class="flex items-center gap-1.5 min-w-0">
      <span
        class="inline-block h-2 w-2 flex-shrink-0 rounded-full"
        style:background-color={FORECAST_MODEL_COLORS[name]}
      ></span>
      <span class="truncate">{t(page.data.locale, `forecast_model_${name}` as MessageKey)}</span>
    </span>
    <span class="flex-shrink-0 whitespace-nowrap tabular-nums">
      {formatValue(fr.yhat_mean)}
      <span class="text-zinc-400 ml-1">({formatValue(fr.yhat_lower)}–{formatValue(fr.yhat_upper)})</span>
    </span>
  </li>
{/each}
