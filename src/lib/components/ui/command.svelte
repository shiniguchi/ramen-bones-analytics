<script lang="ts">
  // Minimal semantic listbox container for multi-select option rows.
  // No fuzzy search, no keyboard nav in v1 — just role=listbox + children slot.
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils';

  interface Props {
    class?: string;
    children: Snippet;
  }

  let { class: className, children }: Props = $props();
</script>

<div
  role="listbox"
  aria-multiselectable="true"
  data-slot="command-list"
  class={cn('flex flex-col', className)}
>
  {@render children()}
</div>
