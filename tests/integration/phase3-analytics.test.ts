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
import { adminClient } from '../helpers/supabase';
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

    // Plan 03-02 ships refresh_cohort_mv() as a local helper so ANL-01 tests
    // can turn green now. Plan 03-05 replaces this with refresh_analytics_mvs()
    // which sequences cohort_mv + kpi_daily_mv refresh. Until that lands, call
    // the per-MV helper directly.
    const { error: refreshErr } = await admin.rpc('refresh_cohort_mv');
    if (refreshErr) throw refreshErr;

    // Plan 03-03 replaced the kpi_daily_mv placeholder body; ANL-04 needs
    // the real aggregation refreshed against the seeded fixture.
    const { error: kpiRefreshErr } = await admin.rpc('refresh_kpi_daily_mv');
    if (kpiRefreshErr) throw kpiRefreshErr;
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
    it.todo('cohort 2025-08-04 period 1 retention_rate = 0.5 (B returned)');
    it.todo('NULL-masks past per-cohort horizon (survivorship guard)');
  });

  // ANL-03 — LTV (cumulative avg per acquired customer, NULL past horizon)
  describe('ANL-03 ltv', () => {
    it.todo('cumulative avg LTV per acquired customer matches fixture math');
    it.todo('NULL past horizon (same survivorship guard as retention)');
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
    it.todo('A and C bucketed as 1-2 / B bucketed as 3-5 per fixture visit counts');
  });

  // ANL-06 — new vs returning tie-out (the auditor test)
  describe('ANL-06 new vs returning tie-out', () => {
    it.todo('sum(new+returning+cash_anonymous+blackout_unknown) == kpi_daily_v.revenue_cents per day');
    it.todo('blackout_unknown bucket exists for April 2026 carded rows');
  });

  // ANL-07 — refresh concurrency
  describe('ANL-07 refresh concurrent', () => {
    it.todo('refresh_analytics_mvs() succeeds while a concurrent SELECT runs on cohort_v');
  });

  // ANL-08 — wrapper tenancy (RLS footgun guard)
  describe('ANL-08 wrapper tenancy', () => {
    it.todo('authenticated client cannot SELECT directly from cohort_mv');
    it.todo('cohort_v returns only rows matching the JWT restaurant_id');
  });
});
