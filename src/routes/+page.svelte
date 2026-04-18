<script lang="ts">
  // Phase 9: simplified dashboard with 2 KPI tiles + cohort retention.
  // All KPI computation happens client-side via dashboardStore (D-05, D-08).
  import DashboardHeader from '$lib/components/DashboardHeader.svelte';
  import FilterBar from '$lib/components/FilterBar.svelte';
  import FreshnessLabel from '$lib/components/FreshnessLabel.svelte';
  import KpiTile from '$lib/components/KpiTile.svelte';
  import CohortRetentionCard from '$lib/components/CohortRetentionCard.svelte';
  import InsightCard from '$lib/components/InsightCard.svelte';
  // Phase 10: 6 new chart cards (VA-04..VA-10) inserted in D-10 order below.
  import DailyHeatmapCard from '$lib/components/DailyHeatmapCard.svelte';
  import CalendarRevenueCard from '$lib/components/CalendarRevenueCard.svelte';
  import CalendarCountsCard from '$lib/components/CalendarCountsCard.svelte';
  import CalendarItemsCard from '$lib/components/CalendarItemsCard.svelte';
  import CalendarItemRevenueCard from '$lib/components/CalendarItemRevenueCard.svelte';
  import RepeaterCohortCountCard from '$lib/components/RepeaterCohortCountCard.svelte';
  import LtvHistogramCard from '$lib/components/LtvHistogramCard.svelte';
  import {
    initStore, getKpiTotals, getFilters, getWindow,
    setRange, setRangeId, setSalesType, setCashFilter,
    cacheCovers, type DailyRow
  } from '$lib/dashboardStore.svelte';
  import { goto, replaceState } from '$app/navigation';
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

  // Filter-change loading indicator — tracks the actual duration of the inner
  // work (client-only store update OR async SSR invalidate round-trip).
  // quick-260418-g6s: switched from fixed 300ms setTimeout to try/finally around
  // await fn() so cache-miss chip clicks keep the spinner visible for the full
  // SSR round-trip (300-1000ms). Cache-hit clicks still resolve instantly.
  let isUpdating = $state(false);
  async function withUpdate(fn: () => void | Promise<void>) {
    isUpdating = true;
    try {
      await fn();
    } finally {
      isUpdating = false;
    }
  }

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
  async function handleRangeChange(rangeValue: string) {
    await withUpdate(async () => {
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

      // Cache miss — force SSR refetch with the URL that DatePickerPopover.applyPreset
      // just wrote via replaceState. Known SvelteKit quirk: invalidate() re-runs load
      // with the stale URL captured when load last ran — $app/navigation.replaceState
      // does NOT update the URL that invalidate sees. goto() with invalidateAll:true
      // is the canonical API that both updates SvelteKit's internal URL and forces
      // load re-run. replaceState:true prevents a duplicate history entry.
      // See .planning/debug/range-chip-stale-cache.md for the evidence chain.
      setRange(window);
      await goto(globalThis.window.location.href, {
        replaceState: true,
        invalidateAll: true,
        noScroll: true,
        keepFocus: true
      });
    });
  }

  // Handle sales type toggle
  function handleSalesType(v: string) {
    withUpdate(() => {
      replaceState(mergeSearchParams({ sales_type: v }), {});
      setSalesType(v as 'all' | 'INHOUSE' | 'TAKEAWAY');
    });
  }

  // Handle cash/card toggle
  function handleCashFilter(v: string) {
    withUpdate(() => {
      replaceState(mergeSearchParams({ is_cash: v }), {});
      setCashFilter(v as 'all' | 'cash' | 'card');
    });
  }
</script>

<DashboardHeader />
<FilterBar
  filters={storeFilters}
  window={storeWindow}
  isLoading={isUpdating}
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

    <!-- feedback #4: GitHub-style daily heatmap — full history, unfiltered -->
    <DailyHeatmapCard data={data.dailyKpi} />

    <!-- D-10 cards 4-5: Revenue + Transactions KPI tiles -->
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

    <!-- D-10 card 7: Calendar counts (VA-05) — self-subscribes to dashboardStore -->
    <CalendarCountsCard />

    <!-- D-10 card 8: Calendar revenue (VA-04) — self-subscribes to dashboardStore -->
    <CalendarRevenueCard />

    <!-- D-10 card 9: Calendar items (VA-08) — receives window-scoped rows from SSR -->
    <CalendarItemsCard data={data.itemCounts} />

    <!-- feedback #4: per-item revenue stacked bars — same payload, revenue metric -->
    <CalendarItemRevenueCard data={data.itemCounts} />

    <!-- D-10 card 10: Cohort retention (VA-06)
         quick-260418-28j: monthly grain now reads from retention_curve_monthly_v
         instead of re-bucketing weekly rows client-side. -->
    <CohortRetentionCard dataWeekly={data.retention} dataMonthly={data.retentionMonthly} />

    <!-- feedback #6: repeater customer count by first-visit cohort — lifetime, no range scoping -->
    <RepeaterCohortCountCard data={data.customerLtv} />

    <!-- D-10 card 12: LTV histogram (VA-07) — retrospective, placed last -->
    <LtvHistogramCard data={data.customerLtv} />
  </div>
</main>
