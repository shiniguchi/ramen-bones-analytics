<script lang="ts">
  // VA-07: LTV per-customer histogram. 6 bins per D-12.
  // Data shape: customer_ltv_v rows (one per card_hash).
  // Binning via UI constants in $lib/ltvBins.ts (not SQL — D-13).
  // NO range/filter prop — LTV is lifetime; filter-scoping would be semantically wrong.
  import { BarChart } from 'layerchart';
  import EmptyState from './EmptyState.svelte';
  import { LTV_BINS, binCustomerRevenue } from '$lib/ltvBins';

  type CustomerLtvRow = {
    card_hash: string;
    revenue_cents: number;
    visit_count: number;
    cohort_week: string;
    cohort_month: string;
  };

  let { data }: { data: CustomerLtvRow[] } = $props();

  // Seed counts for every bin so empty bins render at height=0 (preserves x-axis label order).
  const chartData = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const bin of LTV_BINS) counts.set(bin.label, 0);
    for (const row of data) {
      const bin = binCustomerRevenue(row.revenue_cents);
      counts.set(bin, (counts.get(bin) ?? 0) + 1);
    }
    return LTV_BINS.map(b => ({ bin: b.label, customers: counts.get(b.label) ?? 0 }));
  });
</script>

<div data-testid="ltv-histogram-card" class="rounded-xl border border-zinc-200 bg-white p-4">
  <h2 class="text-base font-semibold text-zinc-900">LTV distribution</h2>
  <p class="mt-1 text-xs text-zinc-500">Customers per lifetime revenue bucket.</p>
  {#if data.length === 0}
    <EmptyState card="ltv-histogram" />
  {:else}
    <div class="mt-4 h-64">
      <BarChart
        data={chartData}
        x="bin"
        y="customers"
        orientation="vertical"
        bandPadding={0.2}
      />
    </div>
  {/if}
</div>
