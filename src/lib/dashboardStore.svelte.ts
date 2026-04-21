// dashboardStore.svelte.ts — Fetch-once + client-side rebucket reactive store.
// Phase 9: single Supabase query loads daily rows; grain/filter toggles
// re-slice data client-side without network round-trips.
// .svelte.ts extension required for $state/$derived runes outside .svelte files.

import { startOfWeek, startOfMonth, format, parseISO, addDays, addWeeks, addMonths } from 'date-fns';
import type { RangeWindow } from '$lib/dateRange';
import type { FiltersState } from '$lib/filters';
import { FILTER_DEFAULTS } from '$lib/filters';

// -- Types --

export type DailyRow = {
  business_date: string;   // YYYY-MM-DD
  gross_cents: number;
  sales_type: string | null;
  is_cash: boolean;
  visit_seq: number | null;   // NEW — NULL for cash / unattributed (Phase 10)
  card_hash: string | null;   // NEW — NULL for cash (Phase 10)
};

export type BucketAgg = {
  bucket: string;
  revenue_cents: number;
  tx_count: number;
};

export type KpiSummary = {
  revenue_cents: number;
  tx_count: number;
  prior_revenue_cents: number | null;
  prior_tx_count: number | null;
};

// -- Pure functions (exported for unit testing) --

/** Map a YYYY-MM-DD date string to its grain bucket key. */
export function bucketKey(date: string, grain: 'day' | 'week' | 'month'): string {
  if (grain === 'day') return date;
  const d = parseISO(date);
  if (grain === 'week') {
    // ISO Monday start (German locale)
    return format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd');
  }
  // month
  return format(startOfMonth(d), 'yyyy-MM');
}

/** Every bucket key expected in [from, to] at the given grain, in ascending order.
 *  Used to zero-fill missing buckets so filtered-out / no-data periods still render
 *  as a visible 0 bar instead of silently disappearing from the x-axis. */
export function bucketRange(from: string, to: string, grain: 'day' | 'week' | 'month'): string[] {
  const keys: string[] = [];
  const fromD = parseISO(from);
  const toD = parseISO(to);
  if (fromD > toD) return keys;
  if (grain === 'day') {
    for (let d = fromD; d <= toD; d = addDays(d, 1)) keys.push(format(d, 'yyyy-MM-dd'));
  } else if (grain === 'week') {
    const end = startOfWeek(toD, { weekStartsOn: 1 });
    for (let d = startOfWeek(fromD, { weekStartsOn: 1 }); d <= end; d = addWeeks(d, 1)) {
      keys.push(format(d, 'yyyy-MM-dd'));
    }
  } else {
    const end = startOfMonth(toD);
    for (let d = startOfMonth(fromD); d <= end; d = addMonths(d, 1)) keys.push(format(d, 'yyyy-MM'));
  }
  return keys;
}

/** Short display label for a bucket key — drops year so labels fit on 375px viewports.
 *  'yyyy-MM-dd' → 'MMM d' (e.g., 'Feb 16') for day/week grain.
 *  'yyyy-MM'    → 'MMM'   (e.g., 'Feb')    for month grain. */
export function formatBucketLabel(bucket: string, grain: 'day' | 'week' | 'month'): string {
  return grain === 'month' ? format(parseISO(bucket + '-01'), 'MMM') : format(parseISO(bucket), 'MMM d');
}

/** Min per-bar slot width — keeps bars tappable on mobile. Bar ≈ slot × (1 - bandPadding). */
export const MIN_BAR_SLOT_PX = 28;
/** Reserved for y-axis + right margin inside the chart. */
export const CHART_AXIS_PAD_PX = 48;
/** Target number of x-axis tick labels — d3 thins scaleBand domain evenly to this count. */
export const MAX_X_TICKS = 8;

/** Decide whether a bar chart with `barCount` bars needs explicit width + horizontal scroll,
 *  given the container's inner width. Returns undefined when the chart should stay responsive
 *  (bars fit comfortably), otherwise returns the total pixel width to force — caller wraps
 *  the chart in an overflow-x-auto div and passes `width={result}` to the chart.
 *
 *  @param barCount     — number of bars / buckets the chart will render
 *  @param containerPx  — clientWidth of the card's chart wrapper (use bind:clientWidth)
 *  @param minSlotPx    — override min per-bar slot (default MIN_BAR_SLOT_PX)
 *  @param axisPad      — override y-axis + right margin reservation (default CHART_AXIS_PAD_PX)
 */
export function computeChartWidth(
  barCount: number,
  containerPx: number,
  minSlotPx: number = MIN_BAR_SLOT_PX,
  axisPad: number = CHART_AXIS_PAD_PX
): number | undefined {
  if (containerPx <= 0 || barCount <= 0) return undefined;
  const plotAreaPx = Math.max(0, containerPx - axisPad);
  const requiredPlotPx = barCount * minSlotPx;
  if (requiredPlotPx <= plotAreaPx) return undefined; // fits, let Chart auto-size
  return requiredPlotPx + axisPad;
}

/** Filter rows by sales_type, cash/card, date window, and day-of-week.
 *  days: 1=Mon..7=Sun. Empty array filters out everything; [1..7] is a no-op.
 *  quick-260420-wdf. */
export function filterRows(
  rows: DailyRow[],
  salesType: 'all' | 'INHOUSE' | 'TAKEAWAY',
  cashFilter: 'all' | 'cash' | 'card',
  dateFrom: string,
  dateTo: string,
  days: number[] = [1, 2, 3, 4, 5, 6, 7]
): DailyRow[] {
  const allDays = days.length === 7;
  const daySet = allDays ? null : new Set(days);
  return rows.filter((r) => {
    // Date window (inclusive)
    if (r.business_date < dateFrom || r.business_date > dateTo) return false;
    // Sales type filter
    if (salesType !== 'all' && r.sales_type !== salesType) return false;
    // Cash/card filter
    if (cashFilter === 'cash' && !r.is_cash) return false;
    if (cashFilter === 'card' && r.is_cash) return false;
    // Day-of-week filter (Mon=1..Sun=7). Skip parseISO when not filtering.
    if (daySet) {
      const dow = ((parseISO(r.business_date).getDay() + 6) % 7) + 1;
      if (!daySet.has(dow)) return false;
    }
    return true;
  });
}

/** Group rows by grain bucket, summing gross_cents and counting transactions. */
export function aggregateByBucket(
  rows: DailyRow[],
  grain: 'day' | 'week' | 'month'
): Map<string, BucketAgg> {
  const map = new Map<string, BucketAgg>();
  for (const r of rows) {
    const key = bucketKey(r.business_date, grain);
    const existing = map.get(key);
    if (existing) {
      existing.revenue_cents += r.gross_cents;
      existing.tx_count += 1;
    } else {
      map.set(key, { bucket: key, revenue_cents: r.gross_cents, tx_count: 1 });
    }
  }
  return map;
}

/** Bucket a visit_seq integer into a chart label per D-05. NULL = 'cash'. */
export function visitSeqBucket(visit_seq: number | null): string {
  if (visit_seq === null) return 'cash';
  if (visit_seq === 1) return '1st';
  if (visit_seq === 2) return '2nd';
  if (visit_seq === 3) return '3rd';
  if (visit_seq >= 8) return '8x+';
  return `${visit_seq}x`; // 4x, 5x, 6x, 7x
}

/** Aggregate filtered rows into nested map: bucket -> visit_seq_bucket -> { revenue, count }.
 *  Feeds both VA-04 (revenue_cents) and VA-05 (tx_count) via shapeForChart metric arg. */
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

/** Shape nested aggregation map into wide-format rows for LayerChart BarChart.
 *  Missing series keys filled with 0. Output sorted by bucket key ascending.
 *  When `expectedBuckets` is provided, buckets in that list but absent from `nested`
 *  are emitted as all-zero rows — so filtered-out / no-data periods render as visible
 *  zero bars instead of silently disappearing. */
export function shapeForChart(
  nested: Map<string, Map<string, { revenue_cents: number; tx_count: number }>>,
  metric: 'revenue_cents' | 'tx_count',
  expectedBuckets?: string[]
): Array<Record<string, string | number>> {
  const VISIT_KEYS = ['1st', '2nd', '3rd', '4x', '5x', '6x', '7x', '8x+', 'cash'] as const;
  const out: Array<Record<string, string | number>> = [];
  const buckets = expectedBuckets ?? Array.from(nested.keys());
  const seen = new Set<string>();
  for (const bucket of buckets) {
    seen.add(bucket);
    const inner = nested.get(bucket);
    const row: Record<string, string | number> = { bucket };
    for (const key of VISIT_KEYS) {
      row[key] = inner?.get(key)?.[metric] ?? 0;
    }
    out.push(row);
  }
  if (expectedBuckets) {
    // Include any unexpected bucket keys present in data but not listed (defensive).
    for (const [bucket, inner] of nested) {
      if (seen.has(bucket)) continue;
      const row: Record<string, string | number> = { bucket };
      for (const key of VISIT_KEYS) row[key] = inner.get(key)?.[metric] ?? 0;
      out.push(row);
    }
  }
  return out.sort((a, b) => String(a.bucket).localeCompare(String(b.bucket)));
}

/** Compute KPI totals for current and prior windows. */
export function computeKpiTotals(
  rows: DailyRow[],
  priorRows: DailyRow[]
): KpiSummary {
  const sum = (arr: DailyRow[]) => ({
    revenue: arr.reduce((s, r) => s + r.gross_cents, 0),
    count: arr.length
  });
  const current = sum(rows);
  const prior = sum(priorRows);
  return {
    revenue_cents: current.revenue,
    tx_count: current.count,
    prior_revenue_cents: prior.revenue,
    prior_tx_count: prior.count
  };
}

// -- Reactive state (module-level runes) --

let rawRows = $state<DailyRow[]>([]);
let cachedFrom = $state('');
let cachedTo = $state('');
let dateFrom = $state('');
let dateTo = $state('');
let grain = $state<'day' | 'week' | 'month'>('week');
let salesTypeFilter = $state<'all' | 'INHOUSE' | 'TAKEAWAY'>('all');
let cashFilter = $state<'all' | 'cash' | 'card'>('all');
let daysFilter = $state<number[]>([1, 2, 3, 4, 5, 6, 7]);
let priorFrom = $state<string | null>(null);
let priorTo = $state<string | null>(null);

// Reactive snapshot of FiltersState. Seeded by initStore from SSR data.filters;
// updated by every set* action so UI components reading getFilters() stay in sync
// with URL state. Fixes UAT Test 7/9 — filter clicks used to update URL + KPI
// math but leave FilterBar aria-checked + range labels frozen at SSR.
let _filters = $state<FiltersState>({ ...FILTER_DEFAULTS });

// -- Derived values --
// Svelte 5 forbids exporting $derived from modules. Use getter functions instead.

const _filtered = $derived.by(() =>
  filterRows(rawRows, salesTypeFilter, cashFilter, dateFrom, dateTo, daysFilter)
);

const _priorFiltered = $derived.by(() => {
  if (!priorFrom || !priorTo) return [];
  return filterRows(rawRows, salesTypeFilter, cashFilter, priorFrom, priorTo, daysFilter);
});

const _bucketed = $derived.by(() => aggregateByBucket(_filtered, grain));

const _kpiTotals = $derived.by(() => computeKpiTotals(_filtered, _priorFiltered));

/** Current-window filtered rows. */
export function getFiltered(): DailyRow[] { return _filtered; }
/** Prior-window filtered rows. */
export function getPriorFiltered(): DailyRow[] { return _priorFiltered; }
/** Bucketed aggregates for the current grain. */
export function getBucketed(): Map<string, BucketAgg> { return _bucketed; }
/** KPI totals for current + prior windows. */
export function getKpiTotals(): KpiSummary { return _kpiTotals; }
/** Current reactive filters state (range, grain, sales_type, is_cash, from, to).
 *  Read this in UI instead of `data.filters` (which is the frozen SSR snapshot). */
export function getFilters(): FiltersState { return _filters; }

/** Current reactive {from,to,priorFrom,priorTo} window driving KPI math.
 *  Updated by setRange() on every range click. UI components (e.g.
 *  DatePickerPopover's date subtitle) should read this instead of
 *  data.window (SSR-frozen). Fix for UAT Test 7.
 *  Returns a FRESH object literal every call — downstream $derived(getWindow())
 *  relies on identity change to re-run. Do NOT memoize. */
export function getWindow(): RangeWindow {
  return { from: dateFrom, to: dateTo, priorFrom, priorTo };
}

// -- Actions --

/** Initialize store from SSR-loaded data. */
export function initStore(data: {
  dailyRows: DailyRow[];
  window: { from: string; to: string; priorFrom: string | null; priorTo: string | null };
  grain: 'day' | 'week' | 'month';
  salesType: 'all' | 'INHOUSE' | 'TAKEAWAY';
  cashFilter: 'all' | 'cash' | 'card';
  daysFilter?: number[];
  filters: FiltersState;
}) {
  rawRows = data.dailyRows;
  dateFrom = data.window.from;
  dateTo = data.window.to;
  priorFrom = data.window.priorFrom;
  priorTo = data.window.priorTo;
  cachedFrom = data.window.from;
  cachedTo = data.window.to;
  grain = data.grain;
  salesTypeFilter = data.salesType;
  cashFilter = data.cashFilter;
  daysFilter = data.daysFilter ?? data.filters.days ?? [1, 2, 3, 4, 5, 6, 7];
  // Seed the reactive filters snapshot — replaces `data.filters` reads in UI paths.
  _filters = { ...data.filters };
}

export function setGrain(g: 'day' | 'week' | 'month') {
  grain = g;
  _filters = { ..._filters, grain: g };
}

export function setSalesType(v: 'all' | 'INHOUSE' | 'TAKEAWAY') {
  salesTypeFilter = v;
  _filters = { ..._filters, sales_type: v };
}

export function setCashFilter(v: 'all' | 'cash' | 'card') {
  cashFilter = v;
  _filters = { ..._filters, is_cash: v };
}

export function setDaysFilter(v: number[]) {
  daysFilter = v;
  _filters = { ..._filters, days: v };
}

export function setRange(window: RangeWindow) {
  dateFrom = window.from;
  dateTo = window.to;
  priorFrom = window.priorFrom;
  priorTo = window.priorTo;
}

/** Update the range identity (preset or 'custom'). For 'custom', pass {from,to}.
 *  For presets, clears any prior from/to so rangeLabel derivation stays clean. */
export function setRangeId(
  range: FiltersState['range'],
  custom?: { from: string; to: string }
) {
  if (range === 'custom' && custom) {
    _filters = { ..._filters, range, from: custom.from, to: custom.to };
  } else {
    _filters = { ..._filters, range, from: undefined, to: undefined };
  }
}

/** Check if the local cache covers the requested range (widest-window strategy). */
export function cacheCovers(from: string, to: string): boolean {
  return cachedFrom !== '' && from >= cachedFrom && to <= cachedTo;
}

/** Merge new rows into the cache and widen the cached range. */
export function updateCache(rows: DailyRow[], from: string, to: string) {
  // Deduplicate by composite key
  const merged = new Map<string, DailyRow>();
  for (const r of rawRows) merged.set(`${r.business_date}|${r.gross_cents}|${r.sales_type}|${r.is_cash}`, r);
  for (const r of rows) merged.set(`${r.business_date}|${r.gross_cents}|${r.sales_type}|${r.is_cash}`, r);
  rawRows = [...merged.values()];
  cachedFrom = from < cachedFrom || cachedFrom === '' ? from : cachedFrom;
  cachedTo = to > cachedTo || cachedTo === '' ? to : cachedTo;
}
