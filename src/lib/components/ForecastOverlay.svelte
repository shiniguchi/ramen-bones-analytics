<script lang="ts">
  // Shared SVG overlay layer for the calendar bar charts. Renders the
  // forecast lines, CI bands, and hover affordance. Used inside a LayerChart
  // <Svg> block AFTER <Bars> so the lines sit on top of the bars.
  //
  // 2026-05-05 polish refactor: extracted from CalendarCountsCard /
  // CalendarRevenueCard which both contained an identical copy of this
  // markup (only KPI/formatters differed elsewhere).
  import { Spline, Area } from 'layerchart';
  import { parseISO } from 'date-fns';
  import { FORECAST_MODEL_COLORS } from '$lib/chartPalettes';
  import type { ForecastRow } from '$lib/forecastOverlay.svelte';

  type Props = {
    seriesByModel: ReadonlyMap<string, readonly ForecastRow[]>;
    bucketCenter: (d: Date) => Date;
    hoveredBucketIso: string | null;
    /** LayerChart context — exposes xScale, yScale, yRange. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    chartCtx: any;
  };
  let { seriesByModel, bucketCenter, hoveredBucketIso, chartCtx }: Props = $props();

  // Naive (DoW) gets a thinner stroke so it stays visually subordinate to
  // the model lines (it's a baseline reference, not a competitor).
  const NAIVE_KEY = 'naive_dow';
</script>

<!-- CI bands (back layer) — one Area per visible model, low fill opacity so
     the bars stay legible behind them. -->
{#each Array.from(seriesByModel.entries()) as [modelName, modelRows] (`band-${modelName}`)}
  <Area
    data={modelRows.map((r) => { const d = parseISO(r.target_date); return { ...r, d, bucket_d: d }; })}
    x={(r: { d: Date }) => bucketCenter(r.d)}
    y0={(r: { yhat_lower: number }) => r.yhat_lower}
    y1={(r: { yhat_upper: number }) => r.yhat_upper}
    fill={FORECAST_MODEL_COLORS[modelName]}
    fillOpacity={0.06}
  />
{/each}

<!-- Forecast lines — single Spline per model spanning all rows (past +
     future unified, dashed for both since they're forecasts). -->
{#each Array.from(seriesByModel.entries()) as [modelName, modelRows] (`line-${modelName}`)}
  {@const isNaive = modelName === NAIVE_KEY}
  {#if modelRows.length > 0}
    <Spline
      data={modelRows.map((r) => { const d = parseISO(r.target_date); return { ...r, d, bucket_d: d }; })}
      x={(r: { d: Date }) => bucketCenter(r.d)}
      y={(r: { yhat_mean: number }) => r.yhat_mean}
      stroke={FORECAST_MODEL_COLORS[modelName]}
      strokeWidth={isNaive ? 1 : 2}
      strokeOpacity={0.8}
      stroke-dasharray="4 4"
    />
  {/if}
{/each}

<!-- Hover affordance — vertical guide line at the hovered bucket + a colored
     dot on each visible forecast line at that bucket's mean value. Reads
     hoveredBucketIso reactively from the parent's chart-context tooltip state. -->
{#if hoveredBucketIso && chartCtx?.xScale && chartCtx?.yScale}
  {@const hoveredD = parseISO(hoveredBucketIso)}
  {@const cx = chartCtx.xScale(bucketCenter(hoveredD))}
  {@const yLo = Math.min(...(chartCtx.yRange ?? [0, 0]))}
  {@const yHi = Math.max(...(chartCtx.yRange ?? [0, 0]))}
  <line
    x1={cx}
    x2={cx}
    y1={yLo}
    y2={yHi}
    stroke="rgb(113 113 122 / 0.4)"
    stroke-width="1"
    stroke-dasharray="2 2"
    class="pointer-events-none"
  />
  {#each Array.from(seriesByModel.entries()) as [modelName, modelRows] (`hover-${modelName}`)}
    {@const fr = modelRows.find((x) => x.target_date === hoveredBucketIso)}
    {#if fr}
      <circle
        {cx}
        cy={chartCtx.yScale(fr.yhat_mean)}
        r="4"
        fill={FORECAST_MODEL_COLORS[modelName]}
        stroke="white"
        stroke-width="1.5"
        class="pointer-events-none"
      />
    {/if}
  {/each}
{/if}
