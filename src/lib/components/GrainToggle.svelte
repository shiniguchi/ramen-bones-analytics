<script lang="ts">
  // GrainToggle — segmented Day/Week/Month control.
  // Phase 9: uses replaceState (no SSR round-trip) + updates dashboard store.
  // Phase 9 Plan 5: mergeSearchParams() preserves other filter params on click.
  import { replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { setGrain } from '$lib/dashboardStore.svelte';
  import { mergeSearchParams } from '$lib/urlState';
  import { t, type MessageKey } from '$lib/i18n/messages';
  import type { Grain } from '$lib/dateRange';

  let { grain }: { grain: Grain } = $props();

  const options: { value: Grain; key: MessageKey }[] = [
    { value: 'day',   key: 'grain_day' },
    { value: 'week',  key: 'grain_week' },
    { value: 'month', key: 'grain_month' }
  ];

  function select(value: Grain) {
    replaceState(mergeSearchParams({ grain: value }), {});
    setGrain(value);
  }
</script>

<!-- Segmented toggle — min-h-11 per touch-target spec (D-15) -->
<div role="group" aria-label={t(page.data.locale, 'grain_selector_aria')} class="inline-flex items-center rounded-lg border border-zinc-200 bg-zinc-50 p-0.5 gap-0.5">
  {#each options as opt}
    <button
      type="button"
      role="radio"
      aria-checked={grain === opt.value}
      data-state={grain === opt.value ? 'on' : 'off'}
      class="min-h-11 min-w-0 flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors
        {grain === opt.value
          ? 'bg-blue-50 text-blue-600 shadow-sm'
          : 'text-zinc-500 hover:text-zinc-700'}"
      onclick={() => select(opt.value)}
    >
      {t(page.data.locale, opt.key)}
    </button>
  {/each}
</div>
