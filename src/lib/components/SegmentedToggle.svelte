<script lang="ts">
  // SegmentedToggle — generic 3-state radio group.
  // Replicates GrainToggle's visual pattern as a reusable component.
  // D-04: segmented toggle for sales_type and is_cash filters.
  // Accessibility: role="group" + role="radio" + aria-checked per UI-SPEC.
  type Option = { value: string; label: string };
  let { options, selected, onchange, label }:
    { options: Option[]; selected: string; onchange: (v: string) => void; label: string } = $props();
</script>

<!-- min-h-11 (44px) per touch target spec; gap-1 (4px) per UI-SPEC spacing xs -->
<div role="group" aria-label={label}
     class="inline-flex items-center rounded-lg border border-zinc-200 bg-zinc-50 p-0.5 gap-1">
  {#each options as opt}
    <button type="button" role="radio" aria-checked={selected === opt.value}
      data-state={selected === opt.value ? 'on' : 'off'}
      class="min-h-11 min-w-0 flex-1 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors
        {selected === opt.value ? 'bg-blue-50 text-blue-600 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}"
      onclick={() => onchange(opt.value)}>
      {opt.label}
    </button>
  {/each}
</div>
