// Phase 3 — Analytics SQL integration test scaffold (Wave 0 RED).
//
// This file is the per-task feedback channel for Plans 03-02..03-05. Every
// `it.todo` here corresponds to a D-26 test enumerated in 03-CONTEXT.md and
// will be flipped to a concrete `it` as downstream plans implement cohort_mv,
// ltv_mv, kpi_daily_mv, frequency_v, new_vs_returning_v, refresh_analytics_mvs,
// and the wrapper-view tenancy guarantees.
//
// Because every test is currently `it.todo`, vitest treats the suite as
// having no runnable tests — `beforeAll`/`afterAll` do NOT execute. That is
// intentional: the seeder + refresh RPC only need to run once downstream
// plans start flipping todos to real assertions.

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { adminClient, tenantClient } from '../helpers/supabase';
import { seed3CustomerFixture, cleanupFixture } from './helpers/phase3-fixtures';

describe('Phase 3 — Analytics SQL', () => {
  let admin: ReturnType<typeof adminClient>;
  let restaurantId: string;

  beforeAll(async () => {
    admin = adminClient();
    // Reuse whatever single restaurant the TEST project was bootstrapped with.
    // Downstream plans that need isolation can swap this for a dedicated
    // restaurant created in their own beforeAll.
    const { data, error } = await admin
      .from('restaurants')
      .select('id')
      .limit(1)
      .single();
    if (error) throw error;
    restaurantId = data!.id;

    await cleanupFixture(admin, restaurantId);
    await seed3CustomerFixture(admin, restaurantId);

    // Plan 03-05 ships refresh_analytics_mvs() which sequences
    // cohort_mv → kpi_daily_mv refresh in a single SECURITY DEFINER function.
    const { error: refreshErr } = await admin.rpc('refresh_analytics_mvs');
    if (refreshErr) throw refreshErr;
  });

  afterAll(async () => {
    if (admin && restaurantId) {
      await cleanupFixture(admin, restaurantId);
    }
  });

  // ANL-01 — cohort assignment
  describe('ANL-01 cohort assignment', () => {
    it('assigns A+B to cohort_week=2025-08-04 size 2', async () => {
      const { data, error } = await admin
        .from('cohort_mv')
        .select('card_hash, cohort_week, cohort_size_week')
        .eq('restaurant_id', restaurantId)
        .in('card_hash', ['hash-a', 'hash-b']);
      if (error) throw error;
      expect(data).toHaveLength(2);
      for (const row of data!) {
        expect(row.cohort_week).toBe('2025-08-04');
        expect(row.cohort_size_week).toBe(2);
      }
    });

    it('assigns C to cohort_week=2025-11-10 size 1', async () => {
      const { data, error } = await admin
        .from('cohort_mv')
        .select('card_hash, cohort_week, cohort_size_week')
        .eq('restaurant_id', restaurantId)
        .eq('card_hash', 'hash-c')
        .single();
      if (error) throw error;
      expect(data!.cohort_week).toBe('2025-11-10');
      expect(data!.cohort_size_week).toBe(1);
    });

    it('exposes day/week/month cohort columns for the same customer', async () => {
      const { data, error } = await admin
        .from('cohort_mv')
        .select('card_hash, cohort_day, cohort_week, cohort_month')
        .eq('restaurant_id', restaurantId)
        .in('card_hash', ['hash-a', 'hash-b', 'hash-c']);
      if (error) throw error;
      expect(data).toHaveLength(3);
      for (const row of data!) {
        expect(row.cohort_day).toBeTruthy();
        expect(row.cohort_week).toBeTruthy();
        expect(row.cohort_month).toBeTruthy();
      }
      // Cash exclusion sanity: no NULL card_hash rows present
      const { data: nullRows, error: nullErr } = await admin
        .from('cohort_mv')
        .select('card_hash')
        .eq('restaurant_id', restaurantId)
        .is('card_hash', null);
      if (nullErr) throw nullErr;
      expect(nullRows).toHaveLength(0);
    });
  });

  // ANL-02 — retention curve with NULL-mask past horizon
  describe('ANL-02 retention curve', () => {
    it('cohort 2025-08-04 period 0 = 1.0, period 2 = 1.0, period 1 = 0.0', async () => {
      // Rule 1 fix: plan claimed "period 1 = 0.5 (B returned)" but fixture math
      // disagrees. period_weeks = floor((tx - first_visit)/7d).
      //   A first=08-04 → visits at p0, p2 (08-18=14d), p8 (09-29=56d)
      //   B first=08-05 → visits at p0 (08-11 is only 6d → p0), p2 (08-25=20d)
      // Period 1 has zero visits across both customers; period 0 + 2 are full.
      const { data, error } = await admin.rpc('test_retention_curve', {
        rid: restaurantId
      });
      if (error) throw error;
      const rows = (data as Array<{
        cohort_week: string;
        period_weeks: number;
        retention_rate: number | null;
      }>).filter((r) => r.cohort_week === '2025-08-04');

      const p0 = rows.find((r) => r.period_weeks === 0)!;
      const p1 = rows.find((r) => r.period_weeks === 1)!;
      const p2 = rows.find((r) => r.period_weeks === 2)!;
      expect(Number(p0.retention_rate)).toBe(1);
      expect(Number(p1.retention_rate)).toBe(0);
      expect(Number(p2.retention_rate)).toBe(1);
    });

    it('NULL-masks past per-cohort horizon (survivorship guard)', async () => {
      const { data, error } = await admin.rpc('test_retention_curve', {
        rid: restaurantId
      });
      if (error) throw error;
      const rows = data as Array<{
        cohort_week: string;
        period_weeks: number;
        retention_rate: number | null;
        cohort_age_weeks: number;
      }>;
      // Period 250 is far past every cohort's horizon → must be NULL.
      const farFuture = rows.filter((r) => r.period_weeks === 250);
      expect(farFuture.length).toBeGreaterThan(0);
      for (const r of farFuture) {
        expect(r.retention_rate).toBeNull();
      }
      // Within-horizon row exists (period 0 of any cohort).
      const within = rows.find(
        (r) => r.period_weeks === 0 && r.retention_rate !== null
      );
      expect(within).toBeTruthy();
    });
  });

  // ANL-03 — LTV (cumulative avg per acquired customer, NULL past horizon)
  describe('ANL-03 ltv', () => {
    it('cumulative avg LTV per acquired customer matches fixture math', async () => {
      // Cohort 2025-08-04 (size 2): A gross 1500/1800/2100, B gross 1400/1700/1600.
      // period_weeks = floor((tx - first_visit)/7d). Note B's 08-11 is only 6d
      // after first_visit (08-05) → period 0, not period 1.
      // Cumulative revenue (sum of all txs at period <= p, both customers):
      //   p0: A1500 + B1400 + B1700 = 4600 → ltv 4600/2 = 2300
      //   p2: + A1800 + B1600       = 8000 → ltv 8000/2 = 4000
      //   p8: + A2100               = 10100 → ltv 10100/2 = 5050
      const { data, error } = await admin.rpc('test_ltv', { rid: restaurantId });
      if (error) throw error;
      const rows = (data as Array<{
        cohort_week: string;
        period_weeks: number;
        ltv_cents: number | null;
      }>).filter((r) => r.cohort_week === '2025-08-04');

      const p0 = rows.find((r) => r.period_weeks === 0)!;
      const p2 = rows.find((r) => r.period_weeks === 2)!;
      const p8 = rows.find((r) => r.period_weeks === 8)!;
      expect(Number(p0.ltv_cents)).toBe(2300);
      expect(Number(p2.ltv_cents)).toBe(4000);
      expect(Number(p8.ltv_cents)).toBe(5050);

      // Monotonic non-decreasing across observable periods for this cohort.
      const observable = rows
        .filter((r) => r.ltv_cents !== null)
        .sort((a, b) => a.period_weeks - b.period_weeks);
      for (let i = 1; i < observable.length; i++) {
        expect(Number(observable[i].ltv_cents)).toBeGreaterThanOrEqual(
          Number(observable[i - 1].ltv_cents)
        );
      }
    });

    it('NULL past horizon (same survivorship guard as retention)', async () => {
      const { data, error } = await admin.rpc('test_ltv', { rid: restaurantId });
      if (error) throw error;
      const rows = data as Array<{ period_weeks: number; ltv_cents: number | null }>;
      const farFuture = rows.filter((r) => r.period_weeks === 250);
      expect(farFuture.length).toBeGreaterThan(0);
      for (const r of farFuture) {
        expect(r.ltv_cents).toBeNull();
      }
    });
  });

  // ANL-04 — KPI daily (revenue, tx_count, avg_ticket)
  describe('ANL-04 kpi daily', () => {
    it('revenue_cents = sum(gross_cents) per business_date', async () => {
      // Fixture: hash-a 2025-08-04@1500, hash-b 2025-08-05@1400.
      // Plan 03-03 doc proposed asserting 1500+1400 on a single day, but
      // A and B land on different days — Rule 1 auto-fix: assert each day.
      const { data, error } = await admin
        .from('kpi_daily_mv')
        .select('business_date, revenue_cents, tx_count, avg_ticket_cents')
        .eq('restaurant_id', restaurantId)
        .in('business_date', ['2025-08-04', '2025-08-05'])
        .order('business_date');
      if (error) throw error;

      const d0804 = data!.find((r) => r.business_date === '2025-08-04')!;
      const d0805 = data!.find((r) => r.business_date === '2025-08-05')!;
      expect(Number(d0804.revenue_cents)).toBe(1500);
      expect(d0804.tx_count).toBe(1);
      expect(Number(d0805.revenue_cents)).toBe(1400);
      expect(d0805.tx_count).toBe(1);
    });

    it('avg_ticket_cents = revenue_cents / tx_count', async () => {
      // hash-a 2025-08-18 @ 1800 — single-tx day, avg == gross.
      const { data, error } = await admin
        .from('kpi_daily_mv')
        .select('revenue_cents, tx_count, avg_ticket_cents')
        .eq('restaurant_id', restaurantId)
        .eq('business_date', '2025-08-18')
        .single();
      if (error) throw error;
      expect(Number(data!.revenue_cents)).toBe(1800);
      expect(data!.tx_count).toBe(1);
      expect(Number(data!.avg_ticket_cents)).toBe(1800);
    });
  });

  // ANL-05 — visit-frequency distribution buckets
  describe('ANL-05 frequency', () => {
    it('A=3 and B=3 land in 3-5 bucket; C=2 lands in 2 bucket', async () => {
      // Rule 1 fix: stale todo text said "A and C in 1-2 / B in 3-5". Fixture
      // has A=3 visits, B=3 visits, C=2 visits — so 3-5 bucket has 2 customers
      // (A, B) and "2" bucket has 1 customer (C).
      const { data, error } = await admin.rpc('test_frequency', {
        rid: restaurantId
      });
      if (error) throw error;
      const rows = data as Array<{
        bucket: string;
        customer_count: number;
        revenue_cents: number;
      }>;
      const b35 = rows.find((r) => r.bucket === '3-5');
      const b2 = rows.find((r) => r.bucket === '2');
      expect(b35).toBeTruthy();
      expect(b35!.customer_count).toBe(2);
      // A revenue = 1500+1800+2100=5400; B = 1400+1700+1600=4700 → 10100
      expect(Number(b35!.revenue_cents)).toBe(10100);
      expect(b2).toBeTruthy();
      expect(b2!.customer_count).toBe(1);
      // C revenue = 1300 + 1200 = 2500
      expect(Number(b2!.revenue_cents)).toBe(2500);
    });
  });

  // ANL-06 — new vs returning tie-out (the auditor test)
  describe('ANL-06 new vs returning tie-out', () => {
    it('sum(new+returning+cash_anonymous+blackout_unknown) == kpi_daily_v.revenue_cents per day', async () => {
      // For 2025-08-04: only hash-a tx (1500). hash-a's first_visit_business_date
      // is 2025-08-04 → 'new' bucket. Sum across all 4 buckets must equal kpi.
      const { data: nvr, error: e1 } = await admin.rpc('test_new_vs_returning', {
        rid: restaurantId
      });
      if (e1) throw e1;
      const day = '2025-08-04';
      const dayRows = (nvr as Array<{
        business_date: string;
        bucket: string;
        revenue_cents: number;
      }>).filter((r) => r.business_date === day);
      const nvrSum = dayRows.reduce((s, r) => s + Number(r.revenue_cents), 0);

      const { data: kpi, error: e2 } = await admin
        .from('kpi_daily_mv')
        .select('revenue_cents')
        .eq('restaurant_id', restaurantId)
        .eq('business_date', day)
        .single();
      if (e2) throw e2;
      expect(nvrSum).toBe(Number(kpi!.revenue_cents));
      expect(nvrSum).toBe(1500);

      // Sanity: hash-a is bucketed as 'new' that day.
      const newRow = dayRows.find((r) => r.bucket === 'new');
      expect(newRow).toBeTruthy();
      expect(Number(newRow!.revenue_cents)).toBe(1500);
    });

    it('blackout_unknown bucket exists for April 2026 carded rows', async () => {
      // Insert a one-off April 2026 carded transaction so the blackout
      // routing branch is exercised. cohort_mv excludes April → no
      // first_visit row for this hash → bucket must be 'blackout_unknown'.
      const aprilTx = {
        restaurant_id: restaurantId,
        source_tx_id: 'fixture-april-blackout',
        card_hash: 'hash-april-blackout',
        occurred_at: '2026-04-05T12:00:00+02:00',
        payment_method: 'card',
        gross_cents: 999,
        tip_cents: 0,
        net_cents: Math.round(999 / 1.07)
      };
      const { error: insErr } = await admin
        .from('transactions')
        .upsert(aprilTx, { onConflict: 'restaurant_id,source_tx_id' });
      if (insErr) throw insErr;
      try {
        // Re-refresh so the test runs against fresh state
        // (cohort_mv won't pick up the April row by design — it's filtered).
        await admin.rpc('refresh_analytics_mvs');

        const { data, error } = await admin.rpc('test_new_vs_returning', {
          rid: restaurantId
        });
        if (error) throw error;
        const blackout = (data as Array<{
          business_date: string;
          bucket: string;
          revenue_cents: number;
        }>).filter(
          (r) => r.bucket === 'blackout_unknown' && r.business_date === '2026-04-05'
        );
        expect(blackout.length).toBe(1);
        expect(Number(blackout[0].revenue_cents)).toBe(999);
      } finally {
        await admin
          .from('transactions')
          .delete()
          .eq('restaurant_id', restaurantId)
          .eq('source_tx_id', 'fixture-april-blackout');
      }
    });
  });

  // ANL-07 — refresh concurrency
  describe('ANL-07 refresh concurrent', () => {
    it('refresh_analytics_mvs() succeeds while a concurrent SELECT runs on cohort_v', async () => {
      // Kick a refresh and a SELECT in parallel; both must succeed.
      // REFRESH CONCURRENTLY takes the exclusive lock only briefly at the end,
      // so readers are never blocked. Proves unique-index + CONCURRENTLY combo.
      const [refresh, read] = await Promise.all([
        admin.rpc('refresh_analytics_mvs'),
        admin
          .from('cohort_mv')
          .select('restaurant_id, card_hash, cohort_week')
          .eq('restaurant_id', restaurantId)
      ]);
      expect(refresh.error).toBeNull();
      expect(read.error).toBeNull();
      expect((read.data ?? []).length).toBeGreaterThan(0);
    });
  });

  // quick-260418-28j — retention_curve_monthly_v (Pass 2 fix for period-0 != 1.0 on monthly grain)
  describe('retention_curve_monthly_v', () => {
    const M_COHORT = '2025-09-01'; // date_trunc('month') of 2025-09-*
    const M1_COHORT = '2025-10-01'; // period_months=1 relative to M
    // 10 fresh card_hashes, first-seen in month M; 3 of them return in month M+1.
    const MONTHLY_CARDS = Array.from({ length: 10 }, (_, i) => `hash-monthly-${i}`);
    const MONTHLY_RETURNERS = MONTHLY_CARDS.slice(0, 3);
    const MONTHLY_FIXTURE_PREFIX = 'fixture-monthly-';
    const FIRST_MONTH_DAY = '2025-09-15T12:00:00+02:00';
    const SECOND_MONTH_DAY = '2025-10-15T12:00:00+02:00';

    beforeAll(async () => {
      // Clean any stragglers from a prior failed run.
      await admin
        .from('transactions')
        .delete()
        .eq('restaurant_id', restaurantId)
        .like('source_tx_id', `${MONTHLY_FIXTURE_PREFIX}%`);

      const rows: Array<Record<string, unknown>> = [];
      // 10 cards first-visit in month M.
      MONTHLY_CARDS.forEach((card_hash, i) => {
        rows.push({
          restaurant_id: restaurantId,
          source_tx_id: `${MONTHLY_FIXTURE_PREFIX}${i}-m`,
          card_hash,
          occurred_at: FIRST_MONTH_DAY,
          payment_method: 'card',
          gross_cents: 1000,
          tip_cents: 0,
          net_cents: Math.round(1000 / 1.07)
        });
      });
      // 3 of them return in month M+1.
      MONTHLY_RETURNERS.forEach((card_hash, i) => {
        rows.push({
          restaurant_id: restaurantId,
          source_tx_id: `${MONTHLY_FIXTURE_PREFIX}${i}-m1`,
          card_hash,
          occurred_at: SECOND_MONTH_DAY,
          payment_method: 'card',
          gross_cents: 1000,
          tip_cents: 0,
          net_cents: Math.round(1000 / 1.07)
        });
      });

      const { error } = await admin
        .from('transactions')
        .upsert(rows, { onConflict: 'restaurant_id,source_tx_id' });
      if (error) throw error;

      // Rebuild MVs so cohort_mv picks up the new fixture.
      const { error: refreshErr } = await admin.rpc('refresh_analytics_mvs');
      if (refreshErr) throw refreshErr;
    });

    afterAll(async () => {
      await admin
        .from('transactions')
        .delete()
        .eq('restaurant_id', restaurantId)
        .like('source_tx_id', `${MONTHLY_FIXTURE_PREFIX}%`);
    });

    it('period_months=0 is exactly 1.0 for every non-empty cohort', async () => {
      const { data, error } = await admin.rpc('test_retention_curve_monthly', {
        rid: restaurantId
      });
      if (error) throw error;
      const rows = data as Array<{
        cohort_month: string;
        cohort_size_month: number;
        period_months: number;
        retention_rate: number | null;
      }>;
      const period0 = rows.filter(
        (r) => r.period_months === 0 && Number(r.cohort_size_month) > 0
      );
      expect(period0.length).toBeGreaterThan(0);
      for (const r of period0) {
        expect(Number(r.retention_rate)).toBe(1);
      }
    });

    it('seeded cohort: 10 customers in M, 3 return in M+1 → period_months=1 ≈ 0.3', async () => {
      const { data, error } = await admin.rpc('test_retention_curve_monthly', {
        rid: restaurantId
      });
      if (error) throw error;
      const rows = data as Array<{
        cohort_month: string;
        cohort_size_month: number;
        period_months: number;
        retention_rate: number | null;
      }>;
      const seeded = rows.find(
        (r) => r.cohort_month === M_COHORT && r.period_months === 1
      );
      expect(seeded).toBeTruthy();
      // 3 returners / 10 new customers = 0.3.
      expect(Math.abs(Number(seeded!.retention_rate) - 0.3)).toBeLessThan(0.0001);
      // cohort_size_month should be 10 (all 10 seeded cards).
      expect(Number(seeded!.cohort_size_month)).toBe(10);
    });

    it('row count per cohort ≤ 61 (period_months 0..60 × cohorts)', async () => {
      const { data, error } = await admin.rpc('test_retention_curve_monthly', {
        rid: restaurantId
      });
      if (error) throw error;
      const rows = data as Array<{
        cohort_month: string;
        period_months: number;
      }>;
      // Group by cohort; each cohort has period_months 0..60 before NULL-mask
      // (left join may drop nothing, so exactly 61 per cohort).
      const byCohort = new Map<string, number[]>();
      for (const r of rows) {
        if (!byCohort.has(r.cohort_month)) byCohort.set(r.cohort_month, []);
        byCohort.get(r.cohort_month)!.push(r.period_months);
      }
      for (const [, periods] of byCohort) {
        expect(periods.length).toBe(61);
        expect(Math.min(...periods)).toBe(0);
        expect(Math.max(...periods)).toBe(60);
      }
    });

    it('cohort_age_months is non-negative', async () => {
      const { data, error } = await admin.rpc('test_retention_curve_monthly', {
        rid: restaurantId
      });
      if (error) throw error;
      const rows = data as Array<{ cohort_age_months: number }>;
      for (const r of rows) {
        expect(Number(r.cohort_age_months)).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // ANL-08 — wrapper tenancy (RLS footgun guard)
  describe('ANL-08 wrapper tenancy', () => {
    it('anon/authenticated client cannot SELECT directly from cohort_mv', async () => {
      // cohort_mv has `REVOKE ALL FROM anon, authenticated` (0010_cohort_mv.sql).
      // An un-signed-in tenant client (anon role) must see zero rows or a
      // permission error. Admin still sees the MV (that's how beforeAll refreshes it).
      const c = tenantClient();
      const { data, error } = await c.from('cohort_mv').select('card_hash');
      const blocked = !!error || (data ?? []).length === 0;
      expect(blocked).toBe(true);
    });

    it('cohort_v returns zero rows for anonymous (no JWT restaurant_id claim)', async () => {
      // cohort_v filters on auth.jwt()->>'restaurant_id'. Anon has no claim
      // so the filter resolves to NULL comparison → zero rows. This proves
      // the wrapper filter is active (would NOT be zero if JWT claim were
      // bypassed by a security_invoker footgun).
      const c = tenantClient();
      const { data, error } = await c.from('cohort_v').select('card_hash');
      expect(error).toBeNull();
      expect((data ?? []).length).toBe(0);
    });
  });
});
