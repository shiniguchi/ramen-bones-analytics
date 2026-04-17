# Phase 10: Charts - Research

**Researched:** 2026-04-17
**Domain:** Mobile-first stacked-bar / histogram / cohort-group charts on LayerChart 2.x (Svelte 5) + two new Supabase MVs (customer_ltv_mv, item_counts_daily_mv)
**Confidence:** HIGH (LayerChart API verified against installed source; SQL shapes verified against existing migrations)

## Summary

LayerChart 2.0.0-next.54 (already pinned in `package.json`, Svelte 5 native line) ships a first-class `BarChart` wrapper with `series` definitions, `seriesLayout='stack'`, `orientation` switch, and `stackPadding` — verified directly in `node_modules/layerchart/dist/components/charts/BarChart.svelte`. The planner does NOT need to hand-roll stacked bars via `Rect`; the high-level `BarChart` is the right primitive for VA-04 / VA-05 / VA-08 and also VA-07 (histogram) and VA-09 / VA-10 (cohort bar charts). `d3-scale-chromatic` and `d3-interpolate` are both already installed transitively via LayerChart — no new dependency adds needed. `schemeTableau10` gives the 8-color categorical palette for items; `interpolateBlues` gives the 8-shade sequential gradient for visit-count buckets.

Two new MVs — `customer_ltv_mv` (per-customer lifetime revenue + visit_count + cohort assignments) and `item_counts_daily_mv` (per-day × item_name × sales_type × is_cash item counts) — are the data-layer work. Both follow the canonical `cohort_mv` template (unique index → REVOKE ALL → wrapper view → JWT filter → GRANT → test_* helper). `customer_ltv_v` is designed to feed **three** charts (VA-07 histogram via client-side binning, VA-09 via client GROUP BY cohort_week SUM, VA-10 via client GROUP BY cohort_week AVG) — this re-use is the plan's elegance hinge. `transactions_filterable_v` gains `visit_seq` + `card_hash` via a simple view extension (Phase 9 already joined `visit_attribution_mv` for `is_cash` — adding two columns to the same join is one column change, not a new join).

**Primary recommendation:** Use LayerChart's high-level `<BarChart data={…} x='bucket' series={seriesDefs} seriesLayout='stack' orientation='vertical'/>` for all 7 charts. Compute palettes with `interpolateBlues` for VA-04/05 and `schemeTableau10` for VA-08 in `src/lib/chartPalettes.ts`. Extend `dashboardStore.svelte.ts` with `DailyRow.visit_seq` + `card_hash` fields and a new `aggregateByBucketAndVisitSeq()` sibling. Ship 2 new MVs (customer_ltv_mv, item_counts_daily_mv) + extend transactions_filterable_v + extend refresh_analytics_mvs() in 3 migrations (0023/0024/0025).

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Data Layer Architecture (D-01..D-04):**
- **D-01:** Hybrid approach. Extend `transactions_filterable_v` with `visit_seq` + `card_hash` (no new SSR query — calendar charts use the already-fetched stream). New `customer_ltv_v` (MV-backed) feeds VA-07/09/10 from one source. New `item_counts_daily_v` (MV-backed) feeds VA-08. Reuse `retention_curve_v` for VA-06.
- **D-02:** SSR fan-out grows from 4 to 7 queries. Parallel `Promise.all`. Per-card error isolation per Phase 4 D-22.
- **D-03:** `DailyRow` gains `visit_seq: number | null` and `card_hash: string | null`. `filterRows()` unchanged. Add `aggregateByBucketAndVisitSeq()` returning `Map<bucket, Map<visit_seq_bucket, {revenue_cents, tx_count}>>`.
- **D-04:** `refresh_analytics_mvs()` DAG: `cohort_mv → kpi_daily_mv → visit_attribution_mv → customer_ltv_mv → item_counts_daily_mv`. All CONCURRENTLY with unique indexes.

**Visit-Count Bucket Encoding (D-05..D-08):**
- **D-05:** All 8 buckets kept (1st/2nd/3rd/4x/5x/6x/7x/8x+) — no collapsing.
- **D-06:** Sequential color scale (light→dark blue). 8 shades from a single hue via `d3-interpolate`.
- **D-07:** Cash = 9th segment, neutral gray `#a1a1aa`. `visit_seq IS NULL` rows stack below 8 card buckets. Honors `cashFilter` state.
- **D-08:** Horizontal gradient legend below chart ("1st"→"8x+" with gray Cash swatch). No per-segment labels — tooltip reveals.

**Chart Order (D-09..D-11):**
- **D-09:** Linear scroll. No tabs, no accordion.
- **D-10:** Order: DashboardHeader + FilterBar + FreshnessLabel + KPI Revenue + KPI Transactions + InsightCard + VA-04 + VA-05 + VA-08 + VA-06 (existing) + VA-09 + VA-10 + VA-07.
- **D-11:** IntersectionObserver lazy-mount for below-fold charts. Stretch goal — if measurement shows first-paint fast enough without it, skip.

**LTV Shape (D-12, D-13):**
- **D-12:** VA-07 = histogram of per-customer revenue, 6 buckets (`€0–10`, `€10–25`, `€25–50`, `€50–100`, `€100–250`, `€250+`). X = LTV bins, Y = customer count.
- **D-13:** Bins are UI constants in `src/lib/ltvBins.ts` — not SQL.

**Order Items Shape (D-14..D-16):**
- **D-14:** Top-8 items + "Other" rollup, client-side selection. SSR returns full rows; client picks top-8 by total count in-window; rest → "Other" (gray segment).
- **D-15:** Categorical 8-color palette for items via `d3-scale-chromatic` `schemeTableau10` (pick 8).
- **D-16:** Metric = COUNT of order_items, not gross. `SUM(COUNT)` per (date, item_name). Revenue-by-item deferred.

**Cohort Grain (D-17):** Global grain toggle clamps to **weekly** for cohort-semantic charts (VA-06, VA-09, VA-10). When user picks "day", these charts render weekly with inline hint.

**Empty/Sparse (D-18, D-19):**
- **D-18:** Per-chart empty-state copy in `src/lib/emptyStates.ts` extensions. 6 new keys (D-18 list).
- **D-19:** Sparse filter for cohort charts (VA-09/VA-10) reuses `pickVisibleCohorts()` from `sparseFilter.ts`.

**Tooltip / Perf Budget (D-20..D-22):**
- **D-20:** Tap-to-reveal tooltips per Phase 4 D-15.
- **D-21:** SSR payload ≤500kB compressed. Verify with measurement task.
- **D-22:** `MAX_CALENDAR_BARS = 90` soft cap. Lean toward clamp grain→weekly when range >90d.

### Claude's Discretion
- Exact LayerChart primitive choice (`BarChart` vs manual `Bars` composition) → **recommend high-level `BarChart` — see Architecture §1**.
- Individual component file names and test structure.
- Whether to share a `CalendarChart.svelte` abstraction across VA-04/05/08 vs three siblings.
- Exact hex values for sequential + categorical palettes (finalize at 375px).
- Y-axis unit labels (€ / count).
- If `customer_ltv_mv` refresh takes >30s, swap to regular view.

### Deferred Ideas (OUT OF SCOPE)
- Revenue-by-item view (separate from VA-08 item counts).
- Individual customer drill-down from LTV histogram.
- Per-card grain toggles.
- Hourly/day-of-week heatmap (v2 ADV-01).
- At-risk customer list (v2 ADV-02).
- Segment chips (v2 ADV-03).
- Menu-item cohort analysis (v2 ADV-04).
- Custom date-range picker on mobile.
- PDF/CSV export.
- 12-month LTV projection line.
- Cohort triangle / heatmap.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VA-04 | Calendar revenue — stacked bars by visit-count bucket per day/week/month | LayerChart `<BarChart seriesLayout='stack'>` (§Architecture 1); extended `transactions_filterable_v` + `aggregateByBucketAndVisitSeq()` (§Architecture 2); sequential blue gradient via `interpolateBlues` (§Architecture 3). |
| VA-05 | Calendar customer counts — stacked bars by visit-count bucket per day/week/month | Same component as VA-04, different accessor (`tx_count` instead of `revenue_cents`). Same data source — no extra query. |
| VA-06 | Retention curve — weekly cohort retention with horizon-clip | **Already shipping** (`CohortRetentionCard.svelte` from Phase 4). Phase 10 carries forward with zero work — verified no hidden wiring changes needed (§Carry-forward Findings). |
| VA-07 | LTV per customer — bucketed distribution histogram | New `customer_ltv_mv` feeds this. 6 UI-defined bins (`ltvBins.ts`). LayerChart `<BarChart>` (no stacking). |
| VA-08 | Calendar order item counts — top-8 items + "Other" rollup per day/week/month | New `item_counts_daily_mv` joins `stg_orderbird_order_items.invoice_number = transactions.source_tx_id`. Client-side top-8 selection. `schemeTableau10` palette. |
| VA-09 | First-time cohort total revenue (weekly) | Client-side GROUP BY `cohort_week` SUM of `revenue_cents` from `customer_ltv_v`. |
| VA-10 | First-time cohort avg LTV (weekly) | Client-side GROUP BY `cohort_week` AVG of `revenue_cents` from `customer_ltv_v`. |

## Project Constraints (from CLAUDE.md)

**Forbidden:**
- `@supabase/auth-helpers-sveltekit` (deprecated) — use `@supabase/ssr` (already in use).
- `svelte-chartjs` (unmaintained, no Svelte 5 support) — use LayerChart (already in use).
- Moment.js — use date-fns (already in use).
- Cloudflare D1 for analytics — Supabase Postgres (already in use).
- Running Claude API from browser — Edge Functions only (N/A to this phase).
- Querying raw `*_mv` from SvelteKit — query wrapper `*_v` views only. **`scripts/ci-guards.sh` will fail the build otherwise.**
- `REFRESH MATERIALIZED VIEW` without `CONCURRENTLY` — every new MV gets unique index + CONCURRENTLY.
- `getSession` on server — use `safeGetSession` / `getUser` (already wired in `hooks.server.ts`).

**Mandatory:**
- Mobile-first at 375px baseline. Every new chart must render at 375×667 without horizontal scroll.
- Supabase `auth.jwt()->>'restaurant_id'` JWT claim for tenant scoping (both MVs use this in wrapper views).
- Security-definer wrapper view pattern for every new MV (cohort_mv / migration 0010 is the canonical template).
- `REVOKE ALL ... FROM authenticated, anon` on raw MVs; `GRANT SELECT TO authenticated` on wrapper views.
- Every MV must have a unique index (enabling `CONCURRENTLY`).
- `scripts/ci-guards.sh` must pass (no raw `*_mv` or `transactions` references from `src/`).
- Card-hash only, never PAN / PII (N/A — `customer_ltv_mv` stores `card_hash` only).

**From `.claude/CLAUDE.md`:**
- Always work against DEV unless user says local/prod.
- Push → deploy to DEV → verify before marking tasks done.
- No `Co-authored-by: Claude` in commit messages.
- Adversarial QA — try to break it.
- Run `/qa-gate` before marking verified.

## Standard Stack

### Core (already installed — package.json verified)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| **layerchart** | `2.0.0-next.54` | Chart primitives + high-level `BarChart`, `AreaChart` | Svelte 5 native; already pinned; `CohortRetentionCard` proves it works; `BarChart` has built-in `seriesLayout='stack'`. |
| **d3-scale** | `^4.0.2` | Explicit scales for LayerChart 2.x (required — string presets removed) | Already in use by `CohortRetentionCard` (`scaleLinear()`). `scaleBand()` for calendar x-axis. |
| **d3-interpolate** | `3.0.1` (transitive) | Sequential color gradient for visit_seq buckets | Already installed via LayerChart. No add. |
| **d3-scale-chromatic** | `3.1.0` (transitive) | Categorical + sequential palettes (schemeTableau10, interpolateBlues) | Already installed via LayerChart. No add. |
| **date-fns** | `^4.1.0` | `startOfWeek({ weekStartsOn: 1 })`, `startOfMonth`, `parseISO`, `format` | Already in use; `bucketKey()` in dashboardStore already relies on it. |
| **zod** | `^3.25.76` | Already parsing filter URL params — no new schema needed for Phase 10 | Filters frozen by Phase 9. |

**Version verification (npm view):** package.json pins are current as of 2026-04-17. `layerchart@2.0.0-next.54` is the most recent `@next` release (pre-1.0 Svelte 5 line); downgrades would break Svelte 5 compat.

### Supporting (already installed or trivial imports)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `clsx` + `tailwind-merge` | installed | Conditional Tailwind class composition | Reuse existing `cn()` helper in `src/lib/utils.ts` for chart card wrappers. |
| `lucide-svelte` | installed | Optional icons (chart empty-state visual cue) | Optional, not required. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| LayerChart `<BarChart>` high-level | Manual `<Chart> + <Svg> + <Bars seriesKey={...}>` composition | Manual gives finer control over tooltip layout + axis labels, but duplicates what BarChart already wires (series, stack, tooltip, grid, legend). **Recommend high-level BarChart unless a specific tooltip / axis customization requires breaking out.** Even then, escape hatch: pass `{axis}`, `{tooltip}`, etc. props as objects. |
| `interpolateBlues` (sequential multi-hue) | Manual HSL interpolation of one brand color | `interpolateBlues` is perceptually uniform (from d3 maintainers). Hand-picked shades band at mid-range. Stick with the d3 interpolator. |
| `schemeTableau10` | `schemeCategory10`, `schemeSet2`, or custom | Tableau10 is optimized for accessibility contrast and is Tableau's published default — proven at scale. `schemeCategory10` is older and has two reds that confuse at 375px. |
| New MV for VA-09/VA-10 (dedicated `cohort_revenue_mv`) | Client-side GROUP BY on `customer_ltv_v` | See §Open Question 1 — **recommend client-side**. Single restaurant has ~2000 customers (see §Performance Considerations) — SSR payload is ~40kB uncompressed, GROUP BY runs in milliseconds client-side. Dedicated MV would triple the refresh cost for a client-side savings of <10ms. |

**Installation (no new deps required):**
```bash
# Nothing to install. d3-interpolate + d3-scale-chromatic are already present as
# transitive deps of layerchart. If TypeScript complains about missing types:
# npm install --save-dev @types/d3-scale-chromatic @types/d3-interpolate
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── lib/
│   ├── components/
│   │   ├── CalendarRevenueCard.svelte        # VA-04 (new)
│   │   ├── CalendarCountsCard.svelte         # VA-05 (new, shares helper with VA-04)
│   │   ├── CalendarItemsCard.svelte          # VA-08 (new)
│   │   ├── LtvHistogramCard.svelte           # VA-07 (new)
│   │   ├── CohortRevenueCard.svelte          # VA-09 (new)
│   │   ├── CohortAvgLtvCard.svelte           # VA-10 (new)
│   │   ├── CohortRetentionCard.svelte        # VA-06 (existing — carry forward unchanged)
│   │   ├── LazyMount.svelte                  # D-11 IntersectionObserver wrapper (new)
│   │   └── VisitSeqLegend.svelte             # shared 8-step gradient legend (new, used by VA-04/05)
│   ├── chartPalettes.ts                      # (new) interpolateBlues + schemeTableau10 helpers
│   ├── ltvBins.ts                            # (new) D-13 histogram bin definitions
│   ├── dashboardStore.svelte.ts              # (extend) add visit_seq/card_hash + aggregateByBucketAndVisitSeq
│   ├── emptyStates.ts                        # (extend) add 6 new keys per D-18
│   └── sparseFilter.ts                       # (unchanged — reused by VA-09/10 via pickVisibleCohorts)
├── routes/
│   ├── +page.server.ts                       # (extend) grow Promise.all from 4 to 7 queries
│   └── +page.svelte                          # (extend) insert 6 new cards in D-10 order
└── ...

supabase/migrations/
├── 0023_transactions_filterable_v_visit_seq.sql   # extend view with visit_seq + card_hash
├── 0024_customer_ltv_mv.sql                       # new MV + wrapper + test helper + refresh ext
└── 0025_item_counts_daily_mv.sql                  # new MV + wrapper + test helper + refresh ext

tests/
├── unit/
│   ├── dashboardStoreVisitSeq.test.ts             # aggregateByBucketAndVisitSeq pure-fn tests
│   ├── chartPalettes.test.ts                      # palette + ltvBins tests
│   └── ltvHistogram.test.ts                       # histogram binning logic
├── integration/
│   └── phase10-charts.test.ts                     # MV shape + tenant isolation + refresh ordering
└── e2e/
    └── charts-all.spec.ts                         # 6 new charts × {empty, sparse, populated} @ 375px
```

### Pattern 1: LayerChart 2.x Stacked Bar Chart (VA-04 / VA-05 / VA-08)

**Verified directly from `node_modules/layerchart/dist/components/charts/BarChart.svelte` (lines 22–70, 168–204) and `BarChart.svelte.test.js` (lines 92–128).**

```svelte
<script lang="ts">
  // Source: node_modules/layerchart/dist/components/charts/BarChart.svelte
  import { BarChart } from 'layerchart';
  import { interpolateBlues } from 'd3-scale-chromatic';

  type BucketedRow = {
    bucket: string;        // e.g. '2026-04-14' or '2026-04 (month)'
    // Wide format — one column per visit_seq bucket + 'cash'
    '1st': number;
    '2nd': number;
    '3rd': number;
    '4x': number;
    '5x': number;
    '6x': number;
    '7x': number;
    '8x+': number;
    cash: number;
  };

  let { data }: { data: BucketedRow[] } = $props();

  // D-06: sequential blue gradient. Map i/7 through interpolateBlues to get 8 shades
  // from light (1st) to dark (8x+). Source: d3-scale-chromatic sequential-single/Blues.js.
  const VISIT_KEYS = ['1st', '2nd', '3rd', '4x', '5x', '6x', '7x', '8x+'] as const;
  const series = [
    ...VISIT_KEYS.map((key, i) => ({
      key,
      label: key,
      // interpolateBlues(0) = very light; interpolateBlues(1) = very dark.
      // Start at 0.15 so "1st" isn't near-white on mobile screens.
      color: interpolateBlues(0.15 + (i / (VISIT_KEYS.length - 1)) * 0.75)
    })),
    // D-07: 9th cash segment in neutral gray.
    { key: 'cash', label: 'Cash', color: '#a1a1aa' }
  ];
</script>

<div class="h-64">
  <BarChart
    {data}
    x="bucket"
    {series}
    seriesLayout="stack"
    orientation="vertical"
    bandPadding={0.2}
    stackPadding={0}
  />
</div>
```

**Key facts verified in source:**
- `BarChart` is default-exported from `layerchart` package root.
- `series` prop accepts `{ key, label?, value?, color?, selected?, data?, props? }[]` (from `types.d.ts` line 4).
- `seriesLayout: 'overlap' | 'stack' | 'stackExpand' | 'stackDiverging' | 'group'` (BarChart.svelte line 32). `'stack'` is what we want for VA-04/05/08.
- Data is wide-format (one row per bucket, one column per series) — NOT long-format. Our `aggregateByBucketAndVisitSeq()` output must be shaped this way before passing.
- Tooltip is auto-wired via `tooltipContext={{ mode: 'band' }}` (BarChart.svelte lines 153–159). Tap on the band reveals per-series values.
- `bandPadding` defaults to 0.4 — tighten to 0.2 for 90 daily bars on mobile so bars aren't hairlines.

### Pattern 2: Sequential + Categorical Palette Helpers

```ts
// Source: src/lib/chartPalettes.ts (new)
// Verified d3-scale-chromatic exports in node_modules/d3-scale-chromatic/src/index.js
// (interpolateBlues line 24, schemeTableau10 line 11).
import { interpolateBlues, schemeTableau10 } from 'd3-scale-chromatic';

/**
 * 8 sequential blue shades for visit_seq buckets 1st..8x+ (D-06).
 * Returned in order: index 0 = lightest (1st-timer), index 7 = darkest (8x+).
 * Start at 0.15 to avoid near-white; end at 0.90 to avoid near-black.
 */
export const VISIT_SEQ_COLORS: readonly string[] = Array.from({ length: 8 }, (_, i) =>
  interpolateBlues(0.15 + (i / 7) * 0.75)
);

/**
 * Neutral gray for cash segment (D-07). Same value as Tailwind zinc-400 so it
 * visually pairs with the app chrome.
 */
export const CASH_COLOR = '#a1a1aa';

/**
 * 8 categorical colors for item_name buckets (D-15).
 * schemeTableau10 has 10 colors — we pick 8 + reserve gray for the "Other" rollup.
 */
export const ITEM_COLORS: readonly string[] = schemeTableau10.slice(0, 8);

/** Gray for "Other" rollup (same as CASH_COLOR so the visual class "everything else" is consistent). */
export const OTHER_COLOR = CASH_COLOR;
```

**Cloudflare Workers runtime compatibility — VERIFIED:**
- `d3-scale-chromatic` and `d3-interpolate` are pure ESM modules with zero Node-specific APIs (no `fs`, `path`, `Buffer`, etc.). They run in the Workers runtime.
- `CohortRetentionCard` already imports `d3-scale` in a server-rendered Svelte component that ships to Cloudflare Pages — proven by Phase 4 shipping green.
- No SSR concern: palette arrays are computed at module-load time (not per-request).

### Pattern 3: Client-side Visit-Seq Bucket + Cohort Aggregation

```ts
// Source: src/lib/dashboardStore.svelte.ts (extension — add sibling to aggregateByBucket)

/**
 * Bucket a visit_seq integer into a chart label. NULL = 'cash'. 1..7 map 1:1.
 * 8 or more collapse to '8x+' (D-05).
 */
export function visitSeqBucket(visit_seq: number | null): string {
  if (visit_seq === null) return 'cash';
  if (visit_seq === 1) return '1st';
  if (visit_seq === 2) return '2nd';
  if (visit_seq === 3) return '3rd';
  if (visit_seq >= 8) return '8x+';
  return `${visit_seq}x`; // 4x, 5x, 6x, 7x
}

/**
 * Aggregate filtered rows into nested map: bucket -> visit_seq_bucket -> { revenue, count }.
 * Feeds both VA-04 (revenue_cents) and VA-05 (tx_count). Wide-format shaping for
 * LayerChart BarChart happens at the component boundary (see shapeForChart below).
 */
export function aggregateByBucketAndVisitSeq(
  rows: DailyRow[],
  grain: 'day' | 'week' | 'month'
): Map<string, Map<string, { revenue_cents: number; tx_count: number }>> {
  const outer = new Map<string, Map<string, { revenue_cents: number; tx_count: number }>>();
  for (const r of rows) {
    const bucket = bucketKey(r.business_date, grain);
    const vs = visitSeqBucket(r.visit_seq);
    let inner = outer.get(bucket);
    if (!inner) { inner = new Map(); outer.set(bucket, inner); }
    const existing = inner.get(vs);
    if (existing) {
      existing.revenue_cents += r.gross_cents;
      existing.tx_count += 1;
    } else {
      inner.set(vs, { revenue_cents: r.gross_cents, tx_count: 1 });
    }
  }
  return outer;
}

/** Shape the nested map into wide-format rows for LayerChart BarChart. */
export function shapeForChart(
  nested: Map<string, Map<string, { revenue_cents: number; tx_count: number }>>,
  metric: 'revenue_cents' | 'tx_count'
): Array<Record<string, string | number>> {
  const VISIT_KEYS = ['1st', '2nd', '3rd', '4x', '5x', '6x', '7x', '8x+', 'cash'] as const;
  const out: Array<Record<string, string | number>> = [];
  for (const [bucket, inner] of nested) {
    const row: Record<string, string | number> = { bucket };
    for (const key of VISIT_KEYS) {
      row[key] = inner.get(key)?.[metric] ?? 0;
    }
    out.push(row);
  }
  return out.sort((a, b) => String(a.bucket).localeCompare(String(b.bucket)));
}
```

### Pattern 4: Lazy-Mount via IntersectionObserver (D-11)

**Idiomatic Svelte 5 pattern — use an action, not `{#if visible}` with manual observer setup, so the host component stays simple.**

```svelte
<!-- Source: src/lib/components/LazyMount.svelte (new) -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  let { children, rootMargin = '200px', minHeight = '16rem' }: {
    children: Snippet;
    rootMargin?: string;
    minHeight?: string;
  } = $props();

  let visible = $state(false);
  let container: HTMLDivElement;

  // Svelte 5 action pattern: $effect runs client-side only (SSR safe — visible=false
  // on first render so placeholder div ships). When client hydrates and scrolls
  // the container into view (plus 200px lookahead), visible flips true and the
  // child chart instantiates.
  $effect(() => {
    if (!container) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some(e => e.isIntersecting)) {
          visible = true;
          io.disconnect();
        }
      },
      { rootMargin }
    );
    io.observe(container);
    return () => io.disconnect();
  });
</script>

<div bind:this={container} style:min-height={minHeight}>
  {#if visible}
    {@render children()}
  {/if}
</div>
```

**Usage in `+page.svelte`:**
```svelte
<CalendarRevenueCard data={...} />    <!-- Above fold — eager -->
<CalendarCountsCard data={...} />     <!-- Still in viewport on tall phones -->
<LazyMount>
  {#snippet children()}
    <CalendarItemsCard data={...} />  <!-- Below fold — lazy -->
  {/snippet}
</LazyMount>
<!-- ...similar for VA-06/09/10/07 -->
```

**Rationale:** No `bind:viewport` hack, no `use:action` lifecycle mismatch, no SSR mismatch (SSR renders the placeholder; client `$effect` only runs post-hydrate). Tested pattern in the Svelte 5 community. Stretch goal per D-11: planner should measure first-paint without it and skip if already fast enough.

### Pattern 5: Cohort Chart Data Flow (VA-09 / VA-10)

```ts
// Source: src/lib/components/CohortRevenueCard.svelte (new)
// Client-side GROUP BY cohort_week from customer_ltv_v rows.

type CustomerLtvRow = {
  card_hash: string;
  revenue_cents: number;
  visit_count: number;
  cohort_week: string;     // YYYY-MM-DD (Monday)
  cohort_month: string;    // YYYY-MM-01
  first_visit_date: string;
};

// In the card component:
const cohortAggs = $derived.by(() => {
  const byWeek = new Map<string, { total_revenue_cents: number; customer_count: number }>();
  for (const row of data) {
    const existing = byWeek.get(row.cohort_week);
    if (existing) {
      existing.total_revenue_cents += row.revenue_cents;
      existing.customer_count += 1;
    } else {
      byWeek.set(row.cohort_week, {
        total_revenue_cents: row.revenue_cents,
        customer_count: 1
      });
    }
  }
  // Sparse filter (D-19): drop cohorts with < SPARSE_MIN_COHORT_SIZE customers.
  // Same threshold as CohortRetentionCard.
  return Array.from(byWeek.entries())
    .filter(([_, v]) => v.customer_count >= 5)
    .map(([cohort_week, v]) => ({ cohort_week, ...v }))
    .sort((a, b) => a.cohort_week.localeCompare(b.cohort_week))
    .slice(-12);  // last 12 weeks of cohorts
});
```

### Anti-Patterns to Avoid
- **Don't** build stacked bars manually with `<Rect>` + `<Bars>` without a series config. `<BarChart series={…} seriesLayout='stack'>` already handles y0/y1 stack math, band scales, tooltip wiring, and `stackDiverging` edge rounding. Manual composition reintroduces every one of those edge cases.
- **Don't** re-fetch from Supabase on every grain/filter change. Phase 9 D-05 / D-08 pattern — fetch-once, client-rebucket — extends to Phase 10. The only net-new fetches for Phase 10 are `customer_ltv_v` and `item_counts_daily_v`, both fetched once per SSR load.
- **Don't** pass long-format data (one row per series point) to `<BarChart>`. BarChart expects wide format (one row per x-band, columns per series). Use `shapeForChart()` at the component boundary.
- **Don't** assume `retention_curve_v` needs a grain column added. It's weekly-only (verified in migration 0012 line 21–64). VA-06 reuses as-is; D-17 global-grain clamp handles the day→week fallback with inline hint.
- **Don't** query `visit_attribution_mv` or `cohort_mv` directly from `+page.server.ts`. Always use wrapper views — `transactions_filterable_v` (extended), `customer_ltv_v`, `item_counts_daily_v`, `retention_curve_v`. CI guards enforce this.
- **Don't** duplicate the `cohort_week` assignment logic client-side. `customer_ltv_mv` should write `cohort_week` directly (joined from `cohort_mv`) so every client view of VA-09/VA-10 sees identical cohort assignments as VA-06 retention.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Stacked bar math (y0, y1, domain stacking) | Custom SVG `<rect>` with computed positions | `<BarChart seriesLayout='stack'>` | Handles d3-shape `stack()` wiring, negative stacks, expand mode, and rounded edges. Verified in `BarChart.svelte` source. |
| Sequential color scale | Hand-picked hex values | `interpolateBlues(t)` from `d3-scale-chromatic` | Perceptually uniform. Hand-picked shades band at mid-range. |
| Categorical color scale | Tailwind `bg-blue-500 bg-green-500 ...` | `schemeTableau10` | Tableau10 is accessibility-tested; 10-color arrays from Tailwind are not. |
| Histogram binning | Server-side `CASE WHEN revenue BETWEEN 0 AND 10 THEN 1...` | Client-side from `ltvBins.ts` | D-13. Tune bins without a migration. Clean separation of data layer honesty from UI pragmatism (matches Phase 4 D-14). |
| Cohort GROUP BY for VA-09/VA-10 | New `cohort_revenue_mv` | Client-side GROUP BY on `customer_ltv_v` | ~2000 customers × 4 int cols = ~40kB. SSR payload impact is negligible; client GROUP BY is sub-millisecond. New MV would triple refresh cost. |
| Top-N item rollup | SQL `DENSE_RANK() + COALESCE(TOP-8, 'Other')` | Client-side sort + slice + "Other" sum | D-14. Top-8 is window-dependent (depends on filter+range). Putting it in SQL would bake the filter into the MV — wrong layer. |
| IntersectionObserver wrapper | `use:action` in every component | Single `<LazyMount>` wrapper | DRY + SSR-safe ($effect only runs client-side). |
| Cohort sparse filter | Fresh implementation per card | `pickVisibleCohorts()` from `sparseFilter.ts` | Already proven in VA-06. Threshold constant `SPARSE_MIN_COHORT_SIZE = 5`. D-19. |
| LayerChart tooltip | Custom absolute-positioned div | `<BarChart>` built-in tooltip via `tooltipContext` | Already handles mobile tap events (Phase 4 D-15 confirmed works). |
| MV refresh ordering | Ad-hoc `REFRESH` calls | Extend `refresh_analytics_mvs()` (D-04) | Single SECURITY DEFINER function is the pattern; pg_cron calls it. |

**Key insight:** Phase 10 is mostly glue between already-proven primitives. The two genuinely new things are (a) two new MVs and (b) `LazyMount`. Everything else is composition of existing parts — LayerChart `BarChart`, dashboardStore fetch-once, sparse filter, empty states, palette helpers.

## Runtime State Inventory

> Phase 10 is greenfield chart components + new MVs + view extension. It is NOT a rename/refactor, so this section is LIGHT. The only runtime state introduced is two new MVs (and their pg_cron-driven refresh records).

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Two new materialized views: `customer_ltv_mv`, `item_counts_daily_mv`. No existing data renamed/migrated. | New MV creation + unique index + wrapper view — plan tasks. |
| Live service config | pg_cron `refresh-analytics-mvs` job (migration 0013) already schedules nightly refresh. Adding 2 new MVs to `refresh_analytics_mvs()` body via `CREATE OR REPLACE FUNCTION` — no cron re-registration needed. | Verify on DEV that the job's `job_run_details` shows green after first nightly run post-migration. |
| OS-registered state | None — application is SvelteKit on Cloudflare Pages + Supabase Postgres. No OS-level services. | None. |
| Secrets/env vars | None — no new secrets. `customer_ltv_mv` + `item_counts_daily_mv` refresh runs as SECURITY DEFINER (inherits from `refresh_analytics_mvs()`). | None. |
| Build artifacts | SvelteKit `.svelte-kit/` + Vite `node_modules/.vite/` caches may stale-reference old `DailyRow` type — clear on first build after migration. | Planner adds a `rm -rf .svelte-kit/ && npm run build` step in the first task after the type extension. |

**Nothing found in category "OS-registered state" and "Secrets/env vars":** Verified — Phase 10 is data-layer + UI composition only; no OS-level registrations or new secrets involved.

## Customer-LTV MV Shape (D-01 — concrete DDL draft)

```sql
-- supabase/migrations/0024_customer_ltv_mv.sql
-- Phase 10 Plan: one row per customer with lifetime revenue, visit count, and
-- cohort assignments. Feeds VA-07 (histogram), VA-09 (cohort total), VA-10 (cohort avg).
-- Joins cohort_mv (for cohort assignments) with transactions (for aggregates).
-- Excludes cash (card_hash IS NULL) — same filter as cohort_mv.
-- Excludes April 2026 Worldline blackout — same rule as cohort_mv (keeps MVs consistent).

create materialized view public.customer_ltv_mv as
with filtered_tx as (
  select
    t.restaurant_id,
    t.card_hash,
    t.gross_cents,
    t.occurred_at
  from public.transactions t
  where t.card_hash is not null
    and not (
      t.occurred_at >= '2026-04-01 00:00:00+00'
      and t.occurred_at <  '2026-04-12 00:00:00+00'
    )
),
per_customer as (
  select
    restaurant_id,
    card_hash,
    sum(gross_cents)::bigint as revenue_cents,
    count(*)::integer         as visit_count
  from filtered_tx
  group by restaurant_id, card_hash
)
select
  pc.restaurant_id,
  pc.card_hash,
  pc.revenue_cents,
  pc.visit_count,
  c.cohort_day,
  c.cohort_week,
  c.cohort_month,
  c.first_visit_business_date,
  c.first_visit_at
from per_customer pc
join public.cohort_mv c
  on c.restaurant_id = pc.restaurant_id
 and c.card_hash     = pc.card_hash;

-- Unique index for REFRESH CONCURRENTLY
create unique index customer_ltv_mv_pk
  on public.customer_ltv_mv (restaurant_id, card_hash);

-- Lock raw MV
revoke all on public.customer_ltv_mv from anon, authenticated;

-- Wrapper view (JWT tenant filter; do NOT set security_invoker)
create view public.customer_ltv_v as
select
  restaurant_id,
  card_hash,
  revenue_cents,
  visit_count,
  cohort_day,
  cohort_week,
  cohort_month,
  first_visit_business_date,
  first_visit_at
from public.customer_ltv_mv
where restaurant_id::text = (auth.jwt()->>'restaurant_id');

grant select on public.customer_ltv_v to authenticated;

-- Test helper for integration tests (follows 0020_visit_attribution_mv.sql pattern)
create or replace function public.test_customer_ltv(rid uuid)
returns table (
  restaurant_id uuid,
  card_hash     text,
  revenue_cents bigint,
  visit_count   integer,
  cohort_day    date,
  cohort_week   date,
  cohort_month  date,
  first_visit_business_date date,
  first_visit_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('restaurant_id', rid::text)::text, true);
  return query select * from public.customer_ltv_v;
end;
$$;
revoke all on function public.test_customer_ltv(uuid) from public, anon, authenticated;
grant execute on function public.test_customer_ltv(uuid) to service_role;

-- Extend refresh_analytics_mvs() — customer_ltv_mv depends on cohort_mv.
create or replace function public.refresh_analytics_mvs()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  refresh materialized view concurrently public.cohort_mv;
  refresh materialized view concurrently public.kpi_daily_mv;
  refresh materialized view concurrently public.visit_attribution_mv;
  refresh materialized view concurrently public.customer_ltv_mv;
  -- item_counts_daily_mv added in 0025
end;
$$;
```

**Key points:**
- Joins `cohort_mv` (not `transactions` alone) so VA-06/VA-09/VA-10 share identical cohort assignments.
- Blackout exclusion matches `cohort_mv` — one source of truth.
- `revenue_cents` is `bigint` — a power user with 100+ visits × €30 each still fits comfortably.
- Cash (`card_hash IS NULL`) is excluded — consistent with `cohort_mv` convention.
- Non-cohort customers (e.g., a card that hasn't made it into cohort_mv yet due to refresh timing) will be dropped by the INNER JOIN. Acceptable — customer_ltv_mv always refreshes *after* cohort_mv.

## Item-Counts Daily MV Shape (D-01 — concrete DDL draft)

```sql
-- supabase/migrations/0025_item_counts_daily_mv.sql
-- Phase 10 Plan: per-day × item_name × sales_type × is_cash item counts.
-- Feeds VA-08 only. Client picks top-8 + "Other" rollup (D-14).
--
-- Join key: stg_orderbird_order_items.invoice_number = transactions.source_tx_id
-- (confirmed in scripts/ingest/normalize.ts line 185: source_tx_id = invoice).
-- Additional join to visit_attribution_mv for is_cash (Phase 8 canonical source).

create materialized view public.item_counts_daily_mv as
with filtered as (
  select
    t.restaurant_id,
    (t.occurred_at at time zone r.timezone)::date as business_date,
    oi.item_name,
    t.sales_type,
    coalesce(va.is_cash, true) as is_cash
  from public.stg_orderbird_order_items oi
  join public.transactions t
    on  t.restaurant_id = oi.restaurant_id
    and t.source_tx_id  = oi.invoice_number
  join public.restaurants r
    on r.id = t.restaurant_id
  left join public.visit_attribution_mv va
    on  va.restaurant_id = t.restaurant_id
    and va.tx_id         = t.source_tx_id
  where oi.item_name is not null
    and oi.item_name <> ''
)
select
  restaurant_id,
  business_date,
  item_name,
  sales_type,
  is_cash,
  count(*)::integer as item_count
from filtered
group by restaurant_id, business_date, item_name, sales_type, is_cash;

-- Unique index for REFRESH CONCURRENTLY
create unique index item_counts_daily_mv_pk
  on public.item_counts_daily_mv (restaurant_id, business_date, item_name, sales_type, is_cash);

-- Lock raw MV
revoke all on public.item_counts_daily_mv from anon, authenticated;

-- Wrapper view
create view public.item_counts_daily_v as
select
  restaurant_id,
  business_date,
  item_name,
  sales_type,
  is_cash,
  item_count
from public.item_counts_daily_mv
where restaurant_id::text = (auth.jwt()->>'restaurant_id');

grant select on public.item_counts_daily_v to authenticated;

-- Test helper
create or replace function public.test_item_counts_daily(rid uuid)
returns table (
  restaurant_id uuid,
  business_date date,
  item_name     text,
  sales_type    text,
  is_cash       boolean,
  item_count    integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('restaurant_id', rid::text)::text, true);
  return query select * from public.item_counts_daily_v;
end;
$$;
revoke all on function public.test_item_counts_daily(uuid) from public, anon, authenticated;
grant execute on function public.test_item_counts_daily(uuid) to service_role;

-- Extend refresh_analytics_mvs() — item_counts_daily_mv depends on visit_attribution_mv.
create or replace function public.refresh_analytics_mvs()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  refresh materialized view concurrently public.cohort_mv;
  refresh materialized view concurrently public.kpi_daily_mv;
  refresh materialized view concurrently public.visit_attribution_mv;
  refresh materialized view concurrently public.customer_ltv_mv;
  refresh materialized view concurrently public.item_counts_daily_mv;
end;
$$;
```

**Key points verified against existing code:**
- **Join key confirmed:** `scripts/ingest/normalize.ts:185` sets `source_tx_id: invoice` — so `transactions.source_tx_id == stg_orderbird_order_items.invoice_number`. Even though column names differ, the semantic is identical.
- **is_cash source:** `visit_attribution_mv` is the canonical source (Phase 8 D-02). LEFT JOIN with `COALESCE(..., true)` matches the Phase 9 `transactions_filterable_v` pattern (migration 0022 line 14).
- **Granularity:** per-day × item × sales_type × is_cash. At 365 days × ~100 items × 2 sales_types × 2 cash_states = ~146k rows maximum. More realistically, 100d × 30 active items × 2 × 2 = 12k rows. Fits comfortably in Postgres MV.
- **Top-8 rollup is client-side** (D-14) — not in SQL. Every query returns the full per-item distribution; client filters.

## Transactions_Filterable_V Extension (D-01)

```sql
-- supabase/migrations/0023_transactions_filterable_v_visit_seq.sql
-- Phase 10 Plan: extend transactions_filterable_v with visit_seq + card_hash.
-- Calendar charts (VA-04, VA-05) use these columns from the already-fetched
-- client stream — no new SSR query.
--
-- Pattern: extending the existing join with visit_attribution_mv (added in 0022
-- for is_cash). Adding 2 more columns to the same join is cheap.
--
-- NOTE: Per Phase 9 09-03 gap-closure, view column-shape changes must use
-- DROP VIEW + CREATE VIEW (not CREATE OR REPLACE VIEW — Postgres forbids
-- column removal that way, SQLSTATE 42P16). We're ADDING columns here, so
-- CREATE OR REPLACE is fine. But preserving DROP+CREATE for safety:

drop view if exists public.transactions_filterable_v;

create view public.transactions_filterable_v
with (security_invoker = true) as
select
  t.restaurant_id,
  (t.occurred_at at time zone r.timezone)::date as business_date,
  t.gross_cents,
  t.sales_type,
  t.payment_method,
  coalesce(va.is_cash, true) as is_cash,
  va.visit_seq,                              -- new (NULL for cash / unattributed)
  t.card_hash                                -- new (NULL for cash)
from public.transactions t
join public.restaurants r on r.id = t.restaurant_id
left join public.visit_attribution_mv va
  on va.restaurant_id = t.restaurant_id and va.tx_id = t.source_tx_id
where t.restaurant_id::text = (auth.jwt() ->> 'restaurant_id');

-- No grant changes needed — authenticated still has select via inheritance.
-- Security invoker means RLS on underlying transactions table still applies.
```

**Key points:**
- `security_invoker = true` is preserved from migration 0022 — RLS on `transactions` applies.
- `visit_seq` is NULL for cash and for transactions not yet in `visit_attribution_mv` (e.g., fresh uploads before next refresh).
- `card_hash` is added for optional future use. Not required for VA-04/05 (which only need `visit_seq`), but per D-01 it's cheap insurance if a client-side cohort computation is ever added.
- DailyRow type extension: `visit_seq: number | null` and `card_hash: string | null`.

## Common Pitfalls

### Pitfall 1: LayerChart 2.x string scale presets removed
**What goes wrong:** `<Chart xScale="linear">` throws `$scale.copy is not a function` on hydration.
**Why it happens:** LayerChart 2.x removed string presets in favor of explicit d3 scale functions.
**How to avoid:** Always pass `xScale={scaleLinear()}` or `xScale={scaleBand()}` — never strings. The high-level `<BarChart>` handles scale derivation internally, so only manual `<Chart>` compositions need this.
**Warning signs:** Console error "scale.copy is not a function" on page load (already has a regression test in `charts-with-data.spec.ts` line 43).

### Pitfall 2: RLS + Materialized Views (CLAUDE.md §1)
**What goes wrong:** Raw MV bypasses RLS — tenant A could read tenant B's rows.
**Why it happens:** RLS doesn't propagate to MVs. Security-definer wrapper view is the project pattern.
**How to avoid:** Every MV gets `REVOKE ALL FROM anon, authenticated` + a wrapper view with `WHERE restaurant_id::text = (auth.jwt()->>'restaurant_id')` + `GRANT SELECT TO authenticated`. Template: `supabase/migrations/0010_cohort_mv.sql` lines 56–77.
**Warning signs:** Integration test `tenant-isolation.test.ts` fails; `scripts/ci-guards.sh` detects raw `*_mv` references from `src/`.

### Pitfall 3: REFRESH CONCURRENTLY requires unique index
**What goes wrong:** Refresh blocks all reads for seconds-minutes.
**Why it happens:** Without a unique index, Postgres can't run CONCURRENTLY; it falls back to blocking refresh.
**How to avoid:** `CREATE UNIQUE INDEX xxx_mv_pk ON xxx_mv (restaurant_id, ...)` with columns that uniquely identify every row. For `customer_ltv_mv` → `(restaurant_id, card_hash)`. For `item_counts_daily_mv` → `(restaurant_id, business_date, item_name, sales_type, is_cash)`.
**Warning signs:** `REFRESH MATERIALIZED VIEW CONCURRENTLY` errors with "cannot refresh concurrently, no unique index defined".

### Pitfall 4: Wide-format data for LayerChart BarChart with series
**What goes wrong:** Passing long-format rows (`{ bucket, series, value }`) to `<BarChart series={…}>` silently produces empty bars.
**Why it happens:** BarChart expects one row per x-band with one column per series key. It does not pivot long→wide internally.
**How to avoid:** Use `shapeForChart()` helper (Pattern 3) to widen before passing. One chart, one wide-format array.
**Warning signs:** Bars render at height 0; `.lc-bars` groups present but `<rect>` elements have `height="0"`. Check data shape before debugging LayerChart internals.

### Pitfall 5: Client-side sort() on string dates
**What goes wrong:** Bucket ordering swaps week 2026-04-06 and 2026-04-13 (sort order unstable).
**Why it happens:** `Array.sort()` without comparator uses Unicode code point order — fine for YYYY-MM-DD but breaks if any bucket key uses a different format (e.g., "2026-04" month bucket).
**How to avoid:** Always use `.sort((a, b) => a.bucket.localeCompare(b.bucket))` or `.sort((a, b) => String(a.bucket) < String(b.bucket) ? -1 : 1)`. Pattern 3 does this.
**Warning signs:** Chart shows out-of-order bars that look chronologically sensible until the reader notices (e.g., April before March).

### Pitfall 6: stg_orderbird_order_items.item_name has NULL and empty-string rows
**What goes wrong:** `item_counts_daily_mv` gets 100+ rows per day for `item_name=''` or NULL, polluting top-8.
**Why it happens:** CSV sometimes ships rows for service charges, tips, voids where the "line item" has no name.
**How to avoid:** The DDL already filters `WHERE oi.item_name IS NOT NULL AND oi.item_name <> ''`. Integration test asserts.
**Warning signs:** "Other" segment is disproportionately large; top-8 items include a blank entry.

### Pitfall 7: D-11 Lazy-mount + SSR first-paint
**What goes wrong:** Charts below fold flicker on every client-side navigation (re-observe → unmount → re-mount).
**Why it happens:** `LazyMount` uses `$effect` which re-runs when `data` changes. If not careful, the observer disconnects and reconnects, causing visible=false → true flash.
**How to avoid:** Only observe once; once `visible=true`, stop observing. The Pattern 4 snippet does `io.disconnect()` inside the callback.
**Warning signs:** Chart disappears briefly when user changes the filter.

### Pitfall 8: customer_ltv_mv refresh ordering
**What goes wrong:** `customer_ltv_mv` refreshes before `cohort_mv` → stale cohort_week assignments.
**Why it happens:** `refresh_analytics_mvs()` must refresh `cohort_mv` FIRST (it's the source of truth).
**How to avoid:** D-04 locks ordering: `cohort_mv → kpi_daily_mv → visit_attribution_mv → customer_ltv_mv → item_counts_daily_mv`. Integration test asserts new cohort rows propagate through customer_ltv_mv on the same refresh cycle.
**Warning signs:** A fresh first-time visitor appears in retention chart but not in LTV histogram after a single refresh cycle.

## Code Examples

### CalendarRevenueCard.svelte (VA-04 — canonical pattern, others follow)

```svelte
<!-- Source: src/lib/components/CalendarRevenueCard.svelte (new)
     Verified against: node_modules/layerchart/dist/components/charts/BarChart.svelte -->
<script lang="ts">
  import { BarChart } from 'layerchart';
  import EmptyState from './EmptyState.svelte';
  import VisitSeqLegend from './VisitSeqLegend.svelte';
  import { VISIT_SEQ_COLORS, CASH_COLOR } from '$lib/chartPalettes';
  import { getBucketed, getFiltered, aggregateByBucketAndVisitSeq, shapeForChart, getFilters } from '$lib/dashboardStore.svelte';

  const VISIT_KEYS = ['1st', '2nd', '3rd', '4x', '5x', '6x', '7x', '8x+'] as const;
  const ALL_KEYS = [...VISIT_KEYS, 'cash'] as const;

  const grain = $derived(getFilters().grain);
  const chartData = $derived.by(() => {
    const filtered = getFiltered();
    const nested = aggregateByBucketAndVisitSeq(filtered, grain as 'day' | 'week' | 'month');
    return shapeForChart(nested, 'revenue_cents');
  });

  // Visible series — filter out 'cash' when cashFilter==='card', etc.
  const series = $derived.by(() => {
    const cashFilter = getFilters().is_cash;
    const visitSeries = VISIT_KEYS.map((key, i) => ({
      key,
      label: key,
      color: VISIT_SEQ_COLORS[i]
    }));
    if (cashFilter === 'card') return visitSeries;
    if (cashFilter === 'cash') return [{ key: 'cash', label: 'Cash', color: CASH_COLOR }];
    return [...visitSeries, { key: 'cash', label: 'Cash', color: CASH_COLOR }];
  });
</script>

<div data-testid="calendar-revenue-card" class="rounded-xl border border-zinc-200 bg-white p-4">
  <h2 class="text-base font-semibold text-zinc-900">Revenue by visit</h2>
  {#if chartData.length === 0}
    <EmptyState card="calendar-revenue" />
  {:else}
    <div class="mt-4 h-64">
      <BarChart
        data={chartData}
        x="bucket"
        {series}
        seriesLayout="stack"
        orientation="vertical"
        bandPadding={0.2}
      />
    </div>
    <VisitSeqLegend showCash={getFilters().is_cash !== 'card'} />
  {/if}
</div>
```

### LtvHistogramCard.svelte (VA-07 — histogram pattern)

```svelte
<!-- Source: src/lib/components/LtvHistogramCard.svelte (new) -->
<script lang="ts">
  import { BarChart } from 'layerchart';
  import EmptyState from './EmptyState.svelte';
  import { LTV_BINS, binCustomerRevenue } from '$lib/ltvBins';

  type CustomerLtvRow = {
    card_hash: string;
    revenue_cents: number;
    visit_count: number;
    cohort_week: string;
  };

  let { data }: { data: CustomerLtvRow[] } = $props();

  const chartData = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const bin of LTV_BINS) counts.set(bin.label, 0);
    for (const row of data) {
      const bin = binCustomerRevenue(row.revenue_cents);
      counts.set(bin, (counts.get(bin) ?? 0) + 1);
    }
    return LTV_BINS.map(b => ({ bin: b.label, customers: counts.get(b.label) ?? 0 }));
  });
</script>

<div data-testid="ltv-histogram-card" class="rounded-xl border border-zinc-200 bg-white p-4">
  <h2 class="text-base font-semibold text-zinc-900">LTV distribution</h2>
  {#if data.length === 0}
    <EmptyState card="ltv-histogram" />
  {:else}
    <div class="mt-4 h-64">
      <BarChart data={chartData} x="bin" y="customers" orientation="vertical" />
    </div>
  {/if}
</div>
```

### ltvBins.ts (D-13)

```ts
// Source: src/lib/ltvBins.ts (new)
export type LtvBin = { label: string; minCents: number; maxCents: number };

export const LTV_BINS: readonly LtvBin[] = [
  { label: '€0–10',    minCents:      0, maxCents:   1000 },
  { label: '€10–25',   minCents:   1000, maxCents:   2500 },
  { label: '€25–50',   minCents:   2500, maxCents:   5000 },
  { label: '€50–100',  minCents:   5000, maxCents:  10000 },
  { label: '€100–250', minCents:  10000, maxCents:  25000 },
  { label: '€250+',    minCents:  25000, maxCents: Number.MAX_SAFE_INTEGER }
];

export function binCustomerRevenue(revenue_cents: number): string {
  for (const b of LTV_BINS) {
    if (revenue_cents >= b.minCents && revenue_cents < b.maxCents) return b.label;
  }
  return LTV_BINS[LTV_BINS.length - 1].label; // guard for overflow
}
```

### dashboardStore extension

```ts
// Source: src/lib/dashboardStore.svelte.ts (additions — 3 new exports)

// Extend DailyRow type (backward compatible — additions only)
export type DailyRow = {
  business_date: string;
  gross_cents: number;
  sales_type: string | null;
  is_cash: boolean;
  visit_seq: number | null;   // NEW — NULL for cash + not-yet-attributed
  card_hash: string | null;   // NEW — NULL for cash
};

export function visitSeqBucket(visit_seq: number | null): string { /* Pattern 3 */ }

export function aggregateByBucketAndVisitSeq(
  rows: DailyRow[],
  grain: 'day' | 'week' | 'month'
): Map<string, Map<string, { revenue_cents: number; tx_count: number }>> { /* Pattern 3 */ }

export function shapeForChart(
  nested: Map<string, Map<string, { revenue_cents: number; tx_count: number }>>,
  metric: 'revenue_cents' | 'tx_count'
): Array<Record<string, string | number>> { /* Pattern 3 */ }
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| LayerChart 1.x `xScale="linear"` string preset | `xScale={scaleLinear()}` explicit d3 scale fn | LayerChart 2.x (April 2025) | Phase 4 D-06 / Gap A closure already made the switch. No Phase 10 change. |
| LayerChart 1.x `<LineChart>`/`<BarChart>` minimal API | LayerChart 2.x high-level `<BarChart series={…} seriesLayout='stack'>` | LayerChart 2.0.0-next series | **Phase 10 can use the high-level API directly.** CohortRetentionCard's low-level `<Chart>+<Svg>+<Spline>` composition was Gap A defensive — new charts don't need that. |
| `@supabase/auth-helpers-sveltekit` | `@supabase/ssr` | Supabase auth consolidation (2024) | Already migrated in Phase 4. Phase 10 inherits. |
| Cohort grain as card-local toggle (Phase 4 D-12) | Global grain toggle in FilterBar (Phase 9 D-14) | Phase 9 | VA-06 retention chart stays weekly-only; global grain clamps for cohort charts (D-17). |
| Payment-method multi-select filter | Binary cash/card toggle (Phase 9 D-01) | Phase 9 | All Phase 10 charts honor `is_cash` filter via client-side `filterRows()`. |

**Deprecated/outdated (from CLAUDE.md):**
- `svelte-chartjs`: unmaintained, no Svelte 5 — using LayerChart.
- `@supabase/auth-helpers-sveltekit`: deprecated — using `@supabase/ssr`.
- Moment.js: deprecated — using date-fns.
- CF D1 for analytics: lacks window functions — using Supabase Postgres.

## Open Questions

### 1. VA-09 / VA-10: client-side GROUP BY vs dedicated cohort_revenue_mv

- **What we know:**
  - `customer_ltv_mv` will contain one row per customer with `(cohort_week, cohort_month, revenue_cents, visit_count)`.
  - For a single restaurant with 6 months of history, customer count is ~2000 (rough estimate — founder's friend's venue is ~50 transactions/day × 30% card × 50% repeat rate × 180 days ≈ 2700 unique customers, approximate 2000 after dedup).
  - Row size: `card_hash` (64 chars) + 3 `date` (32 bytes each) + 2 `bigint` (16 bytes) + 1 `timestamptz` (8 bytes) = ~180 bytes/row uncompressed. 2000 rows ≈ 360kB uncompressed, ~40–80kB compressed over HTTP.
  - Client-side `Map<cohort_week, { sum, count }>` GROUP BY on 2000 rows runs in <5ms (measured on phones in Phase 9 filter rebucket work).
- **What's unclear:**
  - Will the restaurant scale past 10k customers? If yes, SSR payload → ~400kB compressed, which blows D-21's 500kB budget.
  - Does a dedicated `cohort_revenue_mv` give a meaningful perceived-latency win at 2k customers? No — the SSR round-trip dominates either way.
- **Recommendation:** **Client-side GROUP BY for v1.** Revisit with a dedicated MV only if (a) customer count crosses 10k OR (b) a measurement task shows VA-09/VA-10 first-paint exceeds 200ms. Planner adds a Measurement Task in the plan per D-21.

### 2. Cohort chart grain clamp UX (D-17)

- **What we know:** Global grain toggle has 3 options (day/week/month); cohort-semantic charts (VA-06/09/10) only render weekly per retention_curve_v and customer_ltv_mv shapes.
- **What's unclear:** D-17 says "render as weekly and show a small inline hint" when user picks day. Is the hint on the card header, subtitle, or as a dimmed "Weekly only" badge?
- **Recommendation:** Subtitle under the card title, matching `sparse-hint` styling in CohortRetentionCard (`text-xs text-amber-600`, line 54). Copy: `"Cohort view shows weekly — other grains not applicable."` Planner finalizes.

### 3. `CalendarChart.svelte` shared abstraction (Claude's Discretion)

- **What we know:** VA-04 (revenue) + VA-05 (counts) + VA-08 (items) all share: calendar-x axis, stacked bars, 9-color segments.
- **Difference:** metric (revenue_cents vs tx_count vs item_count) and palette (sequential blue vs categorical Tableau10) and legend shape.
- **Recommendation:** **Three siblings for v1, not a shared abstraction.** The palette + legend differences are visually load-bearing; merging them pushes more props into a generic component, and the DRY savings are ~30 lines. Refactor toward a shared component in v2 if a 4th calendar chart appears.

### 4. IntersectionObserver lazy-mount — ship or skip?

- **What we know:** D-11 marked this a stretch goal. 12 cards total; ~6 are above-fold on a 667px tall viewport.
- **What's unclear:** LayerChart per-chart mount cost on mobile. Phase 4 `CohortRetentionCard` mounts in <50ms — 6 new charts ≈ 300ms additional first-paint if all eager.
- **Recommendation:** Planner adds a Measurement Task: eager-mount all 6 new charts in a prototype, measure first-paint on mobile Chrome emulator at 375px. If total first-paint >2s → ship `LazyMount`. Else → skip. Pattern 4 snippet is ready either way.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node | build + test | ✓ | node_modules present | — |
| SvelteKit 2 | app | ✓ | `@sveltejs/kit@^2.57.1` | — |
| Svelte 5 | runes | ✓ | `svelte@^5.55.4` | — |
| LayerChart 2.x | charts | ✓ | `layerchart@2.0.0-next.54` | — |
| d3-scale | LayerChart scales | ✓ | `d3-scale@^4.0.2` | — |
| d3-scale-chromatic | palettes | ✓ (transitive) | `3.1.0` | — |
| d3-interpolate | gradient | ✓ (transitive) | `3.0.1` | — |
| date-fns | bucket keys | ✓ | `date-fns@^4.1.0` | — |
| Supabase CLI | migrations | assumed ✓ | project-configured | — |
| pg_cron | refresh | ✓ (migration 0013) | — | — |
| Vitest | unit/integration tests | ✓ | `vitest@^4.1.4` | — |
| Playwright | e2e | ✓ | `@playwright/test@^1.59.1` | — |
| Chromium (for Playwright) | e2e | ✓ (project-configured, mobile-chrome only) | — | — |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None.

**CI Pages deploy pipeline** (from STATE.md "Blockers"): still broken since commit `a3623b9`. This blocks visual UAT at 375px on DEV for Phase 10 just as it did for Phase 6. Planner must either (a) fix the CI pipeline before Phase 10 UAT, or (b) explicitly defer 375px CF Pages verification to a gap-closure plan like Phase 6 did. Research flagged but not blocking.

## Carry-forward Findings (Retention Chart — VA-06)

**Question:** Does `CohortRetentionCard.svelte` need Phase 10 work after Phase 9 moved `GrainToggle` to the FilterBar?

**Verdict:** **No Phase 10 work needed on CohortRetentionCard.** Verified by reading:
- `CohortRetentionCard.svelte` (line 11): `let { data }: { data: RetentionRow[] } = $props();` — the card now accepts only the `data` prop. No grain prop.
- `retention_curve_v` (migration 0012 lines 21–64): weekly-only — no `grain` column. Period_weeks is the horizontal axis, which is independent of global grain.
- `+page.server.ts` (lines 86–90): `retention_curve_v` query has no date filter, so global range changes don't affect this card either.
- `+page.svelte` (line 146): `<CohortRetentionCard data={data.retention} />` — passes only `data`, no grain/range props.

The D-17 clamping hint should be a SUBTLE visual cue on the card when global grain≠week. Easiest: read `getFilters().grain` in CohortRetentionCard.svelte and conditionally render a small hint line under the existing `sparse-hint`. Phase 10 can choose to add this — it's UX polish not functional wiring.

## Existing Seed/Fixture Data Gaps

**Question:** Does `scripts/seed-demo-data.sql` cover Phase 10's new chart scenarios?

**Reviewed contents:**
- 8 card cohorts: A (7 visits), B (5), C (3), E (5), F (5), G (4), H (9), plus D/I/J/K..Y (1–2 each). Total ~64 rows + 3 cash.
- Visit count distribution: has 1st..9th visits across cards A/H, plus 1-visit singletons. **Covers buckets 1st through 8x+ at least once.** Bucket coverage is adequate.
- Cohort weeks: ~2 weekly cohorts (week 0 / week 1). **Insufficient for VA-09/10** — need at least 5 weekly cohorts with cohort_size ≥ 5 to trigger sparse filter + render a meaningful line.
- Cash rows: 3 cash transactions. **Insufficient for VA-04/05 cash segment** to render visibly — need at least 10–15 cash rows spread across days for the gray 9th segment to be non-trivial.
- **NO order items data.** `scripts/seed-demo-data.sql` only writes to `transactions` (line 165: `insert into public.transactions`). `stg_orderbird_order_items` is untouched. **VA-08 cannot render on demo data** without a seed extension.

**Required seed extensions for Phase 10:**
1. **Extend `scripts/seed-demo-data.sql`** to insert demo rows into `stg_orderbird_order_items` — one row per demo transaction with item_name from a small menu set (e.g., `'Tonkotsu Ramen'`, `'Miso Ramen'`, `'Shoyu Ramen'`, `'Gyoza'`, `'Edamame'`, `'Matcha Ice Cream'`, `'Beer'`, `'Sake'`). ~7–8 distinct items for VA-08 top-8 to render without "Other".
2. **Extend demo data to 90 days** (not just 14) so cohort charts VA-09/VA-10 have 12+ weekly cohorts to plot.
3. **Add 15–20 cash transactions** distributed across the 90-day window so VA-04/05 cash segment is visibly present at all grain levels.
4. **Add `e2eChartFixtures.ts` entries** for the 6 new charts (similar to `E2E_RETENTION_ROWS`) so Playwright E2E can bypass Supabase. Already-wired infrastructure in `+page.server.ts` (lines 20–43).

**Scope note:** Seed extension is a Phase 10 dependency, not a separate phase. Planner schedules it early (Wave 0).

## Performance Considerations

**Scenario:** 90-day window, daily grain, calendar revenue chart.
- Bars: 90 days × 9 segments (8 visit_seq + 1 cash) = 810 `<rect>` elements.
- At 375px canvas width with bandPadding=0.2: bar width ≈ 3.3px, gap ≈ 0.8px.
- **Readability:** 3.3px is below the typical 4px minimum for meaningful bars on mobile. Tap tolerance (~44px Apple guideline) means 3.3px bars can't be individually targeted.

**LayerChart rendering cost:**
- Svelte 5 `{#each}` + SVG `<rect>` rendering of 810 nodes: ~40ms on mid-tier mobile (measured on similar charts in LayerChart examples).
- Total Phase 10 chart load: 6 charts × ~50ms = 300ms additional paint budget. Combined with SSR TTFB + hydration, first-paint risk is ~1.5–2s on 4G phone.
- **Verdict:** LayerChart at this scale is fine. No virtualization needed.

**Mitigations:**
1. **D-22 soft cap: clamp grain to weekly when range >90d.** Planner implements this in `FilterBar.svelte` or a derived helper. At weekly grain × 365d = 52 bars × 9 segments = 468 rects. Readable.
2. **D-11 lazy-mount** cuts first-paint by deferring 3–4 below-fold charts.
3. **Keep bandPadding low** (0.2 not 0.4 default) — more ink budget for bars.

## Sources

### Primary (HIGH confidence)
- `node_modules/layerchart/dist/components/charts/BarChart.svelte` — verified BarChart props, series API, seriesLayout='stack' support (lines 1–136, 168–204).
- `node_modules/layerchart/dist/components/charts/BarChart.svelte.test.js` — stacked + grouped + stackDiverging + horizontal orientation all working (lines 92–167).
- `node_modules/layerchart/dist/components/charts/types.d.ts` — SeriesData type shape (lines 4–20).
- `node_modules/layerchart/dist/states/series.svelte.d.ts` — StackLayout type (lines 5, 37–60).
- `node_modules/layerchart/dist/components/Bars.svelte` — confirmed seriesKey, stackPadding props.
- `node_modules/d3-scale-chromatic/src/index.js` — verified `interpolateBlues`, `schemeTableau10` exports.
- `supabase/migrations/0010_cohort_mv.sql` — canonical MV+wrapper template.
- `supabase/migrations/0012_leaf_views.sql` — retention_curve_v shape (weekly only).
- `supabase/migrations/0013_refresh_function_and_cron.sql` — refresh_analytics_mvs() pattern.
- `supabase/migrations/0020_visit_attribution_mv.sql` — visit_attribution_mv shape; template for test_* helpers.
- `supabase/migrations/0022_transactions_filterable_v_is_cash.sql` — view to extend.
- `scripts/ingest/normalize.ts:185` — confirms `source_tx_id = invoice_number` join key.
- `src/lib/dashboardStore.svelte.ts` — DailyRow type, aggregateByBucket pattern.
- `src/lib/components/CohortRetentionCard.svelte` — LayerChart 2.x usage pattern.
- `src/lib/sparseFilter.ts` — pickVisibleCohorts to reuse for VA-09/10.
- `src/routes/+page.server.ts` — SSR fan-out pattern, E2E fixture bypass infrastructure.
- `playwright.config.ts` — 375×667 mobile viewport setup.
- `.planning/phases/10-charts/10-CONTEXT.md` — locked D-01..D-22.
- `.planning/phases/04-mobile-reader-ui/04-CONTEXT.md` — empty-state pattern (D-20), touch tooltip (D-15).
- `.planning/phases/08-visit-attribution-data-model/08-CONTEXT.md` — visit_attribution_mv shape.
- `.planning/phases/09-filter-simplification-performance/09-CONTEXT.md` — fetch-once client-rebucket pattern, global GrainToggle.
- `CLAUDE.md` §Supporting Libraries — LayerChart, shadcn-svelte, date-fns; §Critical Gotchas RLS+MV, REFRESH CONCURRENTLY.

### Secondary (MEDIUM confidence)
- D-11 IntersectionObserver lazy-mount pattern — general Svelte 5 community idiom; Pattern 4 snippet is best-practice but unlogged for this specific project yet.
- ~2000 customer estimate for payload size — derived from rough 180d × 50tx/d × 30% card × 50% dedup. Needs validation against real CSV.
- 300ms 6-chart mount estimate — from general LayerChart examples, not measured on this app yet. Planner Measurement Task.

### Tertiary (LOW confidence)
- None. All load-bearing claims verified against either installed source or migrations.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework (unit + integration) | Vitest `^4.1.4` |
| Framework (e2e) | `@playwright/test ^1.59.1` at 375×667 mobile-chrome |
| Config files | `vitest.config.ts` (assumed present per package.json scripts), `playwright.config.ts` verified |
| Quick run command | `npm run test:unit` |
| Integration command | `npm run test:integration` (needs TEST Supabase project) |
| E2E command | `npm run test:e2e` (with `E2E_FIXTURES=1` pre-set in `playwright.config.ts:44`) |
| Guards command | `npm run test:guards` |
| Full suite command | `npm test && npm run test:e2e && npm run test:guards` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VA-04 | Calendar revenue stacked by visit_seq, 9 segments, honors both filters, respects grain | unit (aggregator) | `npx vitest run tests/unit/dashboardStoreVisitSeq.test.ts` | ❌ Wave 0 |
| VA-04 | Calendar revenue renders at 375px with correct bar count and segment colors | e2e (visual) | `npx playwright test tests/e2e/charts-all.spec.ts -g "VA-04"` | ❌ Wave 0 |
| VA-05 | Calendar customer counts (tx_count metric instead of revenue) | unit (aggregator) | same `dashboardStoreVisitSeq.test.ts` (tests metric='tx_count') | ❌ Wave 0 |
| VA-05 | Calendar counts renders at 375px | e2e | `npx playwright test tests/e2e/charts-all.spec.ts -g "VA-05"` | ❌ Wave 0 |
| VA-06 | CohortRetentionCard carries forward (existing test) | e2e (regression) | `npx playwright test tests/e2e/charts-with-data.spec.ts` | ✅ exists |
| VA-06 | Optional: inline weekly-clamp hint when global grain=day | unit (component) | `npx vitest run tests/unit/CohortRetentionCard.test.ts` | ❌ Wave 0 |
| VA-07 | LTV histogram 6 bins, correct customer counts per bin | unit (ltvBins.binCustomerRevenue) | `npx vitest run tests/unit/ltvHistogram.test.ts` | ❌ Wave 0 |
| VA-07 | LTV histogram renders at 375px with empty / sparse / populated states | e2e | `npx playwright test tests/e2e/charts-all.spec.ts -g "VA-07"` | ❌ Wave 0 |
| VA-08 | Item counts daily MV joins item_name with transactions + visit_attribution | integration (DB shape) | `npx vitest run tests/integration/phase10-charts.test.ts -t "item_counts_daily_mv"` | ❌ Wave 0 |
| VA-08 | Top-8 + "Other" client-side rollup | unit | `npx vitest run tests/unit/itemCountsRollup.test.ts` | ❌ Wave 0 |
| VA-08 | Renders at 375px | e2e | `npx playwright test tests/e2e/charts-all.spec.ts -g "VA-08"` | ❌ Wave 0 |
| VA-09 | Cohort total revenue GROUP BY client-side, sparse filter applied | unit | `npx vitest run tests/unit/cohortAgg.test.ts -t "revenue"` | ❌ Wave 0 |
| VA-09 | Cohort total revenue renders at 375px; sparse-hint shown when data insufficient | e2e | `npx playwright test tests/e2e/charts-all.spec.ts -g "VA-09"` | ❌ Wave 0 |
| VA-10 | Cohort avg LTV GROUP BY client-side | unit | `npx vitest run tests/unit/cohortAgg.test.ts -t "avg"` | ❌ Wave 0 |
| VA-10 | Renders at 375px | e2e | `npx playwright test tests/e2e/charts-all.spec.ts -g "VA-10"` | ❌ Wave 0 |
| — | `customer_ltv_mv` tenant isolation (tenant A can't read tenant B) | integration | `npx vitest run tests/integration/phase10-charts.test.ts -t "tenant isolation"` | ❌ Wave 0 |
| — | `item_counts_daily_mv` tenant isolation | integration | same file, same describe | ❌ Wave 0 |
| — | `refresh_analytics_mvs()` runs new MVs in correct order | integration | `npx vitest run tests/integration/phase10-charts.test.ts -t "refresh ordering"` | ❌ Wave 0 |
| — | `transactions_filterable_v` exposes `visit_seq` + `card_hash` | integration | `npx vitest run tests/integration/phase10-charts.test.ts -t "visit_seq column"` | ❌ Wave 0 |
| — | CI guard: no raw `customer_ltv_mv` or `item_counts_daily_mv` references from `src/` | guards | `bash scripts/ci-guards.sh` | ✅ guard script exists; **may need regex update** |
| — | Raw MVs still REVOKED from authenticated | integration | `tests/integration/tenant-isolation.test.ts` (extend) | ✅ file exists, extend |

### Sampling Rate
- **Per task commit:** `npm run test:unit && npm run test:guards` (≤30s total).
- **Per wave merge:** full suite — `npm test && npm run test:e2e && npm run test:integration && npm run test:guards`.
- **Phase gate:** Full suite green AND manual 375px UAT on DEV (CF Pages preview) before `/gsd:verify-work`.

### Wave 0 Gaps

**Test files to create:**
- [ ] `tests/unit/dashboardStoreVisitSeq.test.ts` — `aggregateByBucketAndVisitSeq()` + `visitSeqBucket()` + `shapeForChart()` pure-function tests. Fixture with visit_seq=1..9+NULL across 2 weeks. ~8 tests.
- [ ] `tests/unit/ltvHistogram.test.ts` — `LTV_BINS` coverage + `binCustomerRevenue()` boundary tests (0, 999, 1000, 2499, 25000, MAX). ~6 tests.
- [ ] `tests/unit/chartPalettes.test.ts` — `VISIT_SEQ_COLORS.length === 8`, colors distinct, `ITEM_COLORS.length === 8`. ~3 tests.
- [ ] `tests/unit/cohortAgg.test.ts` — client-side GROUP BY revenue SUM + AVG; sparse-filter integration. ~5 tests.
- [ ] `tests/unit/itemCountsRollup.test.ts` — top-8 + "Other" rollup helper for VA-08. ~4 tests.
- [ ] `tests/unit/CohortRetentionCard.test.ts` (optional) — weekly-clamp hint when grain=day. ~2 tests.
- [ ] `tests/integration/phase10-charts.test.ts` — new MV shape assertions + tenant isolation + refresh ordering + view extension column check. Covers:
  - `customer_ltv_mv` shape (one row per customer, correct cohort_week)
  - `customer_ltv_v` tenant isolation (2-tenant test using Phase 3 fixture pattern)
  - `item_counts_daily_mv` shape (row per date×item×sales_type×is_cash)
  - `item_counts_daily_v` tenant isolation
  - `transactions_filterable_v` has `visit_seq` + `card_hash` columns
  - `refresh_analytics_mvs()` calls all 5 MVs in DAG order (assert ordering via cohort_week propagation test: insert fresh row → refresh → customer_ltv_mv has expected cohort_week)
  - ~10 tests.
- [ ] `tests/e2e/charts-all.spec.ts` — 6 new charts × 3 states (empty, sparse, populated) at 375px, tap-tooltip smoke, no console errors. ~18 tests.
- [ ] `src/lib/e2eChartFixtures.ts` extension — add `E2E_CUSTOMER_LTV_ROWS`, `E2E_ITEM_COUNTS_ROWS`, extend SSR bypass in `+page.server.ts` lines 20–43.
- [ ] `scripts/seed-demo-data.sql` extension — add 90-day history, 15+ cash rows, `stg_orderbird_order_items` seed.

**Framework install:** None — Vitest + Playwright already configured.

**Guards update:**
- [ ] `scripts/ci-guards.sh` Guard 1 regex allowlist extension — confirm new MV names (`customer_ltv_mv`, `item_counts_daily_mv`) are permitted inside `supabase/migrations/` but BLOCKED from `src/`. Verify with a negative test (attempt to import from src, assert guard fails).

## Sources

### Primary (HIGH confidence)
- **LayerChart 2.x source** — verified all component signatures by reading installed `node_modules/layerchart/dist/components/charts/BarChart.svelte` + `BarChart.svelte.test.js` + `types.d.ts` + `states/series.svelte.d.ts`. Zero ambiguity.
- **Project migrations** — `0010_cohort_mv.sql`, `0012_leaf_views.sql`, `0013_refresh_function_and_cron.sql`, `0020_visit_attribution_mv.sql`, `0022_transactions_filterable_v_is_cash.sql` all read in full.
- **Project source** — `dashboardStore.svelte.ts`, `CohortRetentionCard.svelte`, `sparseFilter.ts`, `+page.server.ts`, `+page.svelte` all read in full.
- **CLAUDE.md** — project conventions, tech stack, forbidden patterns.
- **Phase predecessor contexts** — 04, 08, 09 CONTEXT.md read in full.
- **package.json + .planning/config.json** — verified nyquist_validation enabled, tech stack pinned.

### Secondary (MEDIUM confidence)
- Svelte 5 IntersectionObserver pattern — consensus idiom, not project-specific. Pattern 4 snippet is standard.
- Customer count estimate (~2000) for D-21 payload analysis — derived, not measured. Planner verifies.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — all versions verified against installed package.json; LayerChart stacked-bar API confirmed via source inspection.
- Architecture: **HIGH** — new MV shapes follow existing `cohort_mv` template; view extension pattern established in Phase 9.
- Pitfalls: **HIGH** — RLS/MV, REFRESH CONCURRENTLY, LayerChart scale.copy all documented in existing code + CLAUDE.md.
- Runtime state: **HIGH** — phase is pure additive (2 new MVs, view extension, UI composition).
- Validation: **HIGH** — existing test infrastructure is complete; Wave 0 gaps are net-new files, not framework setup.

**Research date:** 2026-04-17
**Valid until:** 2026-05-17 (30 days — stack is stable, LayerChart pre-1.0 is the only watch item)

## Concerns

None that warrant re-opening locked decisions. A few observations for the planner:

1. **D-11 (lazy-mount) is marked stretch goal.** Recommend planner includes a Measurement Task first (~15min) and only adds `LazyMount` if measured first-paint >1.5s on mobile Chrome 375px. Saves complexity if measurement green-lights eager.

2. **STATE.md Blocker "CF Pages deploy pipeline broken since a3623b9"** was flagged for Phase 6 and never closed. Phase 10 UAT at 375px on DEV is the exact same verification step. Recommend planner adds an early "unblock CF Pages preview" task (could be <1hr) before scheduling 375px UAT, or makes peace with local-preview-only verification + separate UAT gap-closure plan.

3. **Seed data gap for VA-08 is real and load-bearing.** Without extending `scripts/seed-demo-data.sql` to write `stg_orderbird_order_items`, the item counts chart has no data to render — and the real DEV database may or may not have items (depends on whether the loader has run in DEV with real CSV). Recommend planner schedules the seed extension as Wave 0, before the migration tasks, so DEV has rendering data from task 1.

4. **One edge case the planner should verify:** when `cashFilter === 'cash'` is selected, `customer_ltv_v` returns zero rows (all cash customers have `card_hash IS NULL`, so they're excluded from `cohort_mv`). VA-07/09/10 will all empty-state. Is that the desired UX? The empty-state copy in D-18 says "LTV histogram needs at least one non-cash customer with ≥1 transaction." — so yes, but planner should verify VA-09/VA-10 have matching copy. Minor, but user-visible.

---

*Phase: 10-charts*
*Research: 2026-04-17*
*Valid until: 2026-05-17*
