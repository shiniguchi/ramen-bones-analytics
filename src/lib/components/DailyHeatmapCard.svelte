<script lang="ts">
  // Feedback #4: GitHub-style daily revenue heatmap.
  // Full history, unfiltered by range/grain — at-a-glance overview.
  // LayerChart's Calendar component renders one <rect> per day, colored by
  // revenue_cents via a sequential blue scale. d3.timeDays builds the grid.
  import { Chart, Svg, Calendar, Rect, Tooltip } from 'layerchart';
  import { scaleSequential } from 'd3-scale';
  import { interpolateBlues } from 'd3-scale-chromatic';
  import { format, parseISO } from 'date-fns';
  import { formatEUR } from '$lib/format';

  // Shift JS getDay() (0=Sun..6=Sat) to Mon-first (0=Mon..6=Sun) for the y-axis row.
  const mondayFirstRow = (d: Date) => (d.getDay() + 6) % 7;

  type DailyKpiRow = { business_date: string; revenue_cents: number | string; tx_count: number };
  let { data }: { data: DailyKpiRow[] } = $props();

  // Supabase returns numeric as string — coerce defensively. parseISO converts
  // 'YYYY-MM-DD' into a Date object for Calendar's timeDays/index() lookups.
  const dated = $derived(
    data
      .map((r) => ({
        ...r,
        date: parseISO(r.business_date),
        revenue_cents: Number(r.revenue_cents) || 0
      }))
      .sort((a, b) => a.date.getTime() - b.date.getTime())
  );

  const start = $derived(dated.length > 0 ? dated[0].date : new Date());
  const end = $derived(new Date());
  const maxRev = $derived(
    dated.length > 0 ? Math.max(...dated.map((r) => r.revenue_cents)) : 1
  );

  // Vertical space: 7 day-of-week rows × ~14px cells + month labels + padding.
  // 180px is enough for a 2-year window without clipping on mobile.
  const HEIGHT_PX = 180;

  // Bound from <Chart bind:context> so the custom children snippet can trigger
  // tooltip show/hide manually (overriding Calendar's default rendering loses
  // its built-in pointer wiring). Typed as any — LayerChart's ChartState has
  // 120+ fields and all we need is ctx.tooltip.show/hide.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let chartCtx = $state<any>();
</script>

<div
  data-testid="daily-heatmap-card"
  class="rounded-xl border border-zinc-200 bg-white p-4"
>
  <h2 class="text-base font-semibold text-zinc-900">Daily revenue heatmap</h2>
  <p class="mt-1 text-xs text-zinc-500">
    Each square is one day — darker = more revenue. Shows full history, always
    unfiltered.
  </p>

  <!-- Horizontal-scroll wrapper: Calendar lays out weeks left-to-right and can
       exceed viewport width when history extends beyond ~52 weeks. -->
  <div class="mt-4 overflow-x-auto chart-touch-safe" style:height="{HEIGHT_PX}px">
    {#if dated.length === 0}
      <p class="pt-6 text-center text-sm text-zinc-500">No daily data yet.</p>
    {:else}
      <Chart
        bind:context={chartCtx}
        data={dated}
        x="date"
        c="revenue_cents"
        cScale={scaleSequential(interpolateBlues)}
        cDomain={[0, maxRev]}
        padding={{ left: 8, right: 8, top: 24, bottom: 8 }}
        tooltipContext={{ mode: 'manual', touchEvents: 'auto' }}
      >
        <Svg>
          <Calendar {start} {end} cellSize={14} monthLabel tooltip>
            {#snippet children({ cells, cellSize })}
              {#each cells as cell}
                {@const hasData = cell.data?.revenue_cents != null && cell.data.revenue_cents > 0}
                <Rect
                  x={cell.x}
                  y={mondayFirstRow(cell.data.date) * cellSize[1]}
                  width={cellSize[0]}
                  height={cellSize[1]}
                  fill={hasData ? cell.color : '#ffffff'}
                  stroke="#f1f5f9"
                  strokeWidth={1}
                  class="lc-calendar-cell"
                  onpointermove={(e) => chartCtx?.tooltip?.show(e, cell.data)}
                  onpointerleave={() => chartCtx?.tooltip?.hide()}
                />
              {/each}
            {/snippet}
          </Calendar>
        </Svg>
        <Tooltip.Root>
          {#snippet children({ data: cell })}
            <Tooltip.Header>{format(cell.date, 'EEE, MMM d, yyyy')}</Tooltip.Header>
            <Tooltip.List>
              <Tooltip.Item label="Revenue" value={formatEUR(cell.revenue_cents ?? 0)} />
              {#if cell.tx_count}
                <Tooltip.Item label="Transactions" value={`${cell.tx_count} txn`} />
              {/if}
            </Tooltip.List>
          {/snippet}
        </Tooltip.Root>
      </Chart>
    {/if}
  </div>
</div>
