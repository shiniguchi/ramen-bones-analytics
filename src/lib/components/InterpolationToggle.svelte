<script lang="ts">
  // InterpolationToggle — Linear / Log-linear switch for the north-star curve
  // interpolation between benchmark anchors. Mirrors GrainToggle's visual
  // language: segmented radio group, replaceState URL sync, store action.
  // quick-260418-bm3
  import { replaceState } from '$app/navigation';
  import { setInterp } from '$lib/dashboardStore.svelte';
  import { mergeSearchParams } from '$lib/urlState';

  type Interp = 'linear' | 'log-linear';

  let { interp }: { interp: Interp } = $props();

  const options: { value: Interp; label: string }[] = [
    { value: 'linear',     label: 'Lin' },
    { value: 'log-linear', label: 'Log' }
  ];

  function select(value: Interp) {
    replaceState(mergeSearchParams({ interp: value }), {});
    setInterp(value);
  }
</script>

<!-- Compact — fits in the card header next to the title. Smaller min-h than -->
<!-- GrainToggle because it's secondary UI; still tappable (36px). -->
<div role="group" aria-label="Benchmark interpolation mode"
     class="inline-flex items-center rounded-md border border-zinc-200 bg-zinc-50 p-0.5 gap-0.5">
  {#each options as opt}
    <button
      type="button"
      role="radio"
      aria-checked={interp === opt.value}
      data-state={interp === opt.value ? 'on' : 'off'}
      class="min-h-9 rounded px-2 py-1 text-xs font-medium transition-colors
        {interp === opt.value
          ? 'bg-amber-100 text-amber-700'
          : 'text-zinc-500 hover:text-zinc-700'}"
      onclick={() => select(opt.value)}
    >
      {opt.label}
    </button>
  {/each}
</div>
