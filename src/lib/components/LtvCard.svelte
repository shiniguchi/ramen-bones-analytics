<script lang="ts">
  // LtvCard — LTV-to-date bar chart with persistent italic caveat (D-16, D-17).
  // Shows last 4 cohorts as LayerChart Bars. NO range prop — chip-independent (D-04).
  import { Chart, Svg, Axis, Bars } from 'layerchart';
  import { scaleBand, scaleLinear } from 'd3-scale';
  import EmptyState from './EmptyState.svelte';

  type LtvRow = {
    cohort_week: string;
    period_weeks: number;
    ltv_cents: number;
    cohort_size_week: number;
    cohort_age_weeks: number;
  };

  // No `range` prop — LTV is chip-independent (Pitfall 6).
  let { data, monthsOfHistory }: { data: LtvRow[]; monthsOfHistory: number } = $props();

  // Take the max ltv_cents per cohort (last observed period) for the bar chart.
  const shaped = $derived.by(() => {
    const byWeek = new Map<string, number>();
    for (const r of data) {
      if (r.ltv_cents !== null && r.ltv_cents > (byWeek.get(r.cohort_week) ?? -Infinity)) {
        byWeek.set(r.cohort_week, r.ltv_cents);
      }
    }
    return Array.from(byWeek.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-4)
      .map(([cohort_week, ltv_cents]) => ({
        cohort_week,
        ltv_eur: ltv_cents / 100
      }));
  });

  // Persistent italic caveat (D-17) — always visible, even when data is empty.
  const caveat = $derived(
    monthsOfHistory < 1
      ? 'Based on less than a month of history — long-term LTV not yet observable.'
      : `Based on ${monthsOfHistory} months of history — long-term LTV not yet observable.`
  );
</script>

<div data-testid="ltv-card" class="rounded-xl border border-zinc-200 bg-white p-4">
  <h2 class="text-base font-semibold text-zinc-900">LTV-to-date</h2>

  {#if shaped.length === 0}
    <EmptyState card="ltv" />
  {:else}
    <div class="mt-4 h-48">
      <!-- layerchart 2.x: xScale/yScale must be D3 scale functions (string presets removed) -->
      <Chart
        data={shaped}
        x="cohort_week"
        y="ltv_eur"
        xScale={scaleBand().padding(0.2)}
        yScale={scaleLinear()}
        padding={{ left: 40, bottom: 28, top: 8, right: 8 }}
      >
        <Svg>
          <Axis placement="left" format={(v: number) => `€${v}`} grid />
          <Axis placement="bottom" />
          <Bars class="fill-blue-600 fill-opacity-85" />
        </Svg>
      </Chart>
    </div>
  {/if}

  <!-- Persistent italic caveat — ALWAYS outside the {#if} block (D-17) -->
  <p class="mt-2 text-xs italic text-zinc-500">{caveat}</p>
</div>
