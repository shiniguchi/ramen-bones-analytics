<script lang="ts">
  // VA-07: LTV per-customer histogram with dynamic €5 bins and repeater stack (Pass 3 — quick-260418-3ec).
  // Data shape: customer_ltv_v rows (one per card_hash). Bins auto-scale to max revenue up to
  // LTV_BIN_MAX_CENTS_CAP (€250), with an overflow bin '€250+' appended only when data exceeds cap.
  // NO range/filter prop — LTV is lifetime; filter-scoping would be semantically wrong.
  import { BarChart } from 'layerchart';
  import EmptyState from './EmptyState.svelte';
  import { buildLtvBins, binCustomerRevenue } from '$lib/ltvBins';
  import { classifyRepeater, type CustomerLtvRow } from '$lib/cohortAgg';
  import { REPEATER_COLORS } from '$lib/chartPalettes';
  import { computeChartWidth, MAX_X_TICKS } from '$lib/dashboardStore.svelte';
  import { formatIntShort } from '$lib/format';

  let { data }: { data: CustomerLtvRow[] } = $props();

  // Bins adapt to the largest customer revenue in the current dataset.
  const bins = $derived(
    buildLtvBins(data.length === 0 ? 0 : Math.max(...data.map((r) => r.revenue_cents)))
  );

  // Seed every bin so empty bins render at height=0 (preserves x-axis label order).
  const chartData = $derived.by(() => {
    const counts = new Map<string, { new: number; repeat: number }>();
    for (const b of bins) counts.set(b.label, { new: 0, repeat: 0 });
    for (const row of data) {
      const label = binCustomerRevenue(row.revenue_cents, bins);
      const bucket = counts.get(label)!;
      if (classifyRepeater(row.visit_count) === 'new') bucket.new += 1;
      else bucket.repeat += 1;
    }
    return bins.map((b) => ({
      bin: b.label,
      new: counts.get(b.label)!.new,
      repeat: counts.get(b.label)!.repeat
    }));
  });

  let cardW = $state(0);
  const chartW = $derived(computeChartWidth(chartData.length, cardW));
</script>

<div data-testid="ltv-histogram-card" class="rounded-xl border border-zinc-200 bg-white p-4">
  <h2 class="text-base font-semibold text-zinc-900">
    Customer count by lifetime revenue bucket — new vs. repeat
  </h2>
  <p class="mt-1 text-xs text-zinc-500">Customers per lifetime revenue bucket.</p>

  <!-- Inline legend (≤30 lines per plan constraint — LayerChart legend emission is not guaranteed). -->
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

  {#if data.length === 0}
    <EmptyState card="ltv-histogram" />
  {:else}
    <div
      bind:clientWidth={cardW}
      class="mt-4 h-64 overflow-x-auto touch-pan-x overscroll-x-contain"
    >
      <BarChart
        data={chartData}
        x="bin"
        series={[
          { key: 'new', label: 'New', color: REPEATER_COLORS.new },
          { key: 'repeat', label: 'Repeat', color: REPEATER_COLORS.repeat }
        ]}
        seriesLayout="stack"
        orientation="vertical"
        bandPadding={0.2}
        width={chartW}
        props={{ xAxis: { ticks: MAX_X_TICKS }, yAxis: { format: formatIntShort } }}
        tooltipContext={{ touchEvents: 'pan-x' }}
      />
    </div>
  {/if}
</div>
