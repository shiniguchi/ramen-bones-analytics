<script lang="ts">
  // Feedback #4: GitHub-style daily revenue heatmap.
  // Full history, unfiltered by range/grain — at-a-glance overview.
  // LayerChart's Calendar component renders one <rect> per day, colored by
  // revenue_cents via a sequential blue scale. d3.timeDays builds the grid.
  import { Chart, Svg, Calendar, Tooltip } from 'layerchart';
  import { scaleSequential } from 'd3-scale';
  import { interpolateBlues } from 'd3-scale-chromatic';
  import { format, parseISO } from 'date-fns';
  import { formatEUR } from '$lib/format';

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
        data={dated}
        x="date"
        c="revenue_cents"
        cScale={scaleSequential(interpolateBlues)}
        cDomain={[0, maxRev]}
        padding={{ left: 8, right: 8, top: 24, bottom: 8 }}
        tooltipContext={{ mode: 'manual', touchEvents: 'auto' }}
      >
        <Svg>
          <Calendar {start} {end} cellSize={14} monthLabel tooltip />
        </Svg>
        <Tooltip.Root>
          {#snippet children({ data: cell })}
            <Tooltip.Header>{format(cell.date, 'MMM d, yyyy')}</Tooltip.Header>
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
