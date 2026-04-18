// cohortAgg — Pass 4 (quick-260418-4oh) VA-10 / VA-07 rewrite.
// Repeater classifier replaced by 8-bucket visit_count segmentation.
// (Pass 4 Task 4 already deleted cohortRevenueSum / cohortAvgLtv / *ByRepeater
//  pair; Task 5 adds visitCountBucket + VISIT_BUCKET_KEYS + cohortAvgLtvByVisitBucket.)
import { describe, it, expect } from 'vitest';
import {
  visitCountBucket,
  VISIT_BUCKET_KEYS,
  cohortAvgLtvByVisitBucket,
  type CustomerLtvRow
} from '../../src/lib/cohortAgg';
import { formatBucketLabel } from '../../src/lib/dashboardStore.svelte';

describe('visitCountBucket (Pass 4)', () => {
  it('1 → 1st', () => expect(visitCountBucket(1)).toBe('1st'));
  it('2 → 2nd', () => expect(visitCountBucket(2)).toBe('2nd'));
  it('3 → 3rd', () => expect(visitCountBucket(3)).toBe('3rd'));
  it('4..7 → Nx', () => {
    expect(visitCountBucket(4)).toBe('4x');
    expect(visitCountBucket(5)).toBe('5x');
    expect(visitCountBucket(6)).toBe('6x');
    expect(visitCountBucket(7)).toBe('7x');
  });
  it('8+ → 8x+', () => {
    expect(visitCountBucket(8)).toBe('8x+');
    expect(visitCountBucket(100)).toBe('8x+');
  });
  it('VISIT_BUCKET_KEYS has exactly 8 entries in declared order', () => {
    expect(VISIT_BUCKET_KEYS).toEqual(['1st', '2nd', '3rd', '4x', '5x', '6x', '7x', '8x+']);
  });
});

describe('cohortAvgLtvByVisitBucket (Pass 4 — VA-07/VA-10)', () => {
  // 10 customers in one cohort: 5 one-timers @ 1000c, 5 three-timers @ 3000c.
  const mixed: CustomerLtvRow[] = [
    ...Array.from({ length: 5 }, (_, i) => ({
      card_hash: `a${i}`,
      revenue_cents: 1000,
      visit_count: 1,
      cohort_week: '2026-01-05',
      cohort_month: '2026-01-01'
    })),
    ...Array.from({ length: 5 }, (_, i) => ({
      card_hash: `b${i}`,
      revenue_cents: 3000,
      visit_count: 3,
      cohort_week: '2026-01-05',
      cohort_month: '2026-01-01'
    }))
  ];

  it('splits averages by bucket; empty buckets are 0 not NaN', () => {
    const [row] = cohortAvgLtvByVisitBucket(mixed, 'week');
    expect(row.cohort).toBe('2026-01-05');
    expect(row.total_customers).toBe(10);
    expect(row['1st']).toBe(1000);
    expect(row['3rd']).toBe(3000);
    expect(row['2nd']).toBe(0);
    expect(row['4x']).toBe(0);
    expect(row['8x+']).toBe(0);
    for (const k of VISIT_BUCKET_KEYS) {
      expect(Number.isNaN(row[k])).toBe(false);
    }
  });

  it('all one-timers → 1st averaged, others 0', () => {
    const all1: CustomerLtvRow[] = Array.from({ length: 10 }, (_, i) => ({
      card_hash: `n${i}`,
      revenue_cents: 2000,
      visit_count: 1,
      cohort_week: '2026-01-05',
      cohort_month: '2026-01-01'
    }));
    const [row] = cohortAvgLtvByVisitBucket(all1, 'week');
    expect(row['1st']).toBe(2000);
    for (const k of VISIT_BUCKET_KEYS.filter((k) => k !== '1st')) {
      expect(row[k]).toBe(0);
    }
  });

  it('sparse-filters cohorts below SPARSE_MIN_COHORT_SIZE', () => {
    const sparse: CustomerLtvRow[] = Array.from({ length: 3 }, (_, i) => ({
      card_hash: `s${i}`,
      revenue_cents: 1000,
      visit_count: 1,
      cohort_week: '2026-02-02',
      cohort_month: '2026-02-01'
    }));
    expect(cohortAvgLtvByVisitBucket(sparse, 'week')).toHaveLength(0);
  });

  it('month grain rolls two weekly sub-cohorts into one YYYY-MM bucket', () => {
    const rows: CustomerLtvRow[] = [
      ...Array.from({ length: 5 }, (_, i) => ({
        card_hash: `j1${i}`,
        revenue_cents: 1000,
        visit_count: 1,
        cohort_week: '2026-01-12',
        cohort_month: '2026-01-15'
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        card_hash: `j2${i}`,
        revenue_cents: 2000,
        visit_count: 3,
        cohort_week: '2026-01-19',
        cohort_month: '2026-01-22'
      }))
    ];
    const [row] = cohortAvgLtvByVisitBucket(rows, 'month');
    expect(row.cohort).toBe('2026-01');
    expect(row['1st']).toBe(1000);
    expect(row['3rd']).toBe(2000);
    expect(row.total_customers).toBe(10);
  });

  // 260417-mp2 regression: month grain cohort must be length-7 so formatBucketLabel doesn't throw.
  it('month cohort field is YYYY-MM (length 7) and formatBucketLabel accepts it', () => {
    const rows: CustomerLtvRow[] = Array.from({ length: 5 }, (_, i) => ({
      card_hash: `m${i}`,
      revenue_cents: 2000,
      visit_count: 2,
      cohort_week: '2025-06-02',
      cohort_month: '2025-06-01'
    }));
    const [row] = cohortAvgLtvByVisitBucket(rows, 'month');
    expect(row.cohort).toHaveLength(7);
    expect(() => formatBucketLabel(row.cohort, 'month')).not.toThrow();
  });
});
