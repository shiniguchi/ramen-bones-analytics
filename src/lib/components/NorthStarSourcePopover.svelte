<script lang="ts">
  // NorthStarSourcePopover — bottom sheet showing full source attribution for
  // one benchmark anchor period. Opens on anchor-dot tap in CohortRetentionCard.
  // Uses ui/sheet.svelte primitive (backdrop + scroll lock + Escape close).
  // quick-260418-bm4

  import Sheet from '$lib/components/ui/sheet.svelte';

  type Credibility = 'HIGH' | 'MEDIUM' | 'LOW';

  export type BenchmarkSourceRow = {
    period_weeks: number;
    id: number;
    label: string;
    country: string;
    segment: string;
    credibility: Credibility;
    cuisine_match: number;
    metric_type: string;
    conversion_note: string | null;
    sample_size: string | null;
    year: number;
    url: string | null;
    raw_value: number;
    normalized_value: number;
  };

  let {
    open = $bindable(false),
    period,        // in weeks (0, 4, 12, 26, 52) — the anchor's native unit
    grainLabel,    // 'Week 12 (Month 3)' style label for the title
    anchor,        // { lower_p20, mid_p50, upper_p80, source_count } or null
    sources        // rows from benchmark_sources_v filtered to this period
  }: {
    open?: boolean;
    period: number;
    grainLabel: string;
    anchor: { lower_p20: number; mid_p50: number; upper_p80: number; source_count: number } | null;
    sources: BenchmarkSourceRow[];
  } = $props();

  const credibilityBadge = (c: Credibility) =>
    c === 'HIGH'   ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' :
    c === 'MEDIUM' ? 'bg-amber-50 text-amber-700 ring-amber-200' :
                     'bg-zinc-100 text-zinc-600 ring-zinc-200';
</script>

<Sheet bind:open title={`North-star benchmark · ${grainLabel}`}>
  {#if anchor}
    <!-- Headline numbers -->
    <div class="mb-4 rounded-lg bg-amber-50 p-3">
      <div class="flex items-baseline gap-3">
        <div>
          <div class="text-[10px] uppercase tracking-wide text-zinc-500">Mid (P50)</div>
          <div class="text-2xl font-semibold text-amber-700">{Math.round(anchor.mid_p50)}%</div>
        </div>
        <div>
          <div class="text-[10px] uppercase tracking-wide text-zinc-500">Range (P20–P80)</div>
          <div class="text-sm text-amber-700">
            {Math.round(anchor.lower_p20)}%–{Math.round(anchor.upper_p80)}%
          </div>
        </div>
      </div>
      <p class="mt-2 text-xs text-zinc-500">
        Weighted across {anchor.source_count} {anchor.source_count === 1 ? 'source' : 'sources'} curated for your restaurant.
      </p>
    </div>

    <!-- Source list -->
    <h3 class="mb-2 text-sm font-semibold text-zinc-800">Contributing sources</h3>
    <ul class="flex flex-col gap-3">
      {#each sources as s (s.id)}
        <li class="rounded-lg border border-zinc-200 p-3">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-medium text-zinc-900">{s.label}</span>
            <span class="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 ring-1 ring-inset ring-zinc-200">{s.country}</span>
            <span class="rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset {credibilityBadge(s.credibility)}">{s.credibility}</span>
            <span class="text-[11px] text-zinc-500">{s.year}</span>
          </div>
          <p class="mt-1 text-xs text-zinc-600">{s.segment}</p>

          <div class="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
            <span class="text-zinc-500">Raw:
              <span class="font-medium text-zinc-800">{s.raw_value}%</span>
            </span>
            <span class="text-zinc-500">Normalized:
              <span class="font-medium text-zinc-800">{s.normalized_value}%</span>
            </span>
            <span class="text-zinc-500">Type: <span class="font-mono text-zinc-700">{s.metric_type}</span></span>
            <span class="text-zinc-500">Cuisine match: <span class="font-medium text-zinc-700">{s.cuisine_match}×</span></span>
          </div>

          {#if s.conversion_note}
            <p class="mt-1 text-[11px] italic text-zinc-500">{s.conversion_note}</p>
          {/if}
          {#if s.sample_size}
            <p class="mt-1 text-[11px] text-zinc-500">Sample: {s.sample_size}</p>
          {/if}
          {#if s.url}
            <a href={s.url} target="_blank" rel="noopener noreferrer"
               class="mt-1 inline-block text-[11px] text-blue-600 underline hover:text-blue-700">
              View source ↗
            </a>
          {/if}
        </li>
      {/each}
    </ul>

    <!-- Weighting rule footer -->
    <div class="mt-4 border-t border-zinc-100 pt-3">
      <p class="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Weighting rule</p>
      <p class="mt-1 text-xs leading-relaxed text-zinc-600">
        weight = credibility (HIGH×3, MED×2, LOW×1) × cuisine_match (noodle×1.5, QSR×1.2, casual×1.0, buffet×0.8) × metric_type (direct×1.0, converted×0.7).
      </p>
      <p class="mt-2 text-xs leading-relaxed text-zinc-600">
        Mid, lower, and upper are weighted P50/P20/P80 quantiles computed in SQL (benchmark_curve_v).
      </p>
    </div>
  {:else}
    <p class="text-sm text-zinc-500">No benchmark data for this period.</p>
  {/if}
</Sheet>
