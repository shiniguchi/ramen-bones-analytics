<script lang="ts">
  // Phase 6 — draft-state multi-select.
  // Owns a local draft; parent wires via bind:selected OR onSelectionChange.
  // Caller is responsible for hiding entirely when options.length === 0 (D-13).
  import Command from '$lib/components/ui/command.svelte';
  import Checkbox from '$lib/components/ui/checkbox.svelte';
  import { cn } from '$lib/utils';

  interface Props {
    label: string;
    options: string[];
    selected?: string[] | undefined;
    class?: string;
    onSelectionChange?: (next: string[] | undefined) => void;
  }

  let {
    label,
    options,
    selected = $bindable(undefined),
    class: className,
    onSelectionChange
  }: Props = $props();

  // Non-default when user has narrowed (undefined OR full set = "All").
  const active = $derived(
    selected !== undefined && selected.length > 0 && selected.length < options.length
  );

  const placeholder = $derived.by(() => {
    if (!selected || selected.length === 0 || selected.length === options.length) return 'All';
    return `${selected.length} selected`;
  });

  function toggle(opt: string, checked: boolean) {
    const current = selected ?? [...options];
    const next = checked
      ? [...new Set([...current, opt])]
      : current.filter((x) => x !== opt);
    // Collapse to 'undefined' sentinel when user reselects everything (= "All").
    const committed = next.length === options.length ? undefined : next;
    selected = committed;
    onSelectionChange?.(committed);
  }

  function isChecked(opt: string): boolean {
    if (!selected) return true; // undefined = all selected
    return selected.includes(opt);
  }
</script>

<div
  data-slot="multiselect"
  class={cn(
    'rounded-md border p-3 transition-colors',
    active ? 'border-primary/60 bg-primary/5' : 'border-input',
    className
  )}
>
  <div class="mb-2 text-xs font-medium">{label}</div>
  <div class="mb-2 text-xs text-muted-foreground">{placeholder}</div>
  <Command>
    {#each options as opt}
      <Checkbox
        label={opt}
        checked={isChecked(opt)}
        onCheckedChange={(v) => toggle(opt, v)}
      />
    {/each}
  </Command>
</div>
