<script lang="ts">
  // Phase 9: simplified dashboard with 2 KPI tiles + cohort retention.
  // All KPI computation happens client-side via dashboardStore (D-05, D-08).
  // Phase 11-02 D-03/D-04: 4 below-fold cards now fetch their data client-side
  // via LazyMount + clientFetch when the card scrolls into view. SSR payload
  // shrinks from 11 queries to 6, keeping above-fold paint fast and bounded.
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
  import MdeCurveCard from '$lib/components/MdeCurveCard.svelte';
  import RepeaterCohortCountCard from '$lib/components/RepeaterCohortCountCard.svelte';
  import LazyMount from '$lib/components/LazyMount.svelte';
  import { clientFetch } from '$lib/clientFetch';
  import {
    initStore, getKpiTotals, getFilters, getWindow,
    setRange, setRangeId, setSalesType, setCashFilter, setDaysFilter,
    cacheCovers, type DailyRow
  } from '$lib/dashboardStore.svelte';
  import { goto, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { t } from '$lib/i18n/messages';
  import { mergeSearchParams } from '$lib/urlState';
  import { chipToRange, customToRange, type Range, type RangeWindow } from '$lib/dateRange';
  import { DAYS_DEFAULT, type FiltersState } from '$lib/filters';
  import { differenceInMonths, parseISO } from 'date-fns';

  let { data } = $props();

  // Phase 11 D-03/D-04: deferred client-side fetches. Each runs once when the
  // LazyMount wrapping its card first scrolls into view (IntersectionObserver
  // onvisible callback — the single mandated trigger API).
  type DailyKpiRow       = { business_date: string; revenue_cents: number | string; tx_count: number };
  type CustomerLtvRow    = { card_hash: string; revenue_cents: number; visit_count: number; cohort_week: string; cohort_month: string };
  type RepeaterTxRow     = { card_hash: string; business_date: string; gross_cents: number };
  type RetentionRow      = { cohort_week: string; period_weeks: number; retention_rate: number; cohort_size_week: number; cohort_age_weeks: number };
  type RetentionMonthlyRow = { cohort_month: string; period_months: number; retention_rate: number; cohort_size_month: number; cohort_age_months: number };

  let dailyKpi        = $state<DailyKpiRow[]>([]);
  let customerLtv     = $state<CustomerLtvRow[]>([]);
  let repeaterTx      = $state<RepeaterTxRow[]>([]);
  let retention         = $state<RetentionRow[]>([]);
  let retentionMonthly  = $state<RetentionMonthlyRow[]>([]);

  // D-04 no-regression: monthsOfHistory drives the caveat copy in
  // CohortRetentionCard. Derive from the earliest cohort_week in the
  // /api/retention weekly payload as soon as it resolves.
  let monthsOfHistory = $state<number>(0);

  async function loadDailyKpi() {
    try { dailyKpi = await clientFetch<DailyKpiRow[]>('/api/kpi-daily'); }
    catch (e) { console.error('[LazyMount /api/kpi-daily]', e); }
  }
  async function loadCustomerLtv() {
    try { customerLtv = await clientFetch<CustomerLtvRow[]>('/api/customer-ltv'); }
    catch (e) { console.error('[LazyMount /api/customer-ltv]', e); }
  }

  // D-03 ?days= contract: skip the fetch entirely when filters.days is the
  // default (all 7 days) — server payload would be unchanged anyway, so
  // avoid the round-trip.
  async function loadRepeaterTx() {
    const days = data.filters.days ?? DAYS_DEFAULT;
    const isDefault =
      days.length === DAYS_DEFAULT.length &&
      DAYS_DEFAULT.every((d) => days.includes(d));
    if (isDefault) return;
    try {
      const qs = `?days=${days.join(',')}`;
      repeaterTx = await clientFetch<RepeaterTxRow[]>(`/api/repeater-lifetime${qs}`);
    } catch (e) { console.error('[LazyMount /api/repeater-lifetime]', e); }
  }

  async function loadRetention() {
    try {
      const r = await clientFetch<{ weekly: RetentionRow[]; monthly: RetentionMonthlyRow[] }>('/api/retention');
      retention = r.weekly;
      retentionMonthly = r.monthly;
      // D-04 no-regression: compute monthsOfHistory from the earliest cohort_week.
      if (r.weekly.length > 0) {
        const earliest = [...r.weekly].sort((a, b) => a.cohort_week.localeCompare(b.cohort_week))[0];
        monthsOfHistory = Math.max(0, differenceInMonths(new Date(), parseISO(earliest.cohort_week)));
      }
    } catch (e) { console.error('[LazyMount /api/retention]', e); }
  }

  // Initialize store from SSR data on mount and when SSR data changes.
  $effect(() => {
    initStore({
      dailyRows: [...data.dailyRows, ...data.priorDailyRows],
      window: data.window,
      grain: data.grain as 'day' | 'week' | 'month',
      salesType: (data.filters.sales_type ?? 'all') as 'all' | 'INHOUSE' | 'TAKEAWAY',
      cashFilter: (data.filters.is_cash ?? 'all') as 'all' | 'cash' | 'card',
      daysFilter: data.filters.days,
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
    const loc = page.data.locale;
    if (r === 'today') return t(loc, 'range_today');
    if (r === 'all') return t(loc, 'range_all');
    return r;
  });

  // Prior period label for delta display — localized via prior_label template.
  const priorLabel = $derived.by(() => {
    if (storeFilters.range === 'all') return null;
    const loc = page.data.locale;
    const rangeWord =
      storeFilters.range === 'today'
        ? t(loc, 'grain_day').toLowerCase()
        : storeFilters.range;
    return t(loc, 'prior_label', { range: rangeWord });
  });

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
        // Phase 11-01 D-01: pass the tenant's true earliest business_date so
        // clicking "All" resolves to the real data floor (e.g. 2025-06-10),
        // not the FROM_FLOOR fallback (2025-06-01). undefined (no data yet)
        // lets chipToRange fall back to FROM_FLOOR.
        window = chipToRange(rangeValue as Range, new Date(), {
          allStart: data.earliestBusinessDate ?? undefined
        });
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

  // Handle day-of-week filter change. All 7 days selected → strip param; else CSV.
  function handleDaysChange(v: number[]) {
    withUpdate(() => {
      setDaysFilter(v);
      const allDays = v.length === 7;
      replaceState(mergeSearchParams({ days: allDays ? null : v.join(',') }), {});
    });
  }
</script>

<DashboardHeader />
<FilterBar
  filters={storeFilters}
  window={storeWindow}
  isLoading={isUpdating}
  days={storeFilters.days}
  onrangechange={handleRangeChange}
  onsalestypechange={handleSalesType}
  oncashfilterchange={handleCashFilter}
  onDaysChange={handleDaysChange}
/>
<div class="px-4 py-2">
  <FreshnessLabel lastIngestedAt={data.freshness} />
</div>
<main class="mx-auto max-w-screen-sm px-4 pb-12">
  <div class="flex flex-col gap-6">
    {#if data.latestInsight}
      <InsightCard insight={data.latestInsight} isAdmin={data.isAdmin ?? false} />
    {/if}

    <!-- D-10 cards 4-5: Revenue + Transactions KPI tiles -->
    <div class="grid grid-cols-2 gap-4">
      <KpiTile
        title="{t(page.data.locale, 'kpi_revenue')} · {rangeLabel}"
        value={kpi.revenue_cents}
        prior={kpi.prior_revenue_cents}
        format="eur-int"
        windowLabel={priorLabel}
        emptyCard="revenueChip"
      />
      <KpiTile
        title="{t(page.data.locale, 'kpi_transactions')} · {rangeLabel}"
        value={kpi.tx_count}
        prior={kpi.prior_tx_count}
        format="int"
        windowLabel={priorLabel}
        emptyCard="revenueChip"
      />
    </div>

    <!-- feedback #4 (moved per feedback round F): heatmap sits right below the KPI tiles.
         Phase 11-02 D-03: deferred to /api/kpi-daily via LazyMount. -->
    <LazyMount minHeight="280px" onvisible={loadDailyKpi}>
      {#snippet children()}
        <DailyHeatmapCard data={dailyKpi} />
      {/snippet}
    </LazyMount>

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
         instead of re-bucketing weekly rows client-side.
         Phase 11-02 D-03/D-04: deferred to /api/retention via LazyMount;
         monthsOfHistory computed from the weekly payload on client. -->
    <LazyMount minHeight="320px" onvisible={loadRetention}>
      {#snippet children()}
        <CohortRetentionCard
          dataWeekly={retention}
          dataMonthly={retentionMonthly}
          benchmarkAnchors={data.benchmarkAnchors}
          benchmarkSources={data.benchmarkSources}
          monthsOfHistory={monthsOfHistory}
        />
      {/snippet}
    </LazyMount>

    <!-- feedback #6: repeater customer count by first-visit cohort — lifetime, no range scoping.
         Phase 11-02 D-03: customerLtv deferred to /api/customer-ltv;
         repeaterTx deferred to /api/repeater-lifetime?days=… (skipped when
         filters.days is the default [1..7]). -->
    <LazyMount minHeight="320px" onvisible={() => { loadCustomerLtv(); loadRepeaterTx(); }}>
      {#snippet children()}
        <RepeaterCohortCountCard data={customerLtv} repeaterTx={repeaterTx} />
      {/snippet}
    </LazyMount>

    <!-- quick-260424-mdc: Minimum Detectable Effect curve — last card by design
         (decision-support, consulted after owner has absorbed the primary KPIs). -->
    <MdeCurveCard />
  </div>
</main>
