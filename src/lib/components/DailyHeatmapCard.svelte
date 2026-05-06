<script lang="ts">
  // Feedback #4: GitHub-style daily revenue heatmap.
  // Full history, unfiltered by range/grain — at-a-glance overview.
  // LayerChart's Calendar component renders one <rect> per day, colored by
  // revenue_cents via a sequential blue scale. d3.timeDays builds the grid.
  import { Chart, Svg, Calendar, Rect, Tooltip } from 'layerchart';
  import { scaleSequential } from 'd3-scale';
  import { interpolateBlues } from 'd3-scale-chromatic';
  import { format, parseISO } from 'date-fns';
  import { page } from '$app/state';
  import { t, type MessageKey } from '$lib/i18n/messages';
  import { formatEUR } from '$lib/format';
  import { getFilters } from '$lib/dashboardStore.svelte';

  // Shift JS getDay() (0=Sun..6=Sat) to Mon-first (0=Mon..6=Sun) for the y-axis row.
  const mondayFirstRow = (d: Date) => (d.getDay() + 6) % 7;

  // quick-260420-wdf: dim cells for days NOT in the active day-of-week filter.
  // Store DOW convention is 1=Mon..7=Sun (see filters.ts), so map (row+1).
  const activeDays = $derived(getFilters().days);
  const excluded = $derived(
    new Set([1, 2, 3, 4, 5, 6, 7].filter((d) => !activeDays.includes(d)))
  );

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
  const CELL_PX = 14;
  const MONTH_LABEL_PAD_PX = 24; // must match Chart padding.top below

  // Day-of-week row labels aligned to Monday-first order. Localized via t().
  const DAY_KEYS: MessageKey[] = [
    'day_mon', 'day_tue', 'day_wed', 'day_thu', 'day_fri', 'day_sat', 'day_sun'
  ];
  const DAY_LABELS = $derived(DAY_KEYS.map((k) => t(page.data.locale, k)));

  // CSS gradient string sampled from interpolateBlues at 10 stops — used as the
  // colorbar legend fill. Matches the sequential scale used for cell color.
  const BLUE_GRADIENT = Array.from({ length: 10 }, (_, i) => interpolateBlues(i / 9)).join(', ');

  // Explicit chart width = (weeks + 1) × cellSize + horizontal padding. Without
  // this <Chart> auto-fits to the scroll wrapper and no horizontal scroll
  // activates even when history > ~25 weeks wide (G1 regression fix).
  const chartW = $derived.by(() => {
    const weeks = Math.ceil((end.getTime() - start.getTime()) / (7 * 86400 * 1000));
    return (weeks + 2) * CELL_PX + 16;
  });

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
  <h2 class="text-base font-semibold text-zinc-900">{t(page.data.locale, 'heatmap_title')}</h2>
  <p class="mt-1 text-xs text-zinc-500 text-balance">
    {t(page.data.locale, 'heatmap_description')}
  </p>

  {#if dated.length === 0}
    <p class="mt-4 pt-6 text-center text-sm text-zinc-500">{t(page.data.locale, 'heatmap_empty')}</p>
  {:else}
  <!-- Horizontal-scroll wrapper: Calendar lays out weeks left-to-right and can
       exceed viewport width when history extends beyond ~52 weeks. Day labels
       sit in a fixed left column OUTSIDE the scroll so they stay visible. -->
  <div class="mt-4 flex gap-2" style:height="{HEIGHT_PX}px">
    <!-- Fixed day-of-week label column. padding-top matches Chart padding.top
         so label row 0 aligns with cell row 0. -->
    <div
      data-testid="daily-heatmap-daylabels"
      class="flex flex-col"
      style:padding-top="{MONTH_LABEL_PAD_PX}px"
    >
      {#each DAY_LABELS as label}
        <span
          class="flex items-center text-[10px] leading-none text-zinc-500"
          style:height="{CELL_PX}px"
        >{label}</span>
      {/each}
    </div>
    <div class="flex-1 overflow-x-auto chart-touch-safe" style:height="{HEIGHT_PX}px">
      <Chart
        bind:context={chartCtx}
        data={dated}
        x="date"
        c="revenue_cents"
        cScale={scaleSequential(interpolateBlues)}
        cDomain={[0, maxRev]}
        width={chartW}
        padding={{ left: 8, right: 8, top: 24, bottom: 8 }}
        tooltipContext={{ mode: 'manual', touchEvents: 'auto' }}
      >
        <Svg>
          <Calendar {start} {end} cellSize={CELL_PX} monthLabel tooltip>
            {#snippet children({ cells, cellSize })}
              {#each cells as cell}
                {@const hasData = cell.data?.revenue_cents != null && cell.data.revenue_cents > 0}
                {@const dow = mondayFirstRow(cell.data.date) + 1}
                {@const isExcluded = excluded.has(dow)}
                <!-- LayerChart's Calendar uses d3-time's timeWeek (Sunday-start) for
                     cell.x, so Sundays share the column of the FOLLOWING Mon-Sat.
                     We render Monday-first — Sunday must visually end the week —
                     so shift Sunday cells one column left. Clamp at 0 for the
                     degenerate case where the very first day in `start` is a Sunday. -->
                {@const isSunday = cell.data.date.getDay() === 0}
                {@const shiftedX = isSunday ? Math.max(0, cell.x - cellSize[0]) : cell.x}
                <Rect
                  x={shiftedX}
                  y={mondayFirstRow(cell.data.date) * cellSize[1]}
                  width={cellSize[0]}
                  height={cellSize[1]}
                  fill={hasData ? cell.color : '#ffffff'}
                  opacity={isExcluded ? 0.2 : 1}
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
        <Tooltip.Root contained={false}>
          {#snippet children({ data: cell })}
            <Tooltip.Header>{format(cell.date, 'EEE, MMM d, yyyy')}</Tooltip.Header>
            <Tooltip.List>
              <Tooltip.Item label={t(page.data.locale, 'tooltip_revenue')} value={formatEUR(cell.revenue_cents ?? 0)} />
              {#if cell.tx_count}
                <Tooltip.Item label={t(page.data.locale, 'tooltip_transactions')} value={`${cell.tx_count} ${t(page.data.locale, 'txn_suffix')}`} />
              {/if}
            </Tooltip.List>
          {/snippet}
        </Tooltip.Root>
      </Chart>
    </div>
  </div>

  <!-- Blue-scale colorbar legend: €0 → max revenue. Gradient sampled from
       interpolateBlues at 10 stops to match the sequential cell fill. -->
  <div class="mt-3 flex items-center gap-3 text-xs text-zinc-600">
    <span>€0</span>
    <div
      class="h-2 flex-1 rounded"
      data-testid="daily-heatmap-gradient"
      style:background="linear-gradient(to right, {BLUE_GRADIENT})"
    ></div>
    <span>{formatEUR(maxRev)}</span>
  </div>
  {/if}
</div>
