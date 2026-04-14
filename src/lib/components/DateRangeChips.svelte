<script lang="ts">
  // D-04/D-05/D-19a: sticky chip bar. State lives in URL ?range=; SSR reads it.
  // Uses $app/state (not deprecated $app/stores) per CLAUDE.md Svelte 5 note.
  import { goto } from '$app/navigation';
  import { page } from '$app/state';

  let { range }: { range: string } = $props();

  const chips = [
    { id: 'today', label: 'Today' },
    { id: '7d', label: '7d' },
    { id: '30d', label: '30d' },
    { id: '90d', label: '90d' },
    { id: 'all', label: 'All' }
  ] as const;

  function select(id: string) {
    const url = new URL(page.url);
    url.searchParams.set('range', id);
    goto(url, { replaceState: false, keepFocus: true, noScroll: true });
  }
</script>

<div role="group" aria-label="Date range" class="flex gap-2 overflow-x-auto">
  {#each chips as chip}
    <button
      type="button"
      aria-current={range === chip.id ? 'true' : undefined}
      onclick={() => select(chip.id)}
      class="min-h-11 min-w-11 px-3 rounded-full text-sm font-medium focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-50 {range ===
      chip.id
        ? 'bg-blue-600 text-white'
        : 'bg-white border border-zinc-200 text-zinc-900'}"
    >
      {chip.label}
    </button>
  {/each}
</div>
