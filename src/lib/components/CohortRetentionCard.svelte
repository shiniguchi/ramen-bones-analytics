<script lang="ts">
  // CohortRetentionCard — cohort retention curves via LayerChart Spline (D-11..D-15).
  // Props: data only (from retention_curve_v).
  // NO range prop — this card is chip-independent (D-04 / Pitfall 6).
  // Phase 9: GrainToggle moved to FilterBar (D-14).
  import { Chart, Svg, Axis, Spline, Highlight, Tooltip } from 'layerchart';
  import { scaleLinear } from 'd3-scale';
  import EmptyState from './EmptyState.svelte';
  import { pickVisibleCohorts, type RetentionRow } from '$lib/sparseFilter';
  import { getFilters } from '$lib/dashboardStore.svelte';

  let { data }: { data: RetentionRow[] } = $props();

  // D-17: cohort-semantic charts show the weekly-clamp hint when global grain=day
  // (VA-06 UX parity with VA-09/VA-10 per B2 fix). grain=month passes through
  // without a hint — users can explicitly switch to week to match the retention
  // chart's intrinsic weekly resolution if they want.
  const showClampHint = $derived(getFilters().grain === 'day');

  // Chart palette for ≤4 cohort lines (375px legible).
  const palette = ['#2563eb', '#0891b2', '#7c3aed', '#db2777'];

  // Derive visible cohorts: sparse-filter + last-4 slice.
  const visibleRows = $derived(pickVisibleCohorts(data));

  // Was the sparse fallback triggered? If all original non-empty cohorts are sparse.
  const allSparse = $derived.by(() => {
    if (data.length === 0) return false;
    const sizes = new Map<string, number>();
    for (const r of data) {
      const cur = sizes.get(r.cohort_week) ?? 0;
      if (r.cohort_size_week > cur) sizes.set(r.cohort_week, r.cohort_size_week);
    }
    return Array.from(sizes.values()).every(s => s < 5);
  });

  // Build per-cohort series from visible rows.
  const series = $derived.by(() => {
    const byCohort = new Map<string, RetentionRow[]>();
    for (const r of visibleRows) {
      if (!byCohort.has(r.cohort_week)) byCohort.set(r.cohort_week, []);
      byCohort.get(r.cohort_week)!.push(r);
    }
    return Array.from(byCohort.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cohort, rows], i) => ({ cohort, rows, color: palette[i % palette.length] }));
  });
</script>

<div data-testid="cohort-card" class="rounded-xl border border-zinc-200 bg-white p-4">
  <!-- Card header -->
  <div class="flex items-center justify-between gap-2">
    <h2 class="text-base font-semibold text-zinc-900">Cohort retention</h2>
  </div>

  {#if showClampHint}
    <!-- D-17: cohort weekly-clamp hint — matches VA-09/VA-10 UX parity. -->
    <p
      data-testid="cohort-clamp-hint"
      class="mt-2 text-xs text-amber-600"
    >
      Cohort view shows weekly — other grains not applicable.
    </p>
  {/if}

  {#if allSparse && series.length > 0}
    <!-- Sparse hint: shown when all visible cohorts are below SPARSE_MIN_COHORT_SIZE (D-14) -->
    <p
      data-testid="sparse-hint"
      class="mt-2 text-xs text-amber-600"
    >
      Cohort sizes are small — retention lines may swing a lot. Give it a few more weeks of data.
    </p>
  {/if}

  {#if series.length === 0}
    <EmptyState card="cohort" />
  {:else}
    <div class="mt-4 h-64">
      <!-- layerchart 2.x: explicit D3 scales (string presets removed in 2.x) -->
      <Chart
        data={series.flatMap((s, i) => s.rows.map(r => ({ ...r, cohortLabel: s.cohort, color: palette[i % palette.length] })))}
        x="period_weeks"
        y="retention_rate"
        xScale={scaleLinear()}
        yScale={scaleLinear()}
        yDomain={[0, 1]}
        padding={{ left: 32, bottom: 24, top: 8, right: 8 }}
      >
        <Svg>
          <Axis placement="left" format={(v: number) => `${Math.round(v * 100)}%`} grid />
          <Axis placement="bottom" label="Weeks since first visit" />
          {#each series as s, i}
            <Spline
              data={s.rows}
              x="period_weeks"
              y="retention_rate"
              class="stroke-2"
              stroke={palette[i % palette.length]}
            />
          {/each}
          <Highlight points lines />
          <Tooltip.Root let:data>
            <Tooltip.Header>{data?.cohort_week} · Week {data?.period_weeks}</Tooltip.Header>
            <Tooltip.List>
              <Tooltip.Item label="Retention" value={`${Math.round((data?.retention_rate ?? 0) * 100)}%`} />
              <Tooltip.Item label="Cohort size" value={`${data?.cohort_size_week ?? 0} customers`} />
            </Tooltip.List>
          </Tooltip.Root>
        </Svg>
      </Chart>
    </div>
  {/if}
</div>
