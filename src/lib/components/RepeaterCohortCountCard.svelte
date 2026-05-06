<script lang="ts">
  // Feedback #6: "repeater customer count by 1st-time visit cohort, broken down
  // by visit number" — reveals *when* the restaurant acquired the customers who
  // actually came back. Replaces the old VA-10 avg-LTV card.
  //
  // seriesLayout="stack" — LayerChart's low-level <Bars> primitive does not honor
  // `seriesLayout="group"` on the parent <Chart> (each <Bars> lands at the same
  // band x-position regardless), so all 7 series overlapped and the tallest
  // ("2nd" bucket) occluded the shorter ones visually. Switching to stack shows
  // total cohort size at a glance AND the per-bucket breakdown as segments —
  // same visual grammar as the sibling Calendar{Revenue,Counts} cards.
  import { Chart, Svg, Axis, Bars, Text, Tooltip } from 'layerchart';
  import { page } from '$app/state';
  import { t } from '$lib/i18n/messages';
  import EmptyState from './EmptyState.svelte';
  import EventBadgeStrip from './EventBadgeStrip.svelte';
  import {
    cohortRepeaterCountByVisitBucket,
    recomputeCustomerLtvFromTx,
    REPEATER_BUCKET_KEYS,
    type CustomerLtvRow,
    type RepeaterTxRow
  } from '$lib/cohortAgg';
  import { SPARSE_MIN_COHORT_SIZE } from '$lib/sparseFilter';
  import { VISIT_SEQ_COLORS } from '$lib/chartPalettes';
  import { formatIntShort } from '$lib/format';
  import { bandCenterX, bucketTotals } from '$lib/trendline';
  import {
    getFilters,
    formatBucketLabel,
    computeChartWidth,
    MAX_X_TICKS
  } from '$lib/dashboardStore.svelte';
  import { clientFetch } from '$lib/clientFetch';
  import type { ForecastEvent } from '$lib/forecastEventClamp';

  let { data, repeaterTx }: { data: CustomerLtvRow[]; repeaterTx: RepeaterTxRow[] } = $props();

  // D-17: day clamps to week for cohort-semantic charts (shared with VA-06/VA-07).
  const cohortGrain = $derived.by<'week' | 'month'>(() => {
    const g = getFilters().grain;
    return g === 'month' ? 'month' : 'week';
  });
  const showClampHint = $derived(getFilters().grain === 'day');
  // quick-260420-wdf (round 2): day-of-week filter recomputes lifetime stats
  // from raw transactions. All-7 days → use SSR customer_ltv_v as the fast
  // path (pre-aggregated in the DB). Subset → recompute client-side from
  // repeaterTx so visit_count + cohort_month shift under the "what if we
  // only operated these days?" hypothetical.
  const effectiveData = $derived.by(() => {
    const days = getFilters().days;
    if (days.length === 7) return data;
    return recomputeCustomerLtvFromTx(repeaterTx, days);
  });

  // Show every non-sparse cohort — the overflow-x-auto wrapper + computeChartWidth
  // handle mobile scroll; previous .slice(-12) was hiding genuine early history.
  const chartData = $derived.by(() => {
    const aggs = cohortRepeaterCountByVisitBucket(effectiveData, cohortGrain);
    return aggs.map((a) => {
      const row: Record<string, string | number> = {
        // Phase 16.3: keep raw ISO cohort key for EventBadgeStrip alignment
        // (a.cohort is yyyy-MM-dd for both week and month from cohortAgg).
        cohort_iso: a.cohort,
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

  let cardW = $state(0);
  const chartW = $derived(computeChartWidth(chartData.length, cardW));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let chartCtx = $state<any>();

  // Phase 16.3 D-09: VA-09 visit-sequence chart wires EventBadgeStrip via a
  // standalone /api/forecast call reading only the events field. Locked
  // option (a) per CONTEXT.md (no useEvents() factory — single-purpose call).
  // Granularity = cohortGrain (week | month) per planner direction.
  let events = $state<ForecastEvent[]>([]);
  let lastFetchedKey: string | null = null;
  $effect(() => {
    const earliestIso = chartData[0]?.cohort_iso;
    const g = cohortGrain;
    if (typeof earliestIso !== 'string') return;
    const key = `${g}|${earliestIso}`;
    if (lastFetchedKey === key) return;
    lastFetchedKey = key;
    clientFetch<{ events: ForecastEvent[] }>(
      `/api/forecast?kpi=revenue_eur&granularity=${g}&range_start=${encodeURIComponent(earliestIso)}`
    )
      .then((d) => { events = d.events ?? []; })
      .catch(() => { events = []; });
  });

  // Phase 16.3 D-02: pixel slots for EventBadgeStrip — caller-owned band
  // position math. chartW is `number | undefined`; fall back to cardW.
  const stripWidth = $derived(chartW ?? cardW);
  const eventBuckets = $derived.by(() => {
    if (chartData.length === 0 || stripWidth === 0) return [];
    const slotWidth = stripWidth / chartData.length;
    return chartData.map((row, i) => ({
      iso: row.cohort_iso as string,
      left: i * slotWidth,
      width: slotWidth
    }));
  });
</script>

<div
  data-testid="repeater-cohort-count-card"
  class="rounded-xl border border-zinc-200 bg-white p-4"
>
  <div class="flex items-baseline gap-2">
    <h2 class="text-base font-semibold text-zinc-900">
      {t(page.data.locale, 'repeater_cohort_title')}
    </h2>
    {#if showClampHint}
      <span
        data-testid="cohort-clamp-hint"
        class="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
        title={t(page.data.locale, 'clamp_badge_tooltip', { n: SPARSE_MIN_COHORT_SIZE })}
      >{t(page.data.locale, 'clamp_badge_label')}</span>
    {/if}
  </div>
  <p class="mt-1 text-xs text-zinc-500 text-balance">
    {t(page.data.locale, 'repeater_cohort_description')}
  </p>

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
        seriesLayout="stack"
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
            <Bars
              seriesKey={s.key}
              rounded={i !== series.length - 1 ? 'none' : 'edge'}
              radius={4}
              strokeWidth={1}
            />
          {/each}
          {#each chartData as row, i (row.cohort)}
            {#if totals[i] > 0 && chartCtx}
              <Text
                x={bandCenterX(chartCtx.xScale, row.cohort)}
                y={(chartCtx.yScale(totals[i]) ?? 0) - 6}
                value={formatIntShort(totals[i])}
                textAnchor="middle"
                class="pointer-events-none fill-zinc-700 text-[10px] font-medium"
              />
            {/if}
          {/each}
        </Svg>
        <Tooltip.Root contained={false}>
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

      <!-- Phase 16.3 D-02 / D-06: EventBadgeStrip mounts inside scroll wrapper.
           VA-09 visit-sequence card uses cohortGrain (week|month) as both the
           server fetch grain and the strip render grain. Fixed 44px height
           (D-06 prevents card-height jitter on filter changes). -->
      <EventBadgeStrip
        events={events}
        buckets={eventBuckets}
        grain={cohortGrain}
        width={stripWidth}
      />
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
