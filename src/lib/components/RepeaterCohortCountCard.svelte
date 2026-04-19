<script lang="ts">
  // Feedback #6: "repeater customer count by 1st-time visit cohort, broken down
  // by visit number" — reveals *when* the restaurant acquired the customers who
  // actually came back. Replaces the old VA-10 avg-LTV card.
  //
  // seriesLayout="group" (user's explicit call over stacked) — adjacent bars per
  // bucket make per-visit-bucket comparison easier than a stacked column.
  import { Chart, Svg, Axis, Bars, Text, Tooltip } from 'layerchart';
  import EmptyState from './EmptyState.svelte';
  import {
    cohortRepeaterCountByVisitBucket,
    REPEATER_BUCKET_KEYS,
    type CustomerLtvRow
  } from '$lib/cohortAgg';
  import { VISIT_SEQ_COLORS } from '$lib/chartPalettes';
  import { formatIntShort } from '$lib/format';
  import { bandCenterX, bucketTotals } from '$lib/trendline';
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

  // Show every non-sparse cohort — the overflow-x-auto wrapper + computeChartWidth
  // handle mobile scroll; previous .slice(-12) was hiding genuine early history.
  const chartData = $derived.by(() => {
    const aggs = cohortRepeaterCountByVisitBucket(data, cohortGrain);
    return aggs.map((a) => {
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
  const totals = $derived(bucketTotals(chartData, REPEATER_BUCKET_KEYS));

  // Grouped bars: position label above the tallest sub-bar (not yScale(total),
  // which sits far above the chart when buckets are small). Keeps the label
  // visually attached to the bar cluster it summarises.
  const maxPerCohort = $derived(
    chartData.map((row) => {
      let m = 0;
      for (const k of REPEATER_BUCKET_KEYS) {
        const v = row[k];
        if (typeof v === 'number' && v > m) m = v;
      }
      return m;
    })
  );

  let cardW = $state(0);
  const chartW = $derived(computeChartWidth(chartData.length, cardW));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let chartCtx = $state<any>();
</script>

<div
  data-testid="repeater-cohort-count-card"
  class="rounded-xl border border-zinc-200 bg-white p-4"
>
  <h2 class="text-base font-semibold text-zinc-900">
    Repeaters acquired by first-visit grouping
  </h2>
  <p class="mt-1 text-xs text-zinc-500">
    Customers who came back 2+ times, grouped by visit count — placed in their first-visit period.
  </p>

  {#if showClampHint}
    <p data-testid="cohort-clamp-hint" class="mt-2 text-xs text-amber-600">
      Grouping view shows weekly — other grains not applicable.
    </p>
  {/if}

  {#if chartData.length === 0}
    <EmptyState card="cohort-avg-ltv" />
  {:else}
    <div
      bind:clientWidth={cardW}
      class="mt-4 h-64 overflow-x-auto overscroll-x-contain chart-touch-safe"
    >
      <Chart
        bind:context={chartCtx}
        data={chartData}
        x="cohort"
        {series}
        seriesLayout="group"
        bandPadding={0.2}
        valueAxis="y"
        width={chartW}
        padding={{ left: 64, right: 8, top: 24, bottom: 24 }}
        tooltipContext={{ mode: 'band', touchEvents: 'auto' }}
      >
        <Svg>
          <Axis placement="left" format={yAxisFormat} grid rule />
          <Axis placement="bottom" ticks={MAX_X_TICKS} rule />
          {#each series as s, i (s.key)}
            <Bars seriesKey={s.key} rounded="edge" radius={4} strokeWidth={1} />
          {/each}
          {#each chartData as row, i (row.cohort)}
            {#if totals[i] > 0 && chartCtx}
              <Text
                x={bandCenterX(chartCtx.xScale, row.cohort)}
                y={(chartCtx.yScale(maxPerCohort[i]) ?? 0) - 6}
                value={formatIntShort(totals[i])}
                textAnchor="middle"
                class="pointer-events-none fill-zinc-700 text-[10px] font-medium"
              />
            {/if}
          {/each}
        </Svg>
        <Tooltip.Root>
          {#snippet children({ data: row })}
            {@const bucketIdx = chartData.findIndex((r) => r.cohort === row?.cohort)}
            {@const fullRow = bucketIdx >= 0 ? chartData[bucketIdx] : row}
            <Tooltip.Header>{fullRow?.cohort}</Tooltip.Header>
            <Tooltip.List>
              {#each REPEATER_BUCKET_KEYS as k, i (k)}
                {#if ((fullRow?.[k] as number) ?? 0) > 0}
                  <Tooltip.Item label={k} color={VISIT_SEQ_COLORS[i + 1]} value={`${fullRow[k]} cust`} />
                {/if}
              {/each}
              <Tooltip.Item label="Total" value={`${bucketIdx >= 0 ? totals[bucketIdx] : 0} cust`} />
            </Tooltip.List>
          {/snippet}
        </Tooltip.Root>
      </Chart>
    </div>

    <!-- 7-bucket gradient legend (2nd..8x+) below chart — aligned with the
         other bar cards per feedback F7. -->
    <div class="mt-2 flex items-center gap-3 text-xs text-zinc-600">
      <span>2nd</span>
      <div class="flex h-2 flex-1 overflow-hidden rounded">
        {#each VISIT_SEQ_COLORS.slice(1) as color}
          <div class="flex-1" style:background-color={color}></div>
        {/each}
      </div>
      <span>8x+</span>
    </div>
  {/if}
</div>
