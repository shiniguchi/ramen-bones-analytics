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

import { describe, it, beforeAll, afterAll } from 'vitest';
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

    // refresh_analytics_mvs() is created in Plan 03-05. Until then this
    // branch is dead code — the whole beforeAll block is gated behind any
    // non-todo test existing in this file.
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
    it.todo('assigns A+B to cohort_week=2025-08-04 size 2');
    it.todo('assigns C to cohort_week=2025-11-10 size 1');
    it.todo('exposes day/week/month cohort columns for the same customer');
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
    it.todo('revenue_cents = sum(gross_cents) per business_date');
    it.todo('avg_ticket_cents = revenue_cents / tx_count');
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
