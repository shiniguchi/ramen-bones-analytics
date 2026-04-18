<script lang="ts">
  // VA-10: Cohort avg LTV — GROUPED by 8 visit_count buckets (Pass 4 — quick-260418-4oh).
  // seriesLayout="group" not "stack" — averages don't sum across buckets (user-locked).
  // Client computes per-bucket avg via cohortAvgLtvByVisitBucket.
  // Sparse filter + last-12-cohort clamp + D-17 day→week hint — preserved from Pass 3.
  import { BarChart } from 'layerchart';
  import EmptyState from './EmptyState.svelte';
  import {
    cohortAvgLtvByVisitBucket,
    VISIT_BUCKET_KEYS,
    type CustomerLtvRow
  } from '$lib/cohortAgg';
  import { VISIT_SEQ_COLORS } from '$lib/chartPalettes';
  import { formatEURShort } from '$lib/format';
  import {
    getFilters,
    formatBucketLabel,
    computeChartWidth,
    MAX_X_TICKS
  } from '$lib/dashboardStore.svelte';

  let { data }: { data: CustomerLtvRow[] } = $props();

  // D-17: day clamps to week for cohort-semantic charts. week/month pass through.
  const cohortGrain = $derived.by<'week' | 'month'>(() => {
    const g = getFilters().grain;
    return g === 'month' ? 'month' : 'week';
  });

  const showClampHint = $derived(getFilters().grain === 'day');

  // Per-cohort avg revenue_cents by bucket → euros. Last 12 cohorts only to keep
  // 375px bars legible (8 groups × 12 cohorts = 96 bars max).
  const chartData = $derived.by(() => {
    const aggs = cohortAvgLtvByVisitBucket(data, cohortGrain);
    return aggs.slice(-12).map((a) => {
      const row: Record<string, string | number> = {
        cohort: formatBucketLabel(a.cohort, cohortGrain)
      };
      for (const k of VISIT_BUCKET_KEYS) {
        row[k] = Math.round(a[k] / 100);
      }
      return row;
    });
  });

  const series = VISIT_BUCKET_KEYS.map((k, i) => ({
    key: k,
    label: k,
    color: VISIT_SEQ_COLORS[i]
  }));

  let cardW = $state(0);
  const chartW = $derived(computeChartWidth(chartData.length, cardW));
</script>

<div
  data-testid="cohort-avg-ltv-card"
  class="rounded-xl border border-zinc-200 bg-white p-4"
>
  <h2 class="text-base font-semibold text-zinc-900">Average LTV per customer by cohort — by visit count</h2>
  <p class="mt-1 text-xs text-zinc-500">Average lifetime value per customer, grouped by visit count.</p>

  <!-- 8-bucket gradient legend — byte-identical shape to VA-07. -->
  <div class="mt-2 flex items-center gap-3 text-xs text-zinc-600">
    <span>1st</span>
    <div class="flex h-2 flex-1 overflow-hidden rounded">
      {#each VISIT_SEQ_COLORS as color}
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
        props={{ xAxis: { ticks: MAX_X_TICKS }, yAxis: { format: formatEURShort } }}
        tooltipContext={{ touchEvents: 'auto' }}
      />
    </div>
  {/if}
</div>
