<script lang="ts">
  // Phase 9: simplified dashboard with 2 KPI tiles + cohort retention.
  // All KPI computation happens client-side via dashboardStore (D-05, D-08).
  import DashboardHeader from '$lib/components/DashboardHeader.svelte';
  import FilterBar from '$lib/components/FilterBar.svelte';
  import FreshnessLabel from '$lib/components/FreshnessLabel.svelte';
  import KpiTile from '$lib/components/KpiTile.svelte';
  import CohortRetentionCard from '$lib/components/CohortRetentionCard.svelte';
  import InsightCard from '$lib/components/InsightCard.svelte';
  import {
    initStore, getKpiTotals, setRange, setSalesType, setCashFilter,
    cacheCovers, type DailyRow
  } from '$lib/dashboardStore.svelte';
  import { replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { chipToRange, customToRange, type Range } from '$lib/dateRange';

  let { data } = $props();

  // Initialize store from SSR data on mount and when SSR data changes.
  $effect(() => {
    initStore({
      dailyRows: [...data.dailyRows, ...data.priorDailyRows],
      window: data.window,
      grain: data.grain as 'day' | 'week' | 'month',
      salesType: (data.filters.sales_type ?? 'all') as 'all' | 'INHOUSE' | 'TAKEAWAY',
      cashFilter: (data.filters.is_cash ?? 'all') as 'all' | 'cash' | 'card'
    });
  });

  // Reactive KPI totals from store (getter function, not direct export).
  const kpi = $derived(getKpiTotals());

  // Range label for tile titles
  const rangeLabel = $derived.by(() => {
    const r = data.filters.range;
    if (r === 'custom' && data.filters.from && data.filters.to) {
      return `${data.filters.from} \u2013 ${data.filters.to}`;
    }
    if (r === 'today') return 'Today';
    return r;
  });

  // Prior period label for delta display
  const priorLabel = $derived(
    data.filters.range === 'all' ? null : `prior ${data.filters.range === 'today' ? 'day' : data.filters.range}`
  );

  // Handle range change from DatePickerPopover
  function handleRangeChange(rangeValue: string) {
    const window = rangeValue === 'custom'
      ? customToRange({ from: data.filters.from!, to: data.filters.to! })
      : chipToRange(rangeValue as Range);

    // Check if cache covers the new window (widest-window strategy)
    const allFrom = window.priorFrom && window.priorFrom < window.from
      ? window.priorFrom : window.from;

    if (cacheCovers(allFrom, window.to)) {
      setRange(window);
      return;
    }

    // Cache doesn't cover — update store with what we have, SSR will refetch on next load
    setRange(window);
  }

  // Handle sales type toggle
  function handleSalesType(v: string) {
    const url = new URL(page.url);
    url.searchParams.set('sales_type', v);
    replaceState(url, {});
    setSalesType(v as 'all' | 'INHOUSE' | 'TAKEAWAY');
  }

  // Handle cash/card toggle
  function handleCashFilter(v: string) {
    const url = new URL(page.url);
    url.searchParams.set('is_cash', v);
    replaceState(url, {});
    setCashFilter(v as 'all' | 'cash' | 'card');
  }
</script>

<DashboardHeader />
<FilterBar
  filters={data.filters}
  window={data.window}
  onrangechange={handleRangeChange}
  onsalestypechange={handleSalesType}
  oncashfilterchange={handleCashFilter}
/>
<div class="px-4 py-2">
  <FreshnessLabel lastIngestedAt={data.freshness} />
</div>
<main class="mx-auto max-w-screen-sm px-4 pb-12">
  <div class="flex flex-col gap-6">
    {#if data.latestInsight}
      <InsightCard insight={data.latestInsight} />
    {/if}

    <!-- 2 KPI tiles: Revenue + Transactions (D-09, D-10, D-11) -->
    <div class="grid grid-cols-2 gap-4">
      <KpiTile
        title="Revenue · {rangeLabel}"
        value={kpi.revenue_cents}
        prior={kpi.prior_revenue_cents}
        format="eur-int"
        windowLabel={priorLabel}
        emptyCard="revenueChip"
      />
      <KpiTile
        title="Transactions · {rangeLabel}"
        value={kpi.tx_count}
        prior={kpi.prior_tx_count}
        format="int"
        windowLabel={priorLabel}
        emptyCard="revenueChip"
      />
    </div>

    <!-- Cohort retention — still SSR, no client-side rebucket needed -->
    <CohortRetentionCard data={data.retention} />
  </div>
</main>
