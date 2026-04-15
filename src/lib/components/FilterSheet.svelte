<script lang="ts">
  // Phase 6 — bottom slide-up filter sheet with draft-and-apply multi-selects.
  // Sales type + payment method stage locally; "Apply filters" commits.
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import Sheet from '$lib/components/ui/sheet.svelte';
  import Button from '$lib/components/ui/button.svelte';
  import MultiSelectDropdown from './MultiSelectDropdown.svelte';
  import CountryMultiSelect from './CountryMultiSelect.svelte';
  import type { FiltersState } from '$lib/filters';

  interface Props {
    filters: FiltersState;
    distinctSalesTypes: string[];
    distinctPaymentMethods: string[];
    distinctCountries: string[];
    open?: boolean;
  }

  let {
    filters,
    distinctSalesTypes,
    distinctPaymentMethods,
    distinctCountries,
    open = $bindable(false)
  }: Props = $props();

  let salesTypeDraft = $state<string[] | undefined>(undefined);
  let paymentMethodDraft = $state<string[] | undefined>(undefined);
  let countryDraft = $state<string[] | undefined>(undefined);

  // Reset drafts whenever the sheet transitions to open.
  $effect(() => {
    if (open) {
      salesTypeDraft = filters.sales_type;
      paymentMethodDraft = filters.payment_method;
      countryDraft = filters.country;
    }
  });

  function buildUrl(patch: Record<string, string | null>): string {
    const u = new URL(page.url);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) u.searchParams.delete(k);
      else u.searchParams.set(k, v);
    }
    return u.pathname + (u.search ? u.search : '');
  }

  // Serialize draft: undefined OR full-set collapses to omit param (D-12).
  function serialize(draft: string[] | undefined, allOptions: string[]): string | null {
    if (!draft || draft.length === 0) return null;
    if (draft.length === allOptions.length) return null;
    return draft.join(',');
  }

  // Country serialization: meta-sentinels make a "full set" collapse
  // rule meaningless, so we emit CSV whenever there's any selection
  // and omit the param otherwise.
  function serializeCountry(draft: string[] | undefined): string | null {
    if (!draft || draft.length === 0) return null;
    return draft.join(',');
  }

  function applyFilters() {
    const patch: Record<string, string | null> = {
      sales_type: serialize(salesTypeDraft, distinctSalesTypes),
      payment_method: serialize(paymentMethodDraft, distinctPaymentMethods),
      country: serializeCountry(countryDraft)
    };
    const href = buildUrl(patch);
    open = false;
    goto(href, { invalidateAll: true, keepFocus: true, noScroll: true });
  }

  function discard() {
    open = false;
  }

  function resetAll() {
    salesTypeDraft = undefined;
    paymentMethodDraft = undefined;
    countryDraft = undefined;
    // Default URL: range=7d, grain=week, strip all filter params + from/to.
    const u = new URL(page.url);
    u.searchParams.set('range', '7d');
    u.searchParams.set('grain', 'week');
    u.searchParams.delete('sales_type');
    u.searchParams.delete('payment_method');
    u.searchParams.delete('country');
    u.searchParams.delete('from');
    u.searchParams.delete('to');
    open = false;
    goto(u.pathname + u.search, { invalidateAll: true, keepFocus: true, noScroll: true });
  }
</script>

<Sheet bind:open title="Filters">
  <div class="flex flex-col gap-4 pb-4">
    {#if distinctSalesTypes.length > 0}
      <MultiSelectDropdown
        label="Sales type"
        options={distinctSalesTypes}
        bind:selected={salesTypeDraft}
      />
    {/if}

    {#if distinctPaymentMethods.length > 0}
      <MultiSelectDropdown
        label="Payment method"
        options={distinctPaymentMethods}
        bind:selected={paymentMethodDraft}
      />
    {/if}

    {#if distinctCountries.length > 0}
      <CountryMultiSelect
        options={distinctCountries}
        bind:selected={countryDraft}
      />
    {/if}
  </div>

  <div class="sticky bottom-0 -mx-6 -mb-6 flex flex-col gap-2 border-t bg-background px-6 py-4">
    <Button class="min-h-11 w-full" onclick={applyFilters}>Apply filters</Button>
    <Button variant="outline" class="min-h-11 w-full" onclick={discard}>Discard changes</Button>
    <Button variant="ghost" class="min-h-11 w-full" onclick={resetAll}>Reset all filters</Button>
  </div>
</Sheet>
