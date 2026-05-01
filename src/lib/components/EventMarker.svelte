<script lang="ts">
  // EventMarker — SVG primitive layer for the 5 forecast event types.
  // Phase 15 D-09 / FUI-05.
  //
  // Slotted INSIDE a LayerChart <Svg> by RevenueForecastCard (15-08).
  // The parent passes the chart's xScale + chart-area height as props
  // so this component never reads layerchart's context directly — keeps
  // the component testable without a real <Chart> parent.
  //
  // Visual encoding (locked by FUI-05):
  //   campaign_start   → red          vertical line (3px wide, full height)
  //   holiday          → dashed       green vertical line (1px, full height)
  //   school_holiday   → teal         background rect spanning start→end
  //   recurring_event  → yellow       vertical line (1.5px, full height)
  //   transit_strike   → red bar      4px-tall rect at top of chart for that date
  //
  // Progressive disclosure (≤50) is enforced server-side in /api/forecast
  // via clampEvents() — the events array arriving here is already clamped.

  import type { ForecastEvent } from '$lib/forecastEventClamp';

  let {
    events,
    xScale,
    height
  }: {
    events: readonly ForecastEvent[];
    // Accepts either a YYYY-MM-DD string or a Date — LayerChart band scales
    // and time scales differ, so we let the parent normalize via its own
    // accessor and pass the result back through here as a function.
    xScale: (dateOrStr: string | Date) => number;
    height: number;
  } = $props();

  function x(d: string): number {
    return xScale(d);
  }
</script>

<!-- Layer 1: school_holiday backgrounds (rendered first so other markers sit on top) -->
{#each events as e (e.type + '|' + e.date + '|' + e.label)}
  {#if e.type === 'school_holiday' && e.end_date}
    {@const x0 = x(e.date)}
    {@const x1 = x(e.end_date)}
    <rect
      data-event-type="school_holiday"
      x={Math.min(x0, x1)}
      y={0}
      width={Math.abs(x1 - x0)}
      height={height}
      fill="#5eead4"
      fill-opacity={0.18}
      pointer-events="none"
    >
      <title>{e.label}</title>
    </rect>
  {/if}
{/each}

<!-- Layer 2: full-height vertical lines (campaign_start, holiday, recurring_event) -->
{#each events as e (e.type + '|' + e.date + '|' + e.label)}
  {#if e.type === 'campaign_start'}
    <line
      data-event-type="campaign_start"
      x1={x(e.date)} x2={x(e.date)}
      y1={0} y2={height}
      stroke="#dc2626"
      stroke-width={3}
      pointer-events="none"
    >
      <title>{e.label}</title>
    </line>
  {:else if e.type === 'holiday'}
    <line
      data-event-type="holiday"
      x1={x(e.date)} x2={x(e.date)}
      y1={0} y2={height}
      stroke="#16a34a"
      stroke-width={1}
      stroke-dasharray="3 3"
      pointer-events="none"
    >
      <title>{e.label}</title>
    </line>
  {:else if e.type === 'recurring_event'}
    <line
      data-event-type="recurring_event"
      x1={x(e.date)} x2={x(e.date)}
      y1={0} y2={height}
      stroke="#eab308"
      stroke-width={1.5}
      pointer-events="none"
    >
      <title>{e.label}</title>
    </line>
  {/if}
{/each}

<!-- Layer 3: transit_strike top bars -->
{#each events as e (e.type + '|' + e.date + '|' + e.label)}
  {#if e.type === 'transit_strike'}
    <rect
      data-event-type="transit_strike"
      x={x(e.date) - 4}
      y={0}
      width={8}
      height={4}
      fill="#dc2626"
      pointer-events="none"
    >
      <title>{e.label}</title>
    </rect>
  {/if}
{/each}
