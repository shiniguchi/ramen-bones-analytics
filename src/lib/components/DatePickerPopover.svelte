<script lang="ts">
  // Phase 9 — two-line date picker button + anchored popover.
  // Presets are instant-apply (sticky-bar UX contract); custom range is
  // draft-and-apply via the "Apply range" button.
  // D-06: replaceState instead of goto — no SSR round-trip.
  import { replaceState } from '$app/navigation';
  import { mergeSearchParams } from '$lib/urlState';
  import { format, parseISO } from 'date-fns';
  import Popover from '$lib/components/ui/popover.svelte';
  import Button from '$lib/components/ui/button.svelte';
  import Input from '$lib/components/ui/input.svelte';
  import { cn } from '$lib/utils';
  import type { FiltersState } from '$lib/filters';
  import type { RangeWindow } from '$lib/dateRange';

  interface Props {
    filters: FiltersState;
    window: RangeWindow;
    onrangechange: (range: string) => void;
  }

  let { filters, window: rangeWindow, onrangechange }: Props = $props();

  let open = $state(false);
  let fromDraft = $state('');
  let toDraft = $state('');

  // Reset local drafts when popover opens.
  $effect(() => {
    if (open) {
      fromDraft = filters.from ?? rangeWindow.from;
      toDraft = filters.to ?? rangeWindow.to;
    }
  });

  // Preset labels in order.
  const PRESETS: { id: 'today' | '7d' | '30d' | '90d' | 'all'; label: string }[] = [
    { id: 'today', label: 'Today' },
    { id: '7d', label: '7d' },
    { id: '30d', label: '30d' },
    { id: '90d', label: '90d' },
    { id: 'all', label: 'All' }
  ];

  const presetLabel = $derived.by(() => {
    if (filters.range === 'custom') return 'Custom';
    const p = PRESETS.find((x) => x.id === filters.range);
    return p?.label ?? '7d';
  });

  const dateLine = $derived.by(() => {
    if (!rangeWindow?.from || !rangeWindow?.to) return '';
    try {
      const a = parseISO(rangeWindow.from);
      const b = parseISO(rangeWindow.to);
      const sameYear = a.getFullYear() === b.getFullYear();
      const f = sameYear ? 'MMM d' : 'MMM d yyyy';
      return `${format(a, f)} – ${format(b, f)}`;
    } catch {
      return `${rangeWindow.from} – ${rangeWindow.to}`;
    }
  });

  // Non-default active state: any range that isn't the default '7d'.
  const active = $derived(filters.range !== '7d');

  // replaceState is synchronous — window.location.href reflects new params
  // before onrangechange fires, so +page.svelte's handleRangeChange can read
  // them back off the live URL.
  function applyPreset(id: 'today' | '7d' | '30d' | '90d' | 'all') {
    replaceState(
      mergeSearchParams({ range: id, from: null, to: null }),
      {}
    );
    open = false;
    onrangechange(id);
  }

  function applyCustom() {
    if (!fromDraft || !toDraft) return;
    replaceState(
      mergeSearchParams({ range: 'custom', from: fromDraft, to: toDraft }),
      {}
    );
    open = false;
    onrangechange('custom');
  }
</script>

<Popover bind:open>
  {#snippet trigger()}
    <Button
      variant="outline"
      class={cn(
        'min-h-11 gap-1.5 px-3',
        active && 'border-primary/60 bg-primary/5'
      )}
      onclick={() => (open = !open)}
      aria-haspopup="dialog"
      aria-expanded={open}
    >
      <span class="text-sm font-medium">{presetLabel}</span>
      <span class="text-xs font-medium text-muted-foreground">{dateLine}</span>
    </Button>
  {/snippet}

  <h3 class="mb-3 text-base font-medium">Select date range</h3>

  <div class="mb-2 text-xs font-medium text-muted-foreground">Quick select</div>
  <div class="mb-4 flex flex-wrap gap-2">
    {#each PRESETS as p}
      <button
        type="button"
        class={cn(
          'min-h-11 rounded-md border px-3 text-sm font-medium transition-colors',
          filters.range === p.id
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-input bg-background hover:bg-accent hover:text-accent-foreground'
        )}
        onclick={() => applyPreset(p.id)}
      >
        {p.label}
      </button>
    {/each}
  </div>

  <div class="mb-2 text-xs font-medium text-muted-foreground">Custom range</div>
  <div class="mb-4 flex flex-col gap-2">
    <label class="flex flex-col gap-1 text-xs font-medium">
      <span>From</span>
      <Input type="date" bind:value={fromDraft} class="min-h-11" />
    </label>
    <label class="flex flex-col gap-1 text-xs font-medium">
      <span>To</span>
      <Input type="date" bind:value={toDraft} class="min-h-11" />
    </label>
  </div>

  <Button class="min-h-11 w-full" onclick={applyCustom}>Apply range</Button>
</Popover>
