// Phase 10 Plan 01 — Nyquist RED scaffold for dashboardStore visit_seq extensions.
// Tests MUST fail until plan 10-04 adds visitSeqBucket/aggregateByBucketAndVisitSeq/shapeForChart
// exports (and the extended DailyRow type with visit_seq + card_hash) to
// src/lib/dashboardStore.svelte.ts.
import { describe, it, expect } from 'vitest';
import {
  visitSeqBucket,
  aggregateByBucketAndVisitSeq,
  shapeForChart,
  type DailyRow
} from '../../src/lib/dashboardStore.svelte';

describe('visitSeqBucket (D-05: 8 buckets + cash)', () => {
  it('maps NULL to "cash"', () => {
    expect(visitSeqBucket(null)).toBe('cash');
  });
  it('maps 1 to "1st", 2 to "2nd", 3 to "3rd"', () => {
    expect(visitSeqBucket(1)).toBe('1st');
    expect(visitSeqBucket(2)).toBe('2nd');
    expect(visitSeqBucket(3)).toBe('3rd');
  });
  it('maps 4..7 to "4x".."7x"', () => {
    expect(visitSeqBucket(4)).toBe('4x');
    expect(visitSeqBucket(5)).toBe('5x');
    expect(visitSeqBucket(6)).toBe('6x');
    expect(visitSeqBucket(7)).toBe('7x');
  });
  it('maps 8 and higher to "8x+"', () => {
    expect(visitSeqBucket(8)).toBe('8x+');
    expect(visitSeqBucket(100)).toBe('8x+');
  });
});

describe('aggregateByBucketAndVisitSeq', () => {
  const rows: DailyRow[] = [
    { business_date: '2026-04-13', gross_cents: 1000, sales_type: 'INHOUSE', is_cash: false, visit_seq: 1, card_hash: 'h1' },
    { business_date: '2026-04-13', gross_cents: 2000, sales_type: 'INHOUSE', is_cash: false, visit_seq: 2, card_hash: 'h2' },
    { business_date: '2026-04-13', gross_cents:  500, sales_type: 'INHOUSE', is_cash: true,  visit_seq: null, card_hash: null },
    { business_date: '2026-04-14', gross_cents: 1500, sales_type: 'INHOUSE', is_cash: false, visit_seq: 9, card_hash: 'h1' }
  ];

  it('daily grain: groups by business_date × visit_seq bucket', () => {
    const nested = aggregateByBucketAndVisitSeq(rows, 'day');
    expect(nested.get('2026-04-13')?.get('1st')).toEqual({ revenue_cents: 1000, tx_count: 1 });
    expect(nested.get('2026-04-13')?.get('2nd')).toEqual({ revenue_cents: 2000, tx_count: 1 });
    expect(nested.get('2026-04-13')?.get('cash')).toEqual({ revenue_cents: 500, tx_count: 1 });
    expect(nested.get('2026-04-14')?.get('8x+')).toEqual({ revenue_cents: 1500, tx_count: 1 });
  });

  it('weekly grain: 2026-04-13 is ISO Monday — all rows collapse into same week', () => {
    const nested = aggregateByBucketAndVisitSeq(rows, 'week');
    const week = nested.get('2026-04-13')!;
    expect(week).toBeDefined();
    expect(week.size).toBe(4); // 1st, 2nd, cash, 8x+
  });

  it('monthly grain: April 2026 — all rows collapse to 2026-04', () => {
    const nested = aggregateByBucketAndVisitSeq(rows, 'month');
    // month key format is implementation-specific; assert the monthly rollup has all 4 buckets.
    const months = Array.from(nested.keys());
    expect(months.length).toBe(1);
    const m = nested.get(months[0])!;
    expect(m.size).toBe(4);
  });
});

describe('shapeForChart (wide-format for stacked bar)', () => {
  it('wide-formats nested map with missing keys coerced to zero', () => {
    const nested = new Map([
      ['2026-04-13', new Map([['1st', { revenue_cents: 1000, tx_count: 1 }]])]
    ]);
    const shaped = shapeForChart(nested, 'revenue_cents');
    expect(shaped[0]).toMatchObject({ bucket: '2026-04-13', '1st': 1000, '2nd': 0, 'cash': 0, '8x+': 0 });
  });

  it('sorts buckets ascending by localeCompare', () => {
    const nested = new Map([
      ['2026-04-20', new Map([['1st', { revenue_cents: 100, tx_count: 1 }]])],
      ['2026-04-13', new Map([['1st', { revenue_cents: 200, tx_count: 1 }]])]
    ]);
    const shaped = shapeForChart(nested, 'revenue_cents');
    expect(shaped.map(r => r.bucket)).toEqual(['2026-04-13', '2026-04-20']);
  });

  it('metric=tx_count pulls count not revenue', () => {
    const nested = new Map([
      ['2026-04-13', new Map([['1st', { revenue_cents: 999, tx_count: 7 }]])]
    ]);
    const shaped = shapeForChart(nested, 'tx_count');
    expect(shaped[0]['1st']).toBe(7);
  });
});
