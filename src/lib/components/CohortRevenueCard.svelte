<script lang="ts">
  // VA-09: Cohort total revenue per weekly/monthly acquisition cohort.
  // Client-side GROUP BY customer_ltv_v rows via $lib/cohortAgg (D-01 hybrid).
  // Global grain=day → clamps to weekly with inline hint (D-17).
  // Sparse filter (D-19) applied inside cohortRevenueSum; last 12 cohorts max
  // keep 375px bars legible (RESEARCH.md §Pattern 5).
  import { BarChart } from 'layerchart';
  import EmptyState from './EmptyState.svelte';
  import { cohortRevenueSum, type CustomerLtvRow } from '$lib/cohortAgg';
  import { getFilters, formatBucketLabel, computeChartWidth, MAX_X_TICKS } from '$lib/dashboardStore.svelte';

  let { data }: { data: CustomerLtvRow[] } = $props();

  // D-17: day clamps to week for cohort-semantic charts. week/month pass through.
  const cohortGrain = $derived.by<'week' | 'month'>(() => {
    const g = getFilters().grain;
    return g === 'month' ? 'month' : 'week';
  });

  // Inline hint when the user's global grain is 'day' — cohort chart can't honor it.
  const showClampHint = $derived(getFilters().grain === 'day');

  // Last 12 cohorts only — keeps 375px bars readable (RESEARCH.md §Pattern 5 line 452).
  const chartData = $derived.by(() => {
    const aggs = cohortRevenueSum(data, cohortGrain);
    return aggs.slice(-12).map((a) => ({
      cohort: formatBucketLabel(a.cohort, cohortGrain),
      revenue_eur: Math.round(a.total_revenue_cents / 100)
    }));
  });

  let cardW = $state(0);
  const chartW = $derived(computeChartWidth(chartData.length, cardW));
</script>

<div
  data-testid="cohort-revenue-card"
  class="rounded-xl border border-zinc-200 bg-white p-4"
>
  <h2 class="text-base font-semibold text-zinc-900">Cohort total revenue</h2>
  <p class="mt-1 text-xs text-zinc-500">
    Lifetime revenue per acquisition cohort.
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
    <EmptyState card="cohort-revenue" />
  {:else}
    <div bind:clientWidth={cardW} class="mt-4 h-64 overflow-x-auto touch-pan-x overscroll-x-contain">
      <BarChart
        data={chartData}
        x="cohort"
        y="revenue_eur"
        orientation="vertical"
        bandPadding={0.2}
        width={chartW}
        props={{ xAxis: { ticks: MAX_X_TICKS } }}
        tooltipContext={{ touchEvents: 'pan-x' }}
      />
    </div>
  {/if}
</div>
