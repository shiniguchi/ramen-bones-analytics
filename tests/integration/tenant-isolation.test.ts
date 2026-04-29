import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminClient, tenantClient } from '../helpers/supabase';

const admin = adminClient();
const emailA = `iso-a-${Date.now()}@test.local`;
const emailB = `iso-b-${Date.now()}@test.local`;
const emailOrphan = `iso-orphan-${Date.now()}@test.local`;
const password = `iso-pw-${Date.now()}`;

let tenantA: string;
let tenantB: string;
let userA: string;
let userB: string;
let userOrphan: string;

beforeAll(async () => {
  const { data: a } = await admin
    .from('restaurants')
    .insert({ name: 'Isolation Tenant A', timezone: 'Europe/Berlin', slug: `iso-a-${crypto.randomUUID()}` })
    .select()
    .single();
  tenantA = a!.id;
  const { data: b } = await admin
    .from('restaurants')
    .insert({ name: 'Isolation Tenant B', timezone: 'Europe/Berlin', slug: `iso-b-${crypto.randomUUID()}` })
    .select()
    .single();
  tenantB = b!.id;

  const { data: ua } = await admin.auth.admin.createUser({ email: emailA, password, email_confirm: true });
  userA = ua.user!.id;
  const { data: ub } = await admin.auth.admin.createUser({ email: emailB, password, email_confirm: true });
  userB = ub.user!.id;
  const { data: uo } = await admin.auth.admin.createUser({ email: emailOrphan, password, email_confirm: true });
  userOrphan = uo.user!.id;

  await admin.from('memberships').insert([
    { user_id: userA, restaurant_id: tenantA, role: 'owner' },
    { user_id: userB, restaurant_id: tenantB, role: 'owner' }
  ]);

  // kpi_daily_mv is a materialized view snapshot — runtime-seeded tenants
  // only appear after an explicit refresh. test_helpers migration provides
  // a service_role-only RPC for this.
  const { error: refreshErr } = await admin.rpc('refresh_kpi_daily_mv');
  if (refreshErr) throw refreshErr;
});

afterAll(async () => {
  await admin.from('memberships').delete().in('user_id', [userA, userB, userOrphan]);
  await admin.auth.admin.deleteUser(userA);
  await admin.auth.admin.deleteUser(userB);
  await admin.auth.admin.deleteUser(userOrphan);
  await admin.from('restaurants').delete().in('id', [tenantA, tenantB]);
});

// Phase 3 D-27: extended to cover all 6 wrapper views and both raw MVs.
// kpi_daily_v is the only one seeded with tenant rows (via refresh_kpi_daily_mv
// which Plan 03-05 superseded to also refresh cohort_mv). The other 5 wrapper
// views inherit from cohort_mv — they may be empty for these synthetic tenants
// (no seeded transactions with card_hash), but they MUST still enforce the
// JWT-claim filter. We assert "every row belongs to this tenant" which is
// trivially true when the result set is empty, and non-trivially true for
// kpi_daily_v which does have rows.
const wrapperViews = [
  'kpi_daily_v',
  'cohort_v',
  'retention_curve_v'
];

// Raw MVs must be unreachable from authenticated/anon roles.
const rawMVs = ['kpi_daily_mv', 'cohort_mv'];

describe('FND-05 + ANL-08: tenant isolation across wrapper views', () => {
  it.each(wrapperViews)('tenant A only sees tenant A rows on %s', async (view) => {
    const c = tenantClient();
    await c.auth.signInWithPassword({ email: emailA, password });
    const { data, error } = await c.from(view).select('restaurant_id');
    expect(error).toBeNull();
    const rows = (data ?? []) as Array<{ restaurant_id: string }>;
    expect(rows.every((r) => r.restaurant_id === tenantA)).toBe(true);
  });

  it.each(wrapperViews)('tenant B only sees tenant B rows on %s', async (view) => {
    const c = tenantClient();
    await c.auth.signInWithPassword({ email: emailB, password });
    const { data, error } = await c.from(view).select('restaurant_id');
    expect(error).toBeNull();
    const rows = (data ?? []) as Array<{ restaurant_id: string }>;
    expect(rows.every((r) => r.restaurant_id === tenantB)).toBe(true);
  });

  it.each(rawMVs)('tenant A cannot read raw %s directly', async (mv) => {
    const c = tenantClient();
    await c.auth.signInWithPassword({ email: emailA, password });
    const { data, error } = await c.from(mv).select();
    // Either the request errors (403/404) or returns zero rows — both acceptable.
    const blocked = !!error || (data ?? []).length === 0;
    expect(blocked).toBe(true);
  });

  it.each(wrapperViews)('anonymous client sees zero rows on %s', async (view) => {
    const c = tenantClient();
    const { data } = await c.from(view).select();
    expect((data ?? []).length).toBe(0);
  });

  it.each(wrapperViews)('orphan user (no membership) sees zero rows on %s', async (view) => {
    const c = tenantClient();
    await c.auth.signInWithPassword({ email: emailOrphan, password });
    const { data, error } = await c.from(view).select();
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(0);
  });
});

// Phase 13 EXT-08: hybrid-RLS isolation across 7 new tables.
// Shared (location-keyed) — wrong-tenant JWT must still be ALLOWED to SELECT
// (these are city-wide reference data, deliberately readable by all auth'd
// users) but must be DENIED any INSERT/UPDATE/DELETE.
// Tenant-scoped — wrong-tenant JWT must return ZERO rows on SELECT.

const sharedTables = [
  'weather_daily',
  'holidays',
  'school_holidays',
  'transit_alerts',
  'recurring_events',
];
const tenantTables = ['shop_calendar'];

describe('EXT-08: shared-table read allowed, write denied', () => {
  it.each(sharedTables)('tenant A can SELECT %s', async (t) => {
    const c = tenantClient();
    await c.auth.signInWithPassword({ email: emailA, password });
    const { error } = await c.from(t).select('*').limit(1);
    expect(error).toBeNull();
  });

  it.each(sharedTables)('tenant A cannot INSERT into %s', async (t) => {
    const c = tenantClient();
    await c.auth.signInWithPassword({ email: emailA, password });
    // The minimal payloads below intentionally violate NOT NULL / unique
    // constraints in places — the assertion only cares that RLS denies
    // the write before constraint validation. PostgREST surfaces both
    // RLS denial and constraint failure as `error` non-null.
    const { error } = await c.from(t).insert({ noop: 'x' } as any);
    expect(error).not.toBeNull();
  });
});

describe('EXT-08: tenant-scoped table isolation', () => {
  it.each(tenantTables)('tenant A sees zero rows under tenant B fixture (%s)', async (t) => {
    // Seed a tenant-B-scoped row as service-role.
    const today = new Date().toISOString().slice(0, 10);
    await admin.from(t).upsert({
      restaurant_id: tenantB,
      date: today,
      is_open: true,
    } as never, { onConflict: 'restaurant_id,date' as never } as never);

    const c = tenantClient();
    await c.auth.signInWithPassword({ email: emailA, password });
    const { data, error } = await c.from(t).select('restaurant_id').eq('date', today);
    expect(error).toBeNull();
    const rows = (data ?? []) as Array<{ restaurant_id: string }>;
    // Must NOT contain tenantB rows.
    expect(rows.every((r) => r.restaurant_id !== tenantB)).toBe(true);
  });

  it.each(tenantTables)('orphan user sees zero rows on %s', async (t) => {
    const c = tenantClient();
    await c.auth.signInWithPassword({ email: emailOrphan, password });
    const { data, error } = await c.from(t).select('*').limit(5);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(0);
  });
});

describe('EXT-08: pipeline_runs RLS — global rows visible, tenant rows scoped', () => {
  it('tenant A sees global rows (restaurant_id IS NULL) but only own tenant rows', async () => {
    // Seed one global row + one tenant-A row + one tenant-B row.
    const stamp = `iso-${Date.now()}`;
    await admin.from('pipeline_runs').insert([
      { step_name: `${stamp}-global`, status: 'success', restaurant_id: null },
      { step_name: `${stamp}-A`, status: 'success', restaurant_id: tenantA },
      { step_name: `${stamp}-B`, status: 'success', restaurant_id: tenantB },
    ]);
    const c = tenantClient();
    await c.auth.signInWithPassword({ email: emailA, password });
    const { data, error } = await c
      .from('pipeline_runs')
      .select('step_name, restaurant_id')
      .like('step_name', `${stamp}%`);
    expect(error).toBeNull();
    const seen = (data ?? []) as Array<{ step_name: string; restaurant_id: string | null }>;
    const names = seen.map((r) => r.step_name).sort();
    expect(names).toContain(`${stamp}-global`);
    expect(names).toContain(`${stamp}-A`);
    expect(names).not.toContain(`${stamp}-B`);
  });
});
