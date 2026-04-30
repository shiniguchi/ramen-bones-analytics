<script lang="ts">
  // HorizonToggle — 4-chip forecast horizon selector.
  // Phase 15 FUI-03 / D-11.
  // Mirrors GrainToggle.svelte's segmented-control pattern: same min-h-11,
  // same role="group" + role="radio" + aria-checked semantics, same
  // active-chip color treatment (blue-50 bg + blue-600 text). Owner has
  // already learned this control on the grain selector — reuse the pattern.
  //
  // Click behavior: emits BOTH onhorizonchange(horizon) AND
  // ongranularitychange(DEFAULT_GRANULARITY[horizon]) per D-11 clamp.
  // The parent card is free to override granularity afterward (e.g. 5w
  // can flip day↔week), but the default emit ensures the page never
  // sits on an illegal (horizon, granularity) combo even for one frame.
  //
  // No URL persistence in v1 — Phase 6 FLT-07 owns ?horizon= if/when
  // URL state becomes a requirement (deferred per CONTEXT specifics).
  import { page } from '$app/state';
  import { t, type MessageKey } from '$lib/i18n/messages';
  import {
    HORIZON_DAYS,
    DEFAULT_GRANULARITY,
    type Horizon,
    type Granularity
  } from '$lib/forecastValidation';

  let {
    horizon,
    onhorizonchange,
    ongranularitychange
  }: {
    horizon: Horizon;
    onhorizonchange: (h: Horizon) => void;
    ongranularitychange: (g: Granularity) => void;
  } = $props();

  const options: { value: Horizon; key: MessageKey }[] = [
    { value: 7,   key: 'horizon_7d' },
    { value: 35,  key: 'horizon_5w' },
    { value: 120, key: 'horizon_4mo' },
    { value: 365, key: 'horizon_1yr' }
  ];

  function select(value: Horizon) {
    onhorizonchange(value);
    ongranularitychange(DEFAULT_GRANULARITY[value]);
  }
</script>

<!-- Segmented toggle — same shell as GrainToggle for visual continuity -->
<div
  role="group"
  aria-label={t(page.data.locale, 'horizon_selector_aria')}
  class="inline-flex items-center rounded-lg border border-zinc-200 bg-zinc-50 p-0.5 gap-0.5"
>
  {#each options as opt (opt.value)}
    <button
      type="button"
      role="radio"
      aria-checked={horizon === opt.value}
      data-state={horizon === opt.value ? 'on' : 'off'}
      class="min-h-11 min-w-0 flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors
        {horizon === opt.value
          ? 'bg-blue-50 text-blue-600 shadow-sm'
          : 'text-zinc-500 hover:text-zinc-700'}"
      onclick={() => select(opt.value)}
    >
      {t(page.data.locale, opt.key)}
    </button>
  {/each}
</div>
