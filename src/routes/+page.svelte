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
    initStore, getKpiTotals, getFilters, getWindow,
    setRange, setRangeId, setSalesType, setCashFilter,
    cacheCovers, type DailyRow
  } from '$lib/dashboardStore.svelte';
  import { replaceState } from '$app/navigation';
  import { mergeSearchParams } from '$lib/urlState';
  import { chipToRange, customToRange, type Range, type RangeWindow } from '$lib/dateRange';
  import type { FiltersState } from '$lib/filters';

  let { data } = $props();

  // Initialize store from SSR data on mount and when SSR data changes.
  $effect(() => {
    initStore({
      dailyRows: [...data.dailyRows, ...data.priorDailyRows],
      window: data.window,
      grain: data.grain as 'day' | 'week' | 'month',
      salesType: (data.filters.sales_type ?? 'all') as 'all' | 'INHOUSE' | 'TAKEAWAY',
      cashFilter: (data.filters.is_cash ?? 'all') as 'all' | 'cash' | 'card',
      filters: data.filters
    });
  });

  // Reactive KPI totals from store (getter function, not direct export).
  const kpi = $derived(getKpiTotals());

  // Reactive filters — single source of truth for FilterBar + label derivations.
  // Fixes UAT 7/9: data.filters is frozen at SSR; store.getFilters() tracks clicks.
  const storeFilters = $derived(getFilters());

  // Reactive window — DatePickerPopover reads from/to for its date subtitle.
  // Fixes UAT Test 7: data.window is frozen at SSR; getWindow() tracks setRange().
  const storeWindow = $derived(getWindow());

  // Range label for tile titles
  const rangeLabel = $derived.by(() => {
    const r = storeFilters.range;
    if (r === 'custom' && storeFilters.from && storeFilters.to) {
      return `${storeFilters.from} \u2013 ${storeFilters.to}`;
    }
    if (r === 'today') return 'Today';
    return r;
  });

  // Prior period label for delta display
  const priorLabel = $derived(
    storeFilters.range === 'all'
      ? null
      : `prior ${storeFilters.range === 'today' ? 'day' : storeFilters.range}`
  );

  // Handle range change from DatePickerPopover.
  // Preset ids come through directly; 'custom' means the popover has already
  // written from/to to the URL via replaceState — we read them off the live URL.
  function handleRangeChange(rangeValue: string) {
    let window: RangeWindow;
    if (rangeValue === 'custom') {
      // Read custom from/to from live browser URL — DatePickerPopover.applyCustom
      // has already written them via replaceState. page.url is stale; use
      // globalThis.window.location.href (the local `window: RangeWindow` shadows
      // the browser `window` inside this function).
      const url = new URL(globalThis.window.location.href);
      const from = url.searchParams.get('from')!;
      const to = url.searchParams.get('to')!;
      window = customToRange({ from, to });
      setRangeId('custom', { from, to });
    } else {
      window = chipToRange(rangeValue as Range);
      setRangeId(rangeValue as FiltersState['range']);
    }

    // Check if cache covers the new window (widest-window strategy)
    const allFrom = window.priorFrom && window.priorFrom < window.from
      ? window.priorFrom : window.from;

    if (cacheCovers(allFrom, window.to)) {
      setRange(window);
      return;
    }

    // Cache doesn't cover — update store with what we have, SSR refetches on next load.
    setRange(window);
  }

  // Handle sales type toggle
  function handleSalesType(v: string) {
    replaceState(mergeSearchParams({ sales_type: v }), {});
    setSalesType(v as 'all' | 'INHOUSE' | 'TAKEAWAY');
  }

  // Handle cash/card toggle
  function handleCashFilter(v: string) {
    replaceState(mergeSearchParams({ is_cash: v }), {});
    setCashFilter(v as 'all' | 'cash' | 'card');
  }
</script>

<DashboardHeader />
<FilterBar
  filters={storeFilters}
  window={storeWindow}
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
