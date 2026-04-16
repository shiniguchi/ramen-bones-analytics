// dashboardStore.svelte.ts — Fetch-once + client-side rebucket reactive store.
// Phase 9: single Supabase query loads daily rows; grain/filter toggles
// re-slice data client-side without network round-trips.
// .svelte.ts extension required for $state/$derived runes outside .svelte files.

import { startOfWeek, startOfMonth, format, parseISO } from 'date-fns';
import type { RangeWindow } from '$lib/dateRange';

// -- Types --

export type DailyRow = {
  business_date: string;   // YYYY-MM-DD
  gross_cents: number;
  sales_type: string | null;
  is_cash: boolean;
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

/** Filter rows by sales_type, cash/card, and date window. */
export function filterRows(
  rows: DailyRow[],
  salesType: 'all' | 'INHOUSE' | 'TAKEAWAY',
  cashFilter: 'all' | 'cash' | 'card',
  dateFrom: string,
  dateTo: string
): DailyRow[] {
  return rows.filter((r) => {
    // Date window (inclusive)
    if (r.business_date < dateFrom || r.business_date > dateTo) return false;
    // Sales type filter
    if (salesType !== 'all' && r.sales_type !== salesType) return false;
    // Cash/card filter
    if (cashFilter === 'cash' && !r.is_cash) return false;
    if (cashFilter === 'card' && r.is_cash) return false;
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
let priorFrom = $state<string | null>(null);
let priorTo = $state<string | null>(null);

// -- Derived values --
// Svelte 5 forbids exporting $derived from modules. Use getter functions instead.

const _filtered = $derived.by(() =>
  filterRows(rawRows, salesTypeFilter, cashFilter, dateFrom, dateTo)
);

const _priorFiltered = $derived.by(() => {
  if (!priorFrom || !priorTo) return [];
  return filterRows(rawRows, salesTypeFilter, cashFilter, priorFrom, priorTo);
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

// -- Actions --

/** Initialize store from SSR-loaded data. */
export function initStore(data: {
  dailyRows: DailyRow[];
  window: { from: string; to: string; priorFrom: string | null; priorTo: string | null };
  grain: 'day' | 'week' | 'month';
  salesType: 'all' | 'INHOUSE' | 'TAKEAWAY';
  cashFilter: 'all' | 'cash' | 'card';
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
}

export function setGrain(g: 'day' | 'week' | 'month') {
  grain = g;
}

export function setSalesType(v: 'all' | 'INHOUSE' | 'TAKEAWAY') {
  salesTypeFilter = v;
}

export function setCashFilter(v: 'all' | 'cash' | 'card') {
  cashFilter = v;
}

export function setRange(window: RangeWindow) {
  dateFrom = window.from;
  dateTo = window.to;
  priorFrom = window.priorFrom;
  priorTo = window.priorTo;
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
