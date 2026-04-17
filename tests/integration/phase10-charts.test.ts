// Phase 10 Plan 01 — Nyquist RED scaffold for Phase 10 MV + view shape assertions.
// Tests MUST fail until:
//   - Plan 10-02 lands customer_ltv_mv + customer_ltv_v + test_customer_ltv RPC
//   - Plan 10-02 lands item_counts_daily_mv + item_counts_daily_v + test_item_counts_daily RPC
//   - Plan 10-03 Task 1 adds test_refresh_function_body() helper
//   - Plan 10-02/10-03 extends transactions_filterable_v with visit_seq + card_hash columns
//
// Follows the canonical pattern from tests/integration/tenant-isolation.test.ts:
// - Use adminClient() helper from ../helpers/supabase (NOT raw createClient).
// - Create tenants via .insert({ name, timezone }).select().single() and capture
//   the returned UUID. The restaurants table has NO slug column.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminClient } from '../helpers/supabase';

const admin = adminClient();

// Tenant UUIDs captured at runtime from insert().select().single().
// Seed-tenant literal is used for shape assertions against data that already
// lives in DEV once scripts/seed-demo-data.sql + refresh_analytics_mvs() have run.
const SEED_TENANT = 'ba1bf707-aae9-46a9-8166-4b6459e6c2fd';

let TENANT_A: string;
let TENANT_B: string;

beforeAll(async () => {
  const { data: a, error: errA } = await admin
    .from('restaurants')
    .insert({ name: `Phase10 Tenant A ${Date.now()}`, timezone: 'Europe/Berlin' })
    .select()
    .single();
  if (errA) throw errA;
  TENANT_A = a!.id;

  const { data: b, error: errB } = await admin
    .from('restaurants')
    .insert({ name: `Phase10 Tenant B ${Date.now()}`, timezone: 'Europe/Berlin' })
    .select()
    .single();
  if (errB) throw errB;
  TENANT_B = b!.id;
});

afterAll(async () => {
  if (TENANT_A && TENANT_B) {
    await admin.from('restaurants').delete().in('id', [TENANT_A, TENANT_B]);
  }
});

describe('customer_ltv_mv shape (VA-09, VA-10)', () => {
  it('exposes card_hash + revenue_cents + visit_count + cohort_week + cohort_month columns', async () => {
    const { data, error } = await admin.rpc('test_customer_ltv', { rid: TENANT_A });
    expect(error).toBeNull();
    expect(data).toBeDefined();
    // Fresh tenant may be empty — column presence still asserted when non-empty.
    if (data && data.length > 0) {
      const r = data[0];
      expect(r).toHaveProperty('card_hash');
      expect(r).toHaveProperty('revenue_cents');
      expect(r).toHaveProperty('visit_count');
      expect(r).toHaveProperty('cohort_week');
      expect(r).toHaveProperty('cohort_month');
    }
  });

  it('excludes cash customers (card_hash IS NOT NULL) — against seeded tenant', async () => {
    // After scripts/seed-demo-data.sql + refresh_analytics_mvs() land,
    // SEED_TENANT has real card_hash rows. Every MV row must be non-null.
    const { data } = await admin.rpc('test_customer_ltv', { rid: SEED_TENANT });
    expect((data ?? []).every((r: Record<string, unknown>) => r.card_hash !== null)).toBe(true);
  });
});

describe('customer_ltv_v tenant isolation (ANL-08)', () => {
  it('tenant A and tenant B card_hash sets are disjoint', async () => {
    const { data: a } = await admin.rpc('test_customer_ltv', { rid: TENANT_A });
    const { data: b } = await admin.rpc('test_customer_ltv', { rid: TENANT_B });
    const aHashes = new Set((a ?? []).map((r: Record<string, unknown>) => r.card_hash as string));
    const bHashes = new Set((b ?? []).map((r: Record<string, unknown>) => r.card_hash as string));
    for (const h of bHashes) expect(aHashes.has(h)).toBe(false);
  });
});

describe('item_counts_daily_mv shape (VA-08)', () => {
  it('exposes business_date + item_name + sales_type + is_cash + item_count', async () => {
    const { data, error } = await admin.rpc('test_item_counts_daily', { rid: SEED_TENANT });
    expect(error).toBeNull();
    expect(data).toBeDefined();
    if (data && data.length > 0) {
      const r = data[0];
      expect(r).toHaveProperty('business_date');
      expect(r).toHaveProperty('item_name');
      expect(r).toHaveProperty('sales_type');
      expect(r).toHaveProperty('is_cash');
      expect(r).toHaveProperty('item_count');
    }
  });

  it('excludes NULL and empty-string item_name rows', async () => {
    const { data } = await admin.rpc('test_item_counts_daily', { rid: SEED_TENANT });
    expect(
      (data ?? []).every((r: Record<string, unknown>) => {
        const name = r.item_name as string | null;
        return name !== null && name !== undefined && name.trim() !== '';
      })
    ).toBe(true);
  });
});

describe('item_counts_daily_v tenant isolation (ANL-08)', () => {
  it('tenant A result set does not leak tenant B restaurant_id', async () => {
    const { data: a } = await admin.rpc('test_item_counts_daily', { rid: TENANT_A });
    const { data: b } = await admin.rpc('test_item_counts_daily', { rid: TENANT_B });
    expect(Array.isArray(a)).toBe(true);
    expect(Array.isArray(b)).toBe(true);
    // JWT scope enforcement: every row returned for TENANT_A must have
    // restaurant_id === TENANT_A (vacuously true for empty results).
    expect((a ?? []).every((r: Record<string, unknown>) => r.restaurant_id === TENANT_A)).toBe(true);
    expect((b ?? []).every((r: Record<string, unknown>) => r.restaurant_id === TENANT_B)).toBe(true);
  });
});

describe('transactions_filterable_v extension (FLT / VA)', () => {
  it('exposes visit_seq and card_hash columns', async () => {
    // Service-role bypasses RLS — column selection alone verifies schema.
    const { data, error } = await admin
      .from('transactions_filterable_v')
      .select('business_date, gross_cents, sales_type, is_cash, visit_seq, card_hash')
      .limit(1);
    expect(error).toBeNull();
    expect(data).toBeDefined();
  });
});

describe('refresh_analytics_mvs() DAG ordering (ANL-09)', () => {
  it('includes all 5 MVs in dependency order: cohort → kpi → visit_attribution → customer_ltv → item_counts', async () => {
    // test_refresh_function_body() is a SECURITY DEFINER helper added in
    // Plan 10-03 Task 1. It returns pg_get_functiondef for refresh_analytics_mvs.
    // Until the helper exists, this RPC errors → test stays RED.
    const { data, error } = await admin.rpc('test_refresh_function_body');
    expect(error).toBeNull();
    expect(typeof data).toBe('string');
    expect(data).toMatch(
      /refresh materialized view concurrently public\.cohort_mv[\s\S]+kpi_daily_mv[\s\S]+visit_attribution_mv[\s\S]+customer_ltv_mv[\s\S]+item_counts_daily_mv/i
    );
  });
});

describe('raw MVs remain REVOKED from authenticated/anon', () => {
  it.todo('customer_ltv_mv REVOKED ALL FROM authenticated, anon');
  it.todo('item_counts_daily_mv REVOKED ALL FROM authenticated, anon');
});
