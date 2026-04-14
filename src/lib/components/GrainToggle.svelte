<script lang="ts">
  // GrainToggle — segmented Day/Week/Month control that syncs ?grain= URL param.
  // Lives inside the CohortRetentionCard header; also shared with LtvCard (D-16).
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { Grain } from '$lib/dateRange';

  let { grain }: { grain: Grain } = $props();

  const options: { value: Grain; label: string }[] = [
    { value: 'day',   label: 'Day' },
    { value: 'week',  label: 'Week' },
    { value: 'month', label: 'Month' }
  ];

  function select(value: Grain) {
    const params = new URLSearchParams(page.url.search);
    params.set('grain', value);
    goto(`?${params.toString()}`, { keepFocus: true, noScroll: true });
  }
</script>

<!-- Segmented toggle — min-h-11 per touch-target spec (D-15) -->
<div role="group" aria-label="Grain selector" class="inline-flex items-center rounded-lg border border-zinc-200 bg-zinc-50 p-0.5 gap-0.5">
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
      {opt.label}
    </button>
  {/each}
</div>
