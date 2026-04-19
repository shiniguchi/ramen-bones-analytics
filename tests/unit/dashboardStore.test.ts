import { describe, it, expect } from 'vitest';
import {
  bucketKey, filterRows, aggregateByBucket, computeKpiTotals,
  initStore, getFilters, getWindow,
  setSalesType, setCashFilter, setGrain, setRangeId, setRange
} from '../../src/lib/dashboardStore.svelte';
import type { DailyRow } from '../../src/lib/dashboardStore.svelte';
import type { FiltersState } from '../../src/lib/filters';

// Phase 9 Plan 01 — dashboard store pure function tests.
// These test filter/bucket/aggregate logic independent of Svelte reactivity.

// Fixture: 10 rows across 3 weeks with mixed sales_type and is_cash
const ROWS: DailyRow[] = [
  { business_date: '2026-04-06', gross_cents: 1000, sales_type: 'INHOUSE',  is_cash: false },
  { business_date: '2026-04-07', gross_cents: 2000, sales_type: 'TAKEAWAY', is_cash: true },
  { business_date: '2026-04-08', gross_cents: 1500, sales_type: 'INHOUSE',  is_cash: false },
  { business_date: '2026-04-09', gross_cents: 3000, sales_type: 'INHOUSE',  is_cash: true },
  { business_date: '2026-04-10', gross_cents: 500,  sales_type: 'TAKEAWAY', is_cash: false },
  { business_date: '2026-04-13', gross_cents: 2500, sales_type: 'INHOUSE',  is_cash: false },
  { business_date: '2026-04-14', gross_cents: 1200, sales_type: 'TAKEAWAY', is_cash: true },
  { business_date: '2026-04-15', gross_cents: 800,  sales_type: 'INHOUSE',  is_cash: false },
  { business_date: '2026-04-16', gross_cents: 4000, sales_type: 'INHOUSE',  is_cash: true },
  { business_date: '2026-04-16', gross_cents: 600,  sales_type: 'TAKEAWAY', is_cash: false },
];

describe('bucketKey', () => {
  it('day grain returns date as-is', () => {
    expect(bucketKey('2026-04-14', 'day')).toBe('2026-04-14');
  });

  it('week grain returns Monday of that week (ISO week, weekStartsOn: 1)', () => {
    // 2026-04-16 is a Thursday → Monday is 2026-04-13
    expect(bucketKey('2026-04-16', 'week')).toBe('2026-04-13');
  });

  it('month grain returns yyyy-MM', () => {
    expect(bucketKey('2026-04-16', 'month')).toBe('2026-04');
  });
});

describe('filterRows', () => {
  it('salesType=INHOUSE returns only INHOUSE rows', () => {
    const result = filterRows(ROWS, 'INHOUSE', 'all', '2026-04-01', '2026-04-30');
    expect(result.every(r => r.sales_type === 'INHOUSE')).toBe(true);
    expect(result).toHaveLength(6);
  });

  it('cashFilter=cash returns only rows where is_cash=true', () => {
    const result = filterRows(ROWS, 'all', 'cash', '2026-04-01', '2026-04-30');
    expect(result.every(r => r.is_cash === true)).toBe(true);
    expect(result).toHaveLength(4);
  });

  it('both filters compose additively (INHOUSE + cash)', () => {
    const result = filterRows(ROWS, 'INHOUSE', 'cash', '2026-04-01', '2026-04-30');
    expect(result.every(r => r.sales_type === 'INHOUSE' && r.is_cash === true)).toBe(true);
    expect(result).toHaveLength(2); // rows at 04-09 and 04-16
  });

  it('cashFilter=card returns only rows where is_cash=false', () => {
    const result = filterRows(ROWS, 'all', 'card', '2026-04-01', '2026-04-30');
    expect(result.every(r => r.is_cash === false)).toBe(true);
    expect(result).toHaveLength(6);
  });

  it('date window filters rows outside range', () => {
    const result = filterRows(ROWS, 'all', 'all', '2026-04-13', '2026-04-16');
    expect(result).toHaveLength(5); // 4/13, 4/14, 4/15, 4/16 (x2)
  });
});

describe('aggregateByBucket', () => {
  it('groups filtered rows by grain bucket, sums gross_cents and counts', () => {
    const weekRows = filterRows(ROWS, 'all', 'all', '2026-04-06', '2026-04-12');
    const buckets = aggregateByBucket(weekRows, 'week');
    // All 5 rows from 04-06..04-10 fall in week starting 04-06
    const entry = buckets.get('2026-04-06');
    expect(entry).toBeDefined();
    expect(entry!.revenue_cents).toBe(1000 + 2000 + 1500 + 3000 + 500);
    expect(entry!.tx_count).toBe(5);
  });

  it('returns empty Map for empty input', () => {
    const buckets = aggregateByBucket([], 'day');
    expect(buckets.size).toBe(0);
  });

  it('day grain produces one bucket per date', () => {
    const buckets = aggregateByBucket(ROWS, 'day');
    // 2026-04-16 has two rows → should merge into one bucket
    const apr16 = buckets.get('2026-04-16');
    expect(apr16).toBeDefined();
    expect(apr16!.revenue_cents).toBe(4000 + 600);
    expect(apr16!.tx_count).toBe(2);
  });

  it('month grain groups all rows into one bucket', () => {
    const buckets = aggregateByBucket(ROWS, 'month');
    expect(buckets.size).toBe(1);
    const apr = buckets.get('2026-04');
    expect(apr).toBeDefined();
    expect(apr!.tx_count).toBe(10);
  });
});

describe('computeKpiTotals', () => {
  it('returns revenue_cents sum and tx_count for filtered rows', () => {
    const result = computeKpiTotals(ROWS, []);
    expect(result.revenue_cents).toBe(17100);
    expect(result.tx_count).toBe(10);
    expect(result.prior_revenue_cents).toBe(0);
    expect(result.prior_tx_count).toBe(0);
  });

  it('with prior window returns both current and prior totals', () => {
    const current = ROWS.filter(r => r.business_date >= '2026-04-13');
    const prior = ROWS.filter(r => r.business_date < '2026-04-13');
    const result = computeKpiTotals(current, prior);
    expect(result.revenue_cents).toBe(2500 + 1200 + 800 + 4000 + 600);
    expect(result.tx_count).toBe(5);
    expect(result.prior_revenue_cents).toBe(1000 + 2000 + 1500 + 3000 + 500);
    expect(result.prior_tx_count).toBe(5);
  });
});

// Phase 9 Plan 04 — reactive filters state tests.
// Fix UAT 7/9: data.filters is frozen at SSR; store.getFilters() tracks clicks.
describe('reactive filters state', () => {
  // Helper to produce a full seed for initStore with a controllable filters object.
  const seed = (filters: FiltersState) => ({
    dailyRows: [] as DailyRow[],
    window: { from: '2026-04-10', to: '2026-04-16', priorFrom: null, priorTo: null },
    grain: filters.grain,
    salesType: filters.sales_type,
    cashFilter: filters.is_cash,
    filters
  });

  const baseFilters: FiltersState = {
    range: '7d',
    grain: 'week',
    sales_type: 'all',
    is_cash: 'all',
    interp: 'log-linear'
  };

  it('Test A: getFilters() returns seeded object after initStore', () => {
    initStore(seed({ ...baseFilters, range: '30d', sales_type: 'INHOUSE' }));
    const f = getFilters();
    expect(f.range).toBe('30d');
    expect(f.sales_type).toBe('INHOUSE');
    expect(f.grain).toBe('week');
    expect(f.is_cash).toBe('all');
  });

  it("Test B: setSalesType('INHOUSE') updates getFilters().sales_type", () => {
    initStore(seed(baseFilters));
    setSalesType('INHOUSE');
    expect(getFilters().sales_type).toBe('INHOUSE');
  });

  it("Test C: setCashFilter('cash') updates getFilters().is_cash", () => {
    initStore(seed(baseFilters));
    setCashFilter('cash');
    expect(getFilters().is_cash).toBe('cash');
  });

  it("Test D: setGrain('day') updates getFilters().grain", () => {
    initStore(seed(baseFilters));
    setGrain('day');
    expect(getFilters().grain).toBe('day');
  });

  it('Test E: setRange (window-based) does NOT change getFilters().range/from/to by itself', () => {
    initStore(seed({ ...baseFilters, range: '7d' }));
    const rangeBefore = getFilters().range;
    const fromBefore = getFilters().from;
    const toBefore = getFilters().to;
    setRange({ from: '2026-01-01', to: '2026-01-31', priorFrom: null, priorTo: null });
    expect(getFilters().range).toBe(rangeBefore);
    expect(getFilters().from).toBe(fromBefore);
    expect(getFilters().to).toBe(toBefore);
  });

  it("Test F: setRangeId('30d') sets range to 30d and clears from/to", () => {
    initStore(seed({
      ...baseFilters,
      range: 'custom',
      from: '2026-01-01',
      to: '2026-01-31'
    }));
    setRangeId('30d');
    const f = getFilters();
    expect(f.range).toBe('30d');
    expect(f.from).toBeUndefined();
    expect(f.to).toBeUndefined();
  });

  it("Test G: setRangeId('custom', {from,to}) sets range=custom and stores from/to", () => {
    initStore(seed(baseFilters));
    setRangeId('custom', { from: '2026-03-01', to: '2026-03-15' });
    const f = getFilters();
    expect(f.range).toBe('custom');
    expect(f.from).toBe('2026-03-01');
    expect(f.to).toBe('2026-03-15');
  });

  it('Test H: combined setSalesType + setCashFilter composes (UAT Test 9 proof)', () => {
    initStore(seed(baseFilters));
    setSalesType('INHOUSE');
    setCashFilter('cash');
    const f = getFilters();
    expect(f.sales_type).toBe('INHOUSE');
    expect(f.is_cash).toBe('cash');
    // Defaults untouched
    expect(f.range).toBe('7d');
    expect(f.grain).toBe('week');
  });
});

// Phase 9 Plan 05 — reactive window getter tests.
// Fix UAT Test 7: DatePickerPopover subtitle reads from data.window (frozen SSR).
// getWindow() exposes the reactive window so the subtitle tracks range clicks.
describe('getWindow', () => {
  it('W1: returns seeded window after initStore', () => {
    initStore({
      dailyRows: [],
      window: { from: '2026-04-10', to: '2026-04-16', priorFrom: null, priorTo: null },
      grain: 'week',
      salesType: 'all',
      cashFilter: 'all',
      filters: { range: '7d', grain: 'week', sales_type: 'all', is_cash: 'all', interp: 'log-linear' }
    });
    const w = getWindow();
    expect(w.from).toBe('2026-04-10');
    expect(w.to).toBe('2026-04-16');
    expect(w.priorFrom).toBeNull();
    expect(w.priorTo).toBeNull();
  });

  it('W2: reflects setRange() output', () => {
    initStore({
      dailyRows: [],
      window: { from: '2026-04-10', to: '2026-04-16', priorFrom: null, priorTo: null },
      grain: 'week',
      salesType: 'all',
      cashFilter: 'all',
      filters: { range: '7d', grain: 'week', sales_type: 'all', is_cash: 'all', interp: 'log-linear' }
    });
    setRange({ from: '2026-01-01', to: '2026-01-31', priorFrom: '2025-12-01', priorTo: '2025-12-31' });
    const w = getWindow();
    expect(w.from).toBe('2026-01-01');
    expect(w.to).toBe('2026-01-31');
    expect(w.priorFrom).toBe('2025-12-01');
    expect(w.priorTo).toBe('2025-12-31');
  });

  it('W3: returns a fresh object on every call (identity change)', () => {
    // Locks the object-identity-change invariant that $derived(getWindow())
    // in +page.svelte depends on. A memoized getter would return the same
    // reference twice and silently break DatePickerPopover subtitle reactivity.
    initStore({
      dailyRows: [],
      window: { from: '2026-04-10', to: '2026-04-16', priorFrom: null, priorTo: null },
      grain: 'week',
      salesType: 'all',
      cashFilter: 'all',
      filters: { range: '7d', grain: 'week', sales_type: 'all', is_cash: 'all', interp: 'log-linear' }
    });
    expect(getWindow()).not.toBe(getWindow());
  });
});
