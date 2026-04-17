<script lang="ts">
  // VA-10: Cohort avg LTV per weekly/monthly acquisition cohort.
  // Same data source as VA-09 (customer_ltv_v); client computes avg via $lib/cohortAgg.
  // Sparse filter (D-19) + last-12-cohort clamp + D-17 day→week hint — mirrors VA-09.
  import { BarChart } from 'layerchart';
  import EmptyState from './EmptyState.svelte';
  import { cohortAvgLtv, type CustomerLtvRow } from '$lib/cohortAgg';
  import { getFilters, formatBucketLabel, computeChartWidth, MAX_X_TICKS } from '$lib/dashboardStore.svelte';

  let { data }: { data: CustomerLtvRow[] } = $props();

  const cohortGrain = $derived.by<'week' | 'month'>(() => {
    const g = getFilters().grain;
    return g === 'month' ? 'month' : 'week';
  });

  const showClampHint = $derived(getFilters().grain === 'day');

  const chartData = $derived.by(() => {
    const aggs = cohortAvgLtv(data, cohortGrain);
    return aggs.slice(-12).map((a) => ({
      cohort: formatBucketLabel(a.cohort, cohortGrain),
      avg_eur: Math.round(a.avg_revenue_cents / 100)
    }));
  });

  let cardW = $state(0);
  const chartW = $derived(computeChartWidth(chartData.length, cardW));
</script>

<div
  data-testid="cohort-avg-ltv-card"
  class="rounded-xl border border-zinc-200 bg-white p-4"
>
  <h2 class="text-base font-semibold text-zinc-900">Cohort avg LTV</h2>
  <p class="mt-1 text-xs text-zinc-500">
    Average lifetime value per customer, by acquisition cohort.
  </p>

  {#if showClampHint}
    <p
      data-testid="cohort-clamp-hint"
      class="mt-2 text-xs text-amber-600"
    >
      Cohort view shows weekly — other grains not applicable.
    </p>
  {/if}

  {#if chartData.length === 0}
    <EmptyState card="cohort-avg-ltv" />
  {:else}
    <div bind:clientWidth={cardW} class="mt-4 h-64 overflow-x-auto">
      <BarChart
        data={chartData}
        x="cohort"
        y="avg_eur"
        orientation="vertical"
        bandPadding={0.2}
        width={chartW}
        props={{ xAxis: { ticks: MAX_X_TICKS } }}
      />
    </div>
  {/if}
</div>
