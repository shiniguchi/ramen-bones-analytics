<script lang="ts">
  // MdeCurveCard — Minimum Detectable Effect line chart.
  //
  // Plots, for n₂ ∈ [1..14] campaign days, the minimum per-day lift (€/day)
  // a campaign must produce to be statistically significant at α=0.05
  // (two-tailed) with 80% power. σ and n₁ are derived live from the filtered
  // daily revenue, so the curve re-draws on every filter change.
  //
  // Below MDE_MIN_BASELINE_DAYS (7) or σ=0 we show EmptyState — the estimate
  // is too noisy to plot. One dashed vertical reference at n₂=7 ("1 week").
  //
  // Self-subscribes to dashboardStore via getFiltered() inside $derived.by —
  // same pattern as KpiTile / CalendarRevenueCard (no prop-drilling).
  import { Chart, Svg, Axis, Spline, Tooltip } from 'layerchart';
  import { scaleLinear } from 'd3-scale';
  import { page } from '$app/state';
  import { t } from '$lib/i18n/messages';
  import { formatEUR, formatEURShort } from '$lib/format';
  import EmptyState from './EmptyState.svelte';
  import { getFiltered } from '$lib/dashboardStore.svelte';
  import {
    dailyRevenuesEUR,
    sampleStd,
    mdeCurvePoints,
    MDE_MIN_BASELINE_DAYS,
    MDE_MAX_CAMPAIGN_DAYS
  } from '$lib/mde';
  import { integerTicks } from '$lib/trendline';

  // σ + n₁ derived from the filtered baseline. Recomputes on every
  // range / sales_type / is_cash / day-of-week change.
  const stats = $derived.by(() => {
    const rev = dailyRevenuesEUR(getFiltered());
    const n1 = rev.length;
    const mean = n1 > 0 ? rev.reduce((s, v) => s + v, 0) / n1 : 0;
    return { n1, sigma: sampleStd(rev), mean };
  });

  // Empty array ⇒ EmptyState (< 7 baseline days or σ=0).
  const curve = $derived.by(() =>
    stats.n1 >= MDE_MIN_BASELINE_DAYS && stats.sigma > 0
      ? mdeCurvePoints(stats.sigma, stats.n1, MDE_MAX_CAMPAIGN_DAYS)
      : []
  );

  // Curve is strictly decreasing, so index 0 is the max.
  const yMax = $derived(curve.length ? curve[0].mde : 0);
</script>

<div data-testid="mde-curve-card" class="rounded-xl border border-zinc-200 bg-white p-4">
  <h2 class="text-base font-semibold text-zinc-900">{t(page.data.locale, 'mde_title')}</h2>
  <p class="mt-1 text-xs text-zinc-500 text-balance">
    {t(page.data.locale, 'mde_description')}
  </p>
  {#if curve.length === 0}
    <EmptyState card="mde-curve" />
  {:else}
    <div class="mt-4 h-64 chart-touch-safe">
      <Chart
        data={curve}
        x="n2"
        y="mde"
        xScale={scaleLinear()}
        xDomain={[1, MDE_MAX_CAMPAIGN_DAYS]}
        yScale={scaleLinear()}
        yDomain={[0, yMax]}
        padding={{ left: 48, right: 12, top: 16, bottom: 28 }}
        tooltipContext={{ mode: 'bisect-x', touchEvents: 'auto' }}
      >
        <Svg>
          <Axis placement="left" format={formatEURShort} grid rule />
          <Axis placement="bottom" ticks={integerTicks(MDE_MAX_CAMPAIGN_DAYS)} rule />
          <!-- Dashed vertical reference at n₂=7 ("1 week") — 2-point Spline. -->
          <Spline
            data={[{ n2: 7, mde: 0 }, { n2: 7, mde: yMax }]}
            x="n2"
            y="mde"
            class="stroke-zinc-400 [stroke-dasharray:4_4]"
          />
          <!-- Main MDE curve. Explicit data+x+y so it doesn't alias the reference
               Spline's single-x dataset via Chart series-state inference. -->
          <Spline data={curve} x="n2" y="mde" class="stroke-zinc-900 stroke-[2]" />
        </Svg>
        <Tooltip.Root>
          {#snippet children({ data: row })}
            <Tooltip.Header>
              {t(page.data.locale, 'mde_tooltip_day', { n2: row.n2 })}
            </Tooltip.Header>
            <Tooltip.Item
              label={t(page.data.locale, 'mde_tooltip_mde')}
              value={formatEUR(row.mde * 100)}
            />
          {/snippet}
        </Tooltip.Root>
      </Chart>
    </div>
    <p class="mt-2 text-xs text-zinc-500">
      {t(page.data.locale, 'mde_caption', {
        n1: stats.n1,
        mu: formatEUR(stats.mean * 100),
        sigma: formatEUR(stats.sigma * 100)
      })}
    </p>
  {/if}
</div>
