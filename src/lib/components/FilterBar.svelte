<script lang="ts">
  // Phase 9 — 2-row sticky filter bar with inline toggles.
  // Row 1: DatePickerPopover. Row 2: Grain + Sales Type + Cash/Card toggles.
  // No FilterSheet, no multi-selects, no "Filters" button.
  import GrainToggle from './GrainToggle.svelte';
  import SegmentedToggle from './SegmentedToggle.svelte';
  import DatePickerPopover from './DatePickerPopover.svelte';
  import type { FiltersState } from '$lib/filters';
  import type { RangeWindow, Grain } from '$lib/dateRange';

  interface Props {
    filters: FiltersState;
    window: RangeWindow;
    onrangechange: (range: string) => void;
    onsalestypechange: (v: string) => void;
    oncashfilterchange: (v: string) => void;
  }

  let { filters, window: rangeWindow, onrangechange, onsalestypechange, oncashfilterchange }: Props = $props();

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
</script>

<div class="sticky top-0 z-30 border-b bg-background/95 px-4 py-2 backdrop-blur"
     data-slot="filter-bar">
  <!-- Row 1: Date picker -->
  <div class="mb-2">
    <DatePickerPopover {filters} window={rangeWindow} {onrangechange} />
  </div>
  <!-- Row 2: Grain + Sales Type + Cash/Card, horizontal scroll -->
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
  </div>
</div>
