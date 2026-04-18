<script lang="ts">
  // VA-07: LTV per-customer histogram — bars grouped by visit_count bucket (Pass 4 — quick-260418-4oh).
  // Data shape: customer_ltv_v rows (one per card_hash). Bins auto-scale to max revenue up to
  // LTV_BIN_MAX_CENTS_CAP (€250) via buildLtvBins; overflow bin '€250+' appended only if needed.
  // seriesLayout="group" — 8 adjacent bars per bin (1st..8x+). Not stacked — user's locked decision.
  // NO range/filter prop — LTV is lifetime; filter-scoping would be semantically wrong.
  import { BarChart } from 'layerchart';
  import EmptyState from './EmptyState.svelte';
  import { buildLtvBins, binCustomerRevenue } from '$lib/ltvBins';
  import { visitCountBucket, VISIT_BUCKET_KEYS, type CustomerLtvRow } from '$lib/cohortAgg';
  import { VISIT_SEQ_COLORS } from '$lib/chartPalettes';
  import { computeChartWidth, MAX_X_TICKS } from '$lib/dashboardStore.svelte';
  import { formatIntShort } from '$lib/format';

  let { data }: { data: CustomerLtvRow[] } = $props();

  // Bins adapt to the largest customer revenue in the current dataset.
  const bins = $derived(
    buildLtvBins(data.length === 0 ? 0 : Math.max(...data.map((r) => r.revenue_cents)))
  );

  // Seed every (bin × bucket) cell at 0 so empty cells render as zero-height bars
  // (preserves x-axis label order + keeps the group layout stable).
  const chartData = $derived.by(() => {
    const counts = new Map<string, Record<(typeof VISIT_BUCKET_KEYS)[number], number>>();
    for (const b of bins) {
      const row = {} as Record<(typeof VISIT_BUCKET_KEYS)[number], number>;
      for (const k of VISIT_BUCKET_KEYS) row[k] = 0;
      counts.set(b.label, row);
    }
    for (const row of data) {
      const label = binCustomerRevenue(row.revenue_cents, bins);
      const bucket = visitCountBucket(row.visit_count);
      counts.get(label)![bucket] += 1;
    }
    return bins.map((b) => ({ bin: b.label, ...counts.get(b.label)! }));
  });

  // One BarChart series per visit bucket — colors mirror the VISIT_SEQ_COLORS gradient
  // used by VA-04/VA-05 so the "light = new, dark = loyal" metaphor is consistent.
  const series = VISIT_BUCKET_KEYS.map((k, i) => ({
    key: k,
    label: k,
    color: VISIT_SEQ_COLORS[i]
  }));

  let cardW = $state(0);
  const chartW = $derived(computeChartWidth(chartData.length, cardW));
</script>

<div data-testid="ltv-histogram-card" class="rounded-xl border border-zinc-200 bg-white p-4">
  <h2 class="text-base font-semibold text-zinc-900">
    Customer count by lifetime revenue bucket — by visit count
  </h2>
  <p class="mt-1 text-xs text-zinc-500">Customers per lifetime revenue bucket, grouped by visit count.</p>

  <!-- 8-bucket inline gradient legend (matches VISIT_SEQ_COLORS gradient). -->
  <div class="mt-2 flex items-center gap-3 text-xs text-zinc-600">
    <span>1st</span>
    <div class="flex h-2 flex-1 overflow-hidden rounded" data-testid="visit-bucket-gradient">
      {#each VISIT_SEQ_COLORS as color}
        <div class="flex-1" style:background-color={color}></div>
      {/each}
    </div>
    <span>8x+</span>
  </div>

  {#if data.length === 0}
    <EmptyState card="ltv-histogram" />
  {:else}
    <div
      bind:clientWidth={cardW}
      class="mt-4 h-64 overflow-x-auto touch-auto overscroll-x-contain chart-touch-safe"
    >
      <BarChart
        data={chartData}
        x="bin"
        {series}
        seriesLayout="group"
        orientation="vertical"
        bandPadding={0.2}
        width={chartW}
        padding={{ left: 40, right: 8, top: 8, bottom: 24 }}
        props={{ xAxis: { ticks: MAX_X_TICKS }, yAxis: { format: formatIntShort } }}
        tooltipContext={{ touchEvents: 'auto' }}
      />
    </div>
  {/if}
</div>
