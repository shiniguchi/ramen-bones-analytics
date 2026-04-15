<script lang="ts">
  // Headless popover primitive: renders trigger inline, portals content to #popover-root
  // by physically moving the rendered DOM node after mount. Closes on Escape + backdrop click.
  // Uses position: fixed (not absolute) to escape sticky stacking contexts per UI-SPEC gotcha #8.
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils';

  interface Props {
    open?: boolean;
    class?: string;
    trigger: Snippet;
    children: Snippet;
  }

  let { open = $bindable(false), class: className, trigger, children }: Props = $props();

  let contentEl: HTMLDivElement | null = $state(null);

  // Portal: physically relocate the rendered content into #popover-root while open.
  $effect(() => {
    if (!open || !contentEl) return;
    if (typeof document === 'undefined') return;
    const root = document.getElementById('popover-root');
    if (!root) return;
    const originalParent = contentEl.parentNode;
    root.appendChild(contentEl);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') open = false;
    };
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('keydown', onKey);
      // Best-effort restore so Svelte can clean up its anchor.
      if (contentEl && originalParent && contentEl.parentNode === root) {
        try {
          originalParent.appendChild(contentEl);
        } catch {
          /* ignore */
        }
      }
    };
  });
</script>

{@render trigger()}

{#if open}
  <div bind:this={contentEl}>
    <button
      type="button"
      aria-label="Close popover"
      class="fixed inset-0 z-40 bg-transparent cursor-default"
      onclick={() => (open = false)}
    ></button>
    <div
      role="dialog"
      tabindex="-1"
      data-slot="popover-content"
      class={cn(
        'fixed inset-x-4 top-20 z-50 mx-auto max-w-[343px] rounded-lg border bg-popover text-popover-foreground shadow-lg p-4',
        className
      )}
    >
      {@render children()}
    </div>
  </div>
{/if}
