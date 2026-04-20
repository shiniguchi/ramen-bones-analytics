<script lang="ts">
  // Phase 9 — 2-row sticky filter bar with inline toggles.
  // Row 1: DatePickerPopover. Row 2: Grain + Sales Type + Cash/Card toggles + Days popover.
  // No FilterSheet, no multi-selects, no "Filters" button.
  // quick-260420-wdf: Days popover (7 checkboxes + 3 presets) added to row 2.
  import GrainToggle from './GrainToggle.svelte';
  import SegmentedToggle from './SegmentedToggle.svelte';
  import DatePickerPopover from './DatePickerPopover.svelte';
  import Popover from './ui/popover.svelte';
  import Checkbox from './ui/checkbox.svelte';
  import type { FiltersState } from '$lib/filters';
  import type { RangeWindow, Grain } from '$lib/dateRange';

  interface Props {
    filters: FiltersState;
    window: RangeWindow;
    isLoading?: boolean;
    days?: number[];
    onrangechange: (range: string) => void;
    onsalestypechange: (v: string) => void;
    oncashfilterchange: (v: string) => void;
    onDaysChange?: (v: number[]) => void;
  }

  let {
    filters,
    window: rangeWindow,
    isLoading = false,
    days = [1, 2, 3, 4, 5, 6, 7],
    onrangechange,
    onsalestypechange,
    oncashfilterchange,
    onDaysChange = () => {}
  }: Props = $props();

  const salesTypeOptions = [
    { value: 'all', label: 'All' },
    { value: 'INHOUSE', label: 'Inhouse' },
    { value: 'TAKEAWAY', label: 'Takeaway' }
  ];

  const cashOptions = [
    { value: 'all', label: 'All' },
    { value: 'cash', label: 'Cash' },
    { value: 'card', label: 'Card' }
  ];

  // Mon=1..Sun=7 ordered labels for the popover rows.
  const DAY_ROWS: { value: number; label: string; short: string }[] = [
    { value: 1, label: 'Mon', short: 'Mon' },
    { value: 2, label: 'Tue', short: 'Tue' },
    { value: 3, label: 'Wed', short: 'Wed' },
    { value: 4, label: 'Thu', short: 'Thu' },
    { value: 5, label: 'Fri', short: 'Fri' },
    { value: 6, label: 'Sat', short: 'Sat' },
    { value: 7, label: 'Sun', short: 'Sun' }
  ];

  // Derive a compact trigger label from the current days array.
  // "All days" / "Mon–Fri" / "Sat–Sun" / "Wed only" / "<n> days"
  const daysLabel = $derived.by(() => {
    if (days.length === 7) return 'All days';
    const csv = [...days].sort((a, b) => a - b).join(',');
    if (csv === '1,2,3,4,5') return 'Mon–Fri';
    if (csv === '6,7') return 'Sat–Sun';
    if (days.length === 1) {
      const row = DAY_ROWS.find((r) => r.value === days[0]);
      return `${row?.short ?? '?'} only`;
    }
    return `${days.length} days`;
  });

  let daysOpen = $state(false);

  function toggleDay(d: number, checked: boolean) {
    const set = new Set(days);
    if (checked) set.add(d);
    else set.delete(d);
    const next = [...set].sort((a, b) => a - b);
    onDaysChange(next);
  }

  function applyPreset(v: number[]) {
    onDaysChange(v);
  }
</script>

<div class="sticky top-0 z-30 border-b bg-background/95 px-4 py-2 backdrop-blur"
     data-slot="filter-bar">
  <!-- Row 1: Date picker + filter-change spinner -->
  <div class="mb-2 flex items-center gap-2">
    <DatePickerPopover {filters} window={rangeWindow} {onrangechange} />
    {#if isLoading}
      <svg class="h-4 w-4 shrink-0 animate-spin text-zinc-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" data-testid="filter-loading-spinner">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
      </svg>
    {/if}
  </div>
  <!-- Row 2: Grain + Sales Type + Cash/Card + Days, horizontal scroll -->
  <div class="flex items-center gap-2 overflow-x-auto"
       style="scrollbar-width: none; -webkit-overflow-scrolling: touch;">
    <GrainToggle grain={filters.grain as Grain} />
    <!-- Separator -->
    <div class="h-6 w-px shrink-0 bg-zinc-200" aria-hidden="true"></div>
    <SegmentedToggle
      options={salesTypeOptions}
      selected={filters.sales_type ?? 'all'}
      onchange={onsalestypechange}
      label="Sales type"
    />
    <!-- Separator -->
    <div class="h-6 w-px shrink-0 bg-zinc-200" aria-hidden="true"></div>
    <SegmentedToggle
      options={cashOptions}
      selected={filters.is_cash ?? 'all'}
      onchange={oncashfilterchange}
      label="Payment type"
    />
    <!-- Separator -->
    <div class="h-6 w-px shrink-0 bg-zinc-200" aria-hidden="true"></div>
    <!-- Days popover — 7 checkboxes + 3 presets -->
    <Popover bind:open={daysOpen} class="max-w-[240px]">
      {#snippet trigger()}
        <button
          type="button"
          aria-label="Days of week"
          aria-haspopup="dialog"
          aria-expanded={daysOpen}
          data-testid="days-popover-trigger"
          onclick={() => (daysOpen = !daysOpen)}
          class="min-h-11 shrink-0 whitespace-nowrap rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
        >
          {daysLabel}
        </button>
      {/snippet}
      {#snippet children()}
        <div data-testid="days-popover-content" class="flex flex-col gap-1">
          <p class="mb-1 text-xs font-medium text-zinc-500">Filter by day of week</p>
          {#each DAY_ROWS as row (row.value)}
            <Checkbox
              checked={days.includes(row.value)}
              label={row.label}
              onCheckedChange={(v) => toggleDay(row.value, v)}
            />
          {/each}
          <div class="my-2 h-px bg-zinc-200"></div>
          <div class="flex flex-wrap gap-1.5">
            <button
              type="button"
              data-testid="days-preset-all"
              class="min-h-9 rounded-md bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-200"
              onclick={() => applyPreset([1, 2, 3, 4, 5, 6, 7])}
            >All</button>
            <button
              type="button"
              data-testid="days-preset-weekdays"
              class="min-h-9 rounded-md bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-200"
              onclick={() => applyPreset([1, 2, 3, 4, 5])}
            >Weekdays</button>
            <button
              type="button"
              data-testid="days-preset-weekends"
              class="min-h-9 rounded-md bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-200"
              onclick={() => applyPreset([6, 7])}
            >Weekends</button>
          </div>
        </div>
      {/snippet}
    </Popover>
  </div>
</div>
