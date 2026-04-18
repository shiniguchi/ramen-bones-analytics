<script lang="ts">
  // Feedback #6: "repeater customer count by 1st-time visit cohort, broken down
  // by visit number" — reveals *when* the restaurant acquired the customers who
  // actually came back. Replaces the old VA-10 avg-LTV card.
  //
  // seriesLayout="group" (user's explicit call over stacked) — adjacent bars per
  // bucket make per-visit-bucket comparison easier than a stacked column.
  import { BarChart } from 'layerchart';
  import EmptyState from './EmptyState.svelte';
  import {
    cohortRepeaterCountByVisitBucket,
    REPEATER_BUCKET_KEYS,
    type CustomerLtvRow
  } from '$lib/cohortAgg';
  import { VISIT_SEQ_COLORS } from '$lib/chartPalettes';
  import { formatIntShort } from '$lib/format';
  import {
    getFilters,
    formatBucketLabel,
    computeChartWidth,
    MAX_X_TICKS
  } from '$lib/dashboardStore.svelte';

  let { data }: { data: CustomerLtvRow[] } = $props();

  // D-17: day clamps to week for cohort-semantic charts (shared with VA-06/VA-07).
  const cohortGrain = $derived.by<'week' | 'month'>(() => {
    const g = getFilters().grain;
    return g === 'month' ? 'month' : 'week';
  });
  const showClampHint = $derived(getFilters().grain === 'day');

  // Last 12 cohorts keep the grouped-bars legible at 375px (7 bars × 12 = 84 max).
  const chartData = $derived.by(() => {
    const aggs = cohortRepeaterCountByVisitBucket(data, cohortGrain);
    return aggs.slice(-12).map((a) => {
      const row: Record<string, string | number> = {
        cohort: formatBucketLabel(a.cohort, cohortGrain)
      };
      for (const k of REPEATER_BUCKET_KEYS) row[k] = a[k];
      return row;
    });
  });

  // Colors: VISIT_SEQ_COLORS index 1..7 (matches bucket labels 2nd..8x+).
  const series = REPEATER_BUCKET_KEYS.map((k, i) => ({
    key: k,
    label: k,
    color: VISIT_SEQ_COLORS[i + 1]
  }));

  const yAxisFormat = (n: number) => formatIntShort(n, 'cust');

  let cardW = $state(0);
  const chartW = $derived(computeChartWidth(chartData.length, cardW));
</script>

<div
  data-testid="repeater-cohort-count-card"
  class="rounded-xl border border-zinc-200 bg-white p-4"
>
  <h2 class="text-base font-semibold text-zinc-900">
    Repeaters acquired by first-visit cohort
  </h2>
  <p class="mt-1 text-xs text-zinc-500">
    Customers who came back 2+ times, grouped by visit count — placed in their first-visit period.
  </p>

  <!-- 7-bucket gradient legend (2nd..8x+). -->
  <div class="mt-2 flex items-center gap-3 text-xs text-zinc-600">
    <span>2nd</span>
    <div class="flex h-2 flex-1 overflow-hidden rounded">
      {#each VISIT_SEQ_COLORS.slice(1) as color}
        <div class="flex-1" style:background-color={color}></div>
      {/each}
    </div>
    <span>8x+</span>
  </div>

  {#if showClampHint}
    <p data-testid="cohort-clamp-hint" class="mt-2 text-xs text-amber-600">
      Cohort view shows weekly — other grains not applicable.
    </p>
  {/if}

  {#if chartData.length === 0}
    <EmptyState card="cohort-avg-ltv" />
  {:else}
    <div
      bind:clientWidth={cardW}
      class="mt-4 h-64 overflow-x-auto touch-auto overscroll-x-contain chart-touch-safe"
    >
      <BarChart
        data={chartData}
        x="cohort"
        {series}
        seriesLayout="group"
        orientation="vertical"
        bandPadding={0.2}
        width={chartW}
        padding={{ left: 40, right: 8, top: 8, bottom: 24 }}
        props={{ xAxis: { ticks: MAX_X_TICKS }, yAxis: { format: yAxisFormat } }}
        tooltipContext={{ touchEvents: 'auto' }}
      />
    </div>
  {/if}
</div>
