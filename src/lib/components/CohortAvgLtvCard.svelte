<script lang="ts">
  // VA-10: Cohort avg LTV — GROUPED (side-by-side) by repeater class (Pass 3 — quick-260418-3ec).
  // seriesLayout="group" not "stack" — averages don't sum meaningfully across classes.
  // Same data source as VA-09 (customer_ltv_v); client computes per-class avg via $lib/cohortAgg.
  // Sparse filter (D-19) + last-12-cohort clamp + D-17 day→week hint — mirrors VA-09.
  import { BarChart } from 'layerchart';
  import EmptyState from './EmptyState.svelte';
  import { cohortAvgLtvByRepeater, type CustomerLtvRow } from '$lib/cohortAgg';
  import { REPEATER_COLORS } from '$lib/chartPalettes';
  import { formatEURShort } from '$lib/format';
  import { getFilters, formatBucketLabel, computeChartWidth, MAX_X_TICKS } from '$lib/dashboardStore.svelte';

  let { data }: { data: CustomerLtvRow[] } = $props();

  const cohortGrain = $derived.by<'week' | 'month'>(() => {
    const g = getFilters().grain;
    return g === 'month' ? 'month' : 'week';
  });

  const showClampHint = $derived(getFilters().grain === 'day');

  const chartData = $derived.by(() => {
    const aggs = cohortAvgLtvByRepeater(data, cohortGrain);
    return aggs.slice(-12).map((a) => ({
      cohort: formatBucketLabel(a.cohort, cohortGrain),
      new_avg_eur: Math.round(a.new_avg_cents / 100),
      repeat_avg_eur: Math.round(a.repeat_avg_cents / 100)
    }));
  });

  let cardW = $state(0);
  const chartW = $derived(computeChartWidth(chartData.length, cardW));
</script>

<div
  data-testid="cohort-avg-ltv-card"
  class="rounded-xl border border-zinc-200 bg-white p-4"
>
  <h2 class="text-base font-semibold text-zinc-900">Average LTV per customer by cohort — new vs. repeat</h2>
  <p class="mt-1 text-xs text-zinc-500">
    Average lifetime value per customer, by acquisition cohort.
  </p>

  <!-- Inline legend (≤30 lines — LayerChart legend emission is not guaranteed). -->
  <div class="mt-2 flex items-center gap-4 text-xs text-zinc-600">
    <span class="inline-flex items-center gap-1">
      <span class="inline-block h-2 w-2 rounded-full" style:background-color={REPEATER_COLORS.new}></span>
      New
    </span>
    <span class="inline-flex items-center gap-1">
      <span class="inline-block h-2 w-2 rounded-full" style:background-color={REPEATER_COLORS.repeat}></span>
      Repeat
    </span>
  </div>

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
    <div bind:clientWidth={cardW} class="mt-4 h-64 overflow-x-auto touch-pan-x overscroll-x-contain chart-touch-safe">
      <BarChart
        data={chartData}
        x="cohort"
        series={[
          { key: 'new_avg_eur', label: 'New', color: REPEATER_COLORS.new },
          { key: 'repeat_avg_eur', label: 'Repeat', color: REPEATER_COLORS.repeat }
        ]}
        seriesLayout="group"
        orientation="vertical"
        bandPadding={0.2}
        width={chartW}
        props={{ xAxis: { ticks: MAX_X_TICKS }, yAxis: { format: formatEURShort } }}
        tooltipContext={{ touchEvents: 'pan-x' }}
      />
    </div>
  {/if}
</div>
