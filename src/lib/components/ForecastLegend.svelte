<script lang="ts">
  // ForecastLegend — horizontal-scroll chip row below the forecast chart.
  // Phase 15 D-04 / FUI-02.
  //
  // One chip per palette entry. Tap toggles the model's visibility via
  // ontoggle(modelName). Chips for models not present in the current
  // /api/forecast payload (e.g. Chronos/NeuralProphet when feature flags
  // are off per Phase 14 D-09) render disabled at 40% opacity.
  //
  // Why chip row not bottom-sheet (D-04 rationale): mobile bottom-sheet
  // adds modal-navigation state. Chip row is one tap away. Mirrors
  // HorizonToggle's segmented pattern.
  //
  // Default visible state ({sarimax, naive_dow}) is owned by the
  // parent card — this component is purely presentational + reactive
  // to its props.
  import { page } from '$app/state';
  import { t, type MessageKey } from '$lib/i18n/messages';
  import { FORECAST_MODEL_COLORS } from '$lib/chartPalettes';

  let {
    availableModels,
    visibleModels,
    ontoggle
  }: {
    availableModels: readonly string[];
    visibleModels: ReadonlySet<string>;
    ontoggle: (modelName: string) => void;
  } = $props();

  // Order chips per palette declaration order — keeps the eye stable
  // when the parent's availableModels list changes.
  const PALETTE_ORDER: Array<{ key: string; labelKey: MessageKey }> = [
    { key: 'sarimax',   labelKey: 'legend_model_sarimax' },
    { key: 'prophet',       labelKey: 'legend_model_prophet' },
    { key: 'ets',           labelKey: 'legend_model_ets' },
    { key: 'theta',         labelKey: 'legend_model_theta' },
    { key: 'naive_dow',     labelKey: 'legend_model_naive_dow' },
    { key: 'chronos',       labelKey: 'legend_model_chronos' },
    { key: 'neuralprophet', labelKey: 'legend_model_neuralprophet' }
  ];

  function isAvailable(modelKey: string): boolean {
    return availableModels.includes(modelKey);
  }

  function isPressed(modelKey: string): boolean {
    return visibleModels.has(modelKey);
  }

  function handleClick(modelKey: string) {
    if (!isAvailable(modelKey)) return;
    ontoggle(modelKey);
  }
</script>

<div
  data-testid="forecast-legend"
  role="group"
  aria-label={t(page.data.locale, 'legend_aria')}
  class="mt-2 flex items-center gap-2 overflow-x-auto overscroll-x-contain pb-1"
>
  {#each PALETTE_ORDER as { key, labelKey } (key)}
    {@const available = isAvailable(key)}
    {@const pressed = isPressed(key)}
    <button
      type="button"
      data-model={key}
      aria-pressed={pressed}
      aria-disabled={!available}
      disabled={!available}
      class="min-h-9 inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors
        {available
          ? (pressed
              ? 'border-zinc-300 bg-white text-zinc-900 shadow-sm'
              : 'border-zinc-200 bg-zinc-50 text-zinc-500 hover:bg-zinc-100')
          : 'border-zinc-200 bg-zinc-50 text-zinc-400 opacity-40 cursor-not-allowed'}"
      onclick={() => handleClick(key)}
    >
      <span
        data-testid="legend-dot"
        class="h-2.5 w-2.5 rounded-full"
        style="background-color: {FORECAST_MODEL_COLORS[key]};"
      ></span>
      {t(page.data.locale, labelKey)}
    </button>
  {/each}
</div>
