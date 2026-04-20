// cohortAgg — visit_count bucketing + repeater-cohort-count aggregation.
// (quick-260418-rpt replaces the old cohortAvgLtvByVisitBucket suite with the
//  repeater-count aggregator backing RepeaterCohortCountCard, feedback #6.)
import { describe, it, expect } from 'vitest';
import {
  visitCountBucket,
  VISIT_BUCKET_KEYS,
  REPEATER_BUCKET_KEYS,
  cohortRepeaterCountByVisitBucket,
  recomputeCustomerLtvFromTx,
  type CustomerLtvRow,
  type RepeaterTxRow
} from '../../src/lib/cohortAgg';
import { formatBucketLabel } from '../../src/lib/dashboardStore.svelte';

describe('visitCountBucket', () => {
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
  it('REPEATER_BUCKET_KEYS drops the "1st" bucket', () => {
    expect(REPEATER_BUCKET_KEYS).toEqual(['2nd', '3rd', '4x', '5x', '6x', '7x', '8x+']);
  });
});

describe('cohortRepeaterCountByVisitBucket (feedback #6)', () => {
  // 10 customers in one cohort: 5 one-timers, 5 three-timers.
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

  it('excludes first-timers (visit_count=1) from all buckets', () => {
    const [row] = cohortRepeaterCountByVisitBucket(mixed, 'week');
    expect(row.cohort).toBe('2026-01-05');
    expect(row.total_repeaters).toBe(5);
    expect(row['3rd']).toBe(5);
    // all other repeater buckets must be zero
    for (const k of REPEATER_BUCKET_KEYS.filter((k) => k !== '3rd')) {
      expect(row[k]).toBe(0);
    }
    // '1st' bucket is declared on the row shape but must always be 0 since we skip first-timers
    expect(row['1st']).toBe(0);
  });

  it('counts are integers (not averages)', () => {
    const [row] = cohortRepeaterCountByVisitBucket(mixed, 'week');
    for (const k of VISIT_BUCKET_KEYS) {
      expect(Number.isInteger(row[k])).toBe(true);
    }
  });

  it('sparse-filters cohorts with fewer than SPARSE_MIN_COHORT_SIZE repeaters', () => {
    // 4 repeaters only → below threshold of 5
    const sparse: CustomerLtvRow[] = Array.from({ length: 4 }, (_, i) => ({
      card_hash: `s${i}`,
      revenue_cents: 1000,
      visit_count: 2,
      cohort_week: '2026-02-02',
      cohort_month: '2026-02-01'
    }));
    expect(cohortRepeaterCountByVisitBucket(sparse, 'week')).toHaveLength(0);
  });

  it('cohorts with only first-timers are filtered out entirely (zero repeaters)', () => {
    const allFirstTime: CustomerLtvRow[] = Array.from({ length: 10 }, (_, i) => ({
      card_hash: `f${i}`,
      revenue_cents: 1000,
      visit_count: 1,
      cohort_week: '2026-02-09',
      cohort_month: '2026-02-01'
    }));
    expect(cohortRepeaterCountByVisitBucket(allFirstTime, 'week')).toHaveLength(0);
  });

  it('month grain rolls two weekly sub-cohorts into one YYYY-MM bucket', () => {
    const rows: CustomerLtvRow[] = [
      ...Array.from({ length: 3 }, (_, i) => ({
        card_hash: `j1${i}`,
        revenue_cents: 1000,
        visit_count: 2,
        cohort_week: '2026-01-12',
        cohort_month: '2026-01-15'
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        card_hash: `j2${i}`,
        revenue_cents: 2000,
        visit_count: 4,
        cohort_week: '2026-01-19',
        cohort_month: '2026-01-22'
      }))
    ];
    const [row] = cohortRepeaterCountByVisitBucket(rows, 'month');
    expect(row.cohort).toBe('2026-01');
    expect(row['2nd']).toBe(3);
    expect(row['4x']).toBe(3);
    expect(row.total_repeaters).toBe(6);
  });

  it('month cohort field is YYYY-MM (length 7) and formatBucketLabel accepts it', () => {
    const rows: CustomerLtvRow[] = Array.from({ length: 5 }, (_, i) => ({
      card_hash: `m${i}`,
      revenue_cents: 2000,
      visit_count: 2,
      cohort_week: '2025-06-02',
      cohort_month: '2025-06-01'
    }));
    const [row] = cohortRepeaterCountByVisitBucket(rows, 'month');
    expect(row.cohort).toHaveLength(7);
    expect(() => formatBucketLabel(row.cohort, 'month')).not.toThrow();
  });
});

describe('recomputeCustomerLtvFromTx', () => {
  const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

  it('empty input → empty output', () => {
    expect(recomputeCustomerLtvFromTx([], ALL_DAYS)).toEqual([]);
  });

  it('groups by card_hash and counts visits', () => {
    // 2025-07-14 is a Monday (DOW 1), 2025-07-16 Wed (3), 2025-07-19 Sat (6)
    const tx: RepeaterTxRow[] = [
      { card_hash: 'a', business_date: '2025-07-14', gross_cents: 1000 },
      { card_hash: 'a', business_date: '2025-07-16', gross_cents: 2000 },
      { card_hash: 'a', business_date: '2025-07-19', gross_cents: 3000 },
      { card_hash: 'b', business_date: '2025-07-14', gross_cents: 500 }
    ];
    const out = recomputeCustomerLtvFromTx(tx, ALL_DAYS);
    const a = out.find((r) => r.card_hash === 'a')!;
    expect(a.visit_count).toBe(3);
    expect(a.revenue_cents).toBe(6000);
    expect(a.cohort_month).toBe('2025-07-01');
    expect(a.cohort_week).toBe('2025-07-14'); // Mon of that week
    const b = out.find((r) => r.card_hash === 'b')!;
    expect(b.visit_count).toBe(1);
  });

  it('shifts cohort_month + visit_count when Mon/Tue excluded', () => {
    // Customer first visits on Monday, returns Thursday. Under days = Wed-Sun,
    // the Monday visit is excluded, so:
    //   - visit_count drops from 2 → 1
    //   - cohort shifts from the Monday's month to the Thursday's month
    //   - could also land them in a later month entirely
    const tx: RepeaterTxRow[] = [
      { card_hash: 'shift', business_date: '2025-06-30', gross_cents: 1000 }, // Mon
      { card_hash: 'shift', business_date: '2025-07-03', gross_cents: 1000 } // Thu
    ];
    const all = recomputeCustomerLtvFromTx(tx, ALL_DAYS);
    expect(all[0].visit_count).toBe(2);
    expect(all[0].cohort_month).toBe('2025-06-01');

    const wedSun = recomputeCustomerLtvFromTx(tx, [3, 4, 5, 6, 7]); // no Mon/Tue
    expect(wedSun[0].visit_count).toBe(1);
    expect(wedSun[0].cohort_month).toBe('2025-07-01'); // shifts to July
  });

  it('drops customers whose visits all fall on excluded days', () => {
    const tx: RepeaterTxRow[] = [
      { card_hash: 'monOnly', business_date: '2025-06-30', gross_cents: 1000 }, // Mon
      { card_hash: 'monOnly', business_date: '2025-07-07', gross_cents: 1000 } // Mon
    ];
    const out = recomputeCustomerLtvFromTx(tx, [3, 4, 5, 6, 7]); // no Mon/Tue
    expect(out).toEqual([]);
  });

  it('excludes April 2026 Worldline blackout window (2026-04-01..04-11)', () => {
    const tx: RepeaterTxRow[] = [
      { card_hash: 'x', business_date: '2026-03-30', gross_cents: 1000 }, // kept
      { card_hash: 'x', business_date: '2026-04-05', gross_cents: 1000 }, // blackout — dropped
      { card_hash: 'x', business_date: '2026-04-12', gross_cents: 1000 } // kept
    ];
    const out = recomputeCustomerLtvFromTx(tx, ALL_DAYS);
    expect(out[0].visit_count).toBe(2);
    expect(out[0].revenue_cents).toBe(2000);
  });

  it('DOW transform: Sunday encoded as 7 (Mon-first), not 0', () => {
    // 2025-06-29 is a Sunday (JS getDay() === 0)
    const tx: RepeaterTxRow[] = [
      { card_hash: 's', business_date: '2025-06-29', gross_cents: 500 }
    ];
    expect(recomputeCustomerLtvFromTx(tx, [7])).toHaveLength(1); // Sun included
    expect(recomputeCustomerLtvFromTx(tx, [1, 2, 3, 4, 5, 6])).toEqual([]); // Sun excluded
  });
});
