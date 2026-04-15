<script lang="ts">
  // Phase 6 — sticky top filter bar (≤72px budget).
  // Hosts DatePickerPopover (instant), GrainToggle (instant), and the
  // "Filters" button that opens a draft-and-apply FilterSheet.
  import Button from '$lib/components/ui/button.svelte';
  import GrainToggle from './GrainToggle.svelte';
  import DatePickerPopover from './DatePickerPopover.svelte';
  import FilterSheet from './FilterSheet.svelte';
  import { cn } from '$lib/utils';
  import type { FiltersState } from '$lib/filters';
  import type { RangeWindow, Grain } from '$lib/dateRange';

  interface Props {
    filters: FiltersState;
    window: RangeWindow;
    distinctSalesTypes: string[];
    distinctPaymentMethods: string[];
    distinctCountries: string[];
  }

  let {
    filters,
    window: rangeWindow,
    distinctSalesTypes,
    distinctPaymentMethods,
    distinctCountries
  }: Props = $props();

  let sheetOpen = $state(false);

  const showFiltersButton = $derived(
    distinctSalesTypes.length > 0 ||
      distinctPaymentMethods.length > 0 ||
      distinctCountries.length > 0
  );
  const filtersActive = $derived(
    filters.sales_type !== undefined ||
      filters.payment_method !== undefined ||
      filters.country !== undefined
  );
</script>

<div
  class="sticky top-0 z-30 min-h-[72px] border-b bg-background/95 px-4 py-2 backdrop-blur"
  data-slot="filter-bar"
>
  <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
    <div class="flex items-center gap-2">
      <DatePickerPopover {filters} window={rangeWindow} />
      {#if showFiltersButton}
        <Button
          variant="outline"
          class={cn(
            'min-h-11',
            filtersActive && 'border-primary/60 bg-primary/5'
          )}
          onclick={() => (sheetOpen = true)}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
        >
          Filters
        </Button>
      {/if}
    </div>
    <GrainToggle grain={filters.grain as Grain} />
  </div>
</div>

{#if showFiltersButton}
  <FilterSheet
    bind:open={sheetOpen}
    {filters}
    {distinctSalesTypes}
    {distinctPaymentMethods}
    {distinctCountries}
  />
{/if}
