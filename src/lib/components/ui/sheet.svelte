<script lang="ts">
  // Bottom slide-up sheet primitive with backdrop, scroll lock, Escape close.
  // Respects prefers-reduced-motion via motion-safe:/motion-reduce: variants.
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils';

  interface Props {
    open?: boolean;
    title?: string;
    class?: string;
    children: Snippet;
  }

  let { open = $bindable(false), title, class: className, children }: Props = $props();

  // Scroll lock while open (prevents body scroll bleed-through on mobile).
  $effect(() => {
    if (typeof document === 'undefined') return;
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  });

  // Escape key closes the sheet.
  $effect(() => {
    if (!open) return;
    if (typeof document === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') open = false;
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });
</script>

{#if open}
  <button
    type="button"
    aria-label="Close sheet"
    class="fixed inset-0 z-40 bg-black/40 cursor-default"
    onclick={() => (open = false)}
  ></button>
  <div
    role="dialog"
    aria-modal="true"
    aria-labelledby={title ? 'sheet-title' : undefined}
    data-slot="sheet-content"
    class={cn(
      'fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-xl border-t bg-background p-6',
      'motion-safe:transition-transform motion-safe:duration-200 translate-y-0',
      'motion-reduce:transition-opacity',
      className
    )}
  >
    <div class="mx-auto mb-4 h-1.5 w-12 rounded-full bg-muted" aria-hidden="true"></div>
    {#if title}
      <h2 id="sheet-title" class="mb-4 text-lg font-semibold">{title}</h2>
    {/if}
    {@render children()}
  </div>
{/if}
