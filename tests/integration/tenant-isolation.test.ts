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

  // REVIEW T-6: per-table STRUCTURALLY VALID payloads. The earlier `{noop:'x'}`
  // payload triggered NOT NULL constraint violation and surfaced error≠null
  // regardless of RLS state — so the test passed even when RLS was fully
  // open (constraint check fired before the policy). These payloads would
  // succeed if RLS allowed the write, making error≠null actual proof that
  // RLS denied the operation.
  const validInsertPayloads: Record<string, Record<string, unknown>> = {
    weather_daily:    { date: '2099-12-31', location: 'rls-test', provider: 'test' },
    holidays:         { date: '2099-12-31', name: 'rls-test' },
    school_holidays:  { state_code: 'XX', block_name: 'rls-test', start_date: '2099-01-01',
                        end_date: '2099-01-07', year: 2099 },
    transit_alerts:   { alert_id: 'rls-test-1', title: 'x',
                        pub_date: '2099-12-31T00:00:00Z',
                        matched_keyword: 'Streik', source_url: 'https://example.com/x' },
    recurring_events: { event_id: 'rls-test-1', name: 'x', category: 'other',
                        start_date: '2099-01-01', end_date: '2099-01-02',
                        impact_estimate: 'low' },
  };

  it.each(sharedTables)('tenant A INSERT into %s is denied by RLS (not by constraint)', async (t) => {
    const c = tenantClient();
    await c.auth.signInWithPassword({ email: emailA, password });
    const payload = validInsertPayloads[t];
    expect(payload).toBeDefined();
    const { error } = await c.from(t).insert(payload as never);
    // The payload is valid; if RLS allowed the write, error would be null.
    // error≠null here is unambiguous proof of RLS denial.
    expect(error).not.toBeNull();
  });

  // Cleanup any rows that somehow slipped through (defense in depth — a future
  // RLS regression that lets one through shouldn't poison subsequent test runs).
  afterAll(async () => {
    await admin.from('weather_daily').delete().eq('location', 'rls-test');
    await admin.from('holidays').delete().eq('date', '2099-12-31');
    await admin.from('school_holidays').delete().eq('state_code', 'XX');
    await admin.from('transit_alerts').delete().eq('alert_id', 'rls-test-1');
    await admin.from('recurring_events').delete().eq('event_id', 'rls-test-1');
  });
});

describe('EXT-08: tenant-scoped table isolation', () => {
  // REVIEW T-7: prior test seeded only tenant-B rows and asserted tenant A
  // saw none — but an EMPTY result (e.g. JWT lacks restaurant_id claim
  // entirely; RLS evaluates to NULL → deny ALL) trivially satisfies that
  // check. Now seed BOTH tenants and assert positive (sees own row) AND
  // negative (does not see other tenant's row) per table. A symmetric pair
  // of tests for tenant A and tenant B catches one-sided RLS bugs (e.g.
  // policy hardcoded to a specific UUID).
  it.each(tenantTables)('tenant A sees own rows + NEVER tenant B (%s)', async (t) => {
    const today = new Date().toISOString().slice(0, 10);
    await admin.from(t).upsert([
      { restaurant_id: tenantA, date: today, is_open: true },
      { restaurant_id: tenantB, date: today, is_open: true },
    ] as never, { onConflict: 'restaurant_id,date' as never } as never);

    const c = tenantClient();
    await c.auth.signInWithPassword({ email: emailA, password });
    const { data, error } = await c.from(t).select('restaurant_id').eq('date', today);
    expect(error).toBeNull();
    const rows = (data ?? []) as Array<{ restaurant_id: string }>;
    // Positive check: A sees its own row (proves JWT claim is read).
    expect(rows.some((r) => r.restaurant_id === tenantA)).toBe(true);
    // Negative check: A never sees B's row (proves RLS scoping holds).
    expect(rows.every((r) => r.restaurant_id !== tenantB)).toBe(true);
  });

  it.each(tenantTables)('tenant B sees own rows + NEVER tenant A (%s) — symmetric pair to catch one-sided bugs', async (t) => {
    const today = new Date().toISOString().slice(0, 10);
    await admin.from(t).upsert([
      { restaurant_id: tenantA, date: today, is_open: true },
      { restaurant_id: tenantB, date: today, is_open: true },
    ] as never, { onConflict: 'restaurant_id,date' as never } as never);

    const c = tenantClient();
    await c.auth.signInWithPassword({ email: emailB, password });
    const { data, error } = await c.from(t).select('restaurant_id').eq('date', today);
    expect(error).toBeNull();
    const rows = (data ?? []) as Array<{ restaurant_id: string }>;
    expect(rows.some((r) => r.restaurant_id === tenantB)).toBe(true);
    expect(rows.every((r) => r.restaurant_id !== tenantA)).toBe(true);
  });

  it.each(tenantTables)('orphan user sees zero rows on %s', async (t) => {
    const c = tenantClient();
    await c.auth.signInWithPassword({ email: emailOrphan, password });
    const { data, error } = await c.from(t).select('*').limit(5);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(0);
  });
});

describe('EXT-08: pipeline_runs lockdown (REVIEW MS-2) — raw table is service-role-only; clients read pipeline_runs_status_v', () => {
  // Seed once and reuse across the suite: avoids cross-test interference and
  // gives both tenants a consistent view of the same fixture set.
  const stamp = `iso-${Date.now()}`;

  beforeAll(async () => {
    await admin.from('pipeline_runs').insert([
      { step_name: `${stamp}-global`, status: 'success', restaurant_id: null,
        error_msg: 'SECRET stack trace — global row should never reach a client' },
      { step_name: `${stamp}-A`, status: 'success', restaurant_id: tenantA,
        error_msg: 'tenant A internal' },
      { step_name: `${stamp}-B`, status: 'success', restaurant_id: tenantB,
        error_msg: 'tenant B internal' },
    ]);
  });

  afterAll(async () => {
    await admin.from('pipeline_runs').delete().like('step_name', `${stamp}%`);
  });

  it('raw pipeline_runs SELECT is denied to authenticated tenant (revoked in 0049)', async () => {
    const c = tenantClient();
    await c.auth.signInWithPassword({ email: emailA, password });
    const { data, error } = await c.from('pipeline_runs').select('*').limit(1);
    // Either error≠null (revoke surfaces as PostgREST 401/permission-denied)
    // or the strict RLS policy hides everything — in both cases data must
    // contain ZERO of our seeded rows. error_msg cannot leak via this path.
    if (error) {
      expect(error).not.toBeNull();
    } else {
      const names = (data ?? []).map((r: any) => r.step_name);
      expect(names).not.toContain(`${stamp}-global`);
      expect(names).not.toContain(`${stamp}-A`);
      expect(names).not.toContain(`${stamp}-B`);
    }
  });

  it('tenant A reads global + own-tenant rows via pipeline_runs_status_v; never tenant B', async () => {
    const c = tenantClient();
    await c.auth.signInWithPassword({ email: emailA, password });
    const { data, error } = await c
      .from('pipeline_runs_status_v')
      .select('step_name, restaurant_id')
      .like('step_name', `${stamp}%`);
    expect(error).toBeNull();
    const names = ((data ?? []) as Array<{ step_name: string }>).map((r) => r.step_name).sort();
    expect(names).toContain(`${stamp}-global`);
    expect(names).toContain(`${stamp}-A`);
    expect(names).not.toContain(`${stamp}-B`);
  });

  it('tenant B reads global + own-tenant rows via pipeline_runs_status_v; never tenant A', async () => {
    // Mirror test of the above — proves the view is symmetric, not a one-sided
    // bug (e.g. policy hardcoded to a specific UUID would pass tenant A and
    // fail this test) (REVIEW T-8).
    const c = tenantClient();
    await c.auth.signInWithPassword({ email: emailB, password });
    const { data, error } = await c
      .from('pipeline_runs_status_v')
      .select('step_name, restaurant_id')
      .like('step_name', `${stamp}%`);
    expect(error).toBeNull();
    const names = ((data ?? []) as Array<{ step_name: string }>).map((r) => r.step_name).sort();
    expect(names).toContain(`${stamp}-global`);
    expect(names).toContain(`${stamp}-B`);
    expect(names).not.toContain(`${stamp}-A`);
  });

  it('pipeline_runs_status_v exposes NO sensitive columns — error_msg + commit_sha must be absent', async () => {
    const c = tenantClient();
    await c.auth.signInWithPassword({ email: emailA, password });
    const { data, error } = await c
      .from('pipeline_runs_status_v')
      .select('*')
      .like('step_name', `${stamp}%`)
      .limit(1);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
    const row = (data as Array<Record<string, unknown>>)[0];
    expect(row).not.toHaveProperty('error_msg');
    expect(row).not.toHaveProperty('commit_sha');
    // Sanity: safe columns ARE present.
    expect(row).toHaveProperty('step_name');
    expect(row).toHaveProperty('status');
    expect(row).toHaveProperty('upstream_freshness_h');
  });
});

// Phase 14 FCT-08: tenant isolation for forecast_daily, forecast_quality, and
// forecast_with_actual_v. Both raw tables use RLS (restaurant_id = JWT claim)
// plus REVOKE INSERT/UPDATE/DELETE from authenticated/anon. The wrapper view
// enforces the same filter via a WHERE clause.
describe('FCT-08: forecast table tenant isolation (Phase 14)', () => {
  // Seed one forecast_daily row per tenant so both positive and negative
  // checks are non-trivial (empty result would trivially pass the negative check).
  const forecastDate = '2099-01-01';

  beforeAll(async () => {
    await admin.from('forecast_daily').insert([
      {
        restaurant_id: tenantA,
        kpi_name: 'revenue_eur',
        target_date: forecastDate,
        model_name: 'test-model',
        run_date: forecastDate,
        forecast_track: 'bau',
        yhat: 100.0,
        yhat_lower: 80.0,
        yhat_upper: 120.0,
      },
      {
        restaurant_id: tenantB,
        kpi_name: 'revenue_eur',
        target_date: forecastDate,
        model_name: 'test-model',
        run_date: forecastDate,
        forecast_track: 'bau',
        yhat: 200.0,
        yhat_lower: 160.0,
        yhat_upper: 240.0,
      },
    ] as never);

    await admin.from('forecast_quality').insert([
      {
        restaurant_id: tenantA,
        kpi_name: 'revenue_eur',
        model_name: 'test-model',
        horizon_days: 1,
        evaluation_window: 'last_7_days',
        n_days: 7,
        rmse: 10.0,
        mape: 0.05,
        mean_bias: 0.01,
      },
      {
        restaurant_id: tenantB,
        kpi_name: 'revenue_eur',
        model_name: 'test-model',
        horizon_days: 1,
        evaluation_window: 'last_7_days',
        n_days: 7,
        rmse: 15.0,
        mape: 0.07,
        mean_bias: 0.02,
      },
    ] as never);
  });

  afterAll(async () => {
    await admin.from('forecast_daily').delete()
      .eq('target_date', forecastDate)
      .eq('model_name', 'test-model');
    await admin.from('forecast_quality').delete()
      .eq('model_name', 'test-model')
      .eq('evaluation_window', 'last_7_days');
  });

  // forecast_daily RLS — cross-tenant read isolation
  it('forecast_daily: tenant A sees own rows and NEVER tenant B rows', async () => {
    const c = tenantClient();
    await c.auth.signInWithPassword({ email: emailA, password });
    const { data, error } = await c
      .from('forecast_daily')
      .select('restaurant_id')
      .eq('target_date', forecastDate)
      .eq('model_name', 'test-model');
    expect(error).toBeNull();
    const rows = (data ?? []) as Array<{ restaurant_id: string }>;
    // Positive: A can see its own forecast row.
    expect(rows.some((r) => r.restaurant_id === tenantA)).toBe(true);
    // Negative: A never sees B's row.
    expect(rows.every((r) => r.restaurant_id !== tenantB)).toBe(true);
  });

  it('forecast_daily: tenant B sees own rows and NEVER tenant A rows — symmetric pair', async () => {
    const c = tenantClient();
    await c.auth.signInWithPassword({ email: emailB, password });
    const { data, error } = await c
      .from('forecast_daily')
      .select('restaurant_id')
      .eq('target_date', forecastDate)
      .eq('model_name', 'test-model');
    expect(error).toBeNull();
    const rows = (data ?? []) as Array<{ restaurant_id: string }>;
    expect(rows.some((r) => r.restaurant_id === tenantB)).toBe(true);
    expect(rows.every((r) => r.restaurant_id !== tenantA)).toBe(true);
  });

  // forecast_quality RLS — cross-tenant read isolation
  it('forecast_quality: tenant A sees own rows and NEVER tenant B rows', async () => {
    const c = tenantClient();
    await c.auth.signInWithPassword({ email: emailA, password });
    const { data, error } = await c
      .from('forecast_quality')
      .select('restaurant_id')
      .eq('model_name', 'test-model')
      .eq('evaluation_window', 'last_7_days');
    expect(error).toBeNull();
    const rows = (data ?? []) as Array<{ restaurant_id: string }>;
    expect(rows.some((r) => r.restaurant_id === tenantA)).toBe(true);
    expect(rows.every((r) => r.restaurant_id !== tenantB)).toBe(true);
  });

  it('forecast_quality: tenant B sees own rows and NEVER tenant A rows — symmetric pair', async () => {
    const c = tenantClient();
    await c.auth.signInWithPassword({ email: emailB, password });
    const { data, error } = await c
      .from('forecast_quality')
      .select('restaurant_id')
      .eq('model_name', 'test-model')
      .eq('evaluation_window', 'last_7_days');
    expect(error).toBeNull();
    const rows = (data ?? []) as Array<{ restaurant_id: string }>;
    expect(rows.some((r) => r.restaurant_id === tenantB)).toBe(true);
    expect(rows.every((r) => r.restaurant_id !== tenantA)).toBe(true);
  });

  // forecast_with_actual_v wrapper view — JWT-scoped WHERE clause
  it('forecast_with_actual_v: tenant A only sees own restaurant_id', async () => {
    const c = tenantClient();
    await c.auth.signInWithPassword({ email: emailA, password });
    const { data, error } = await c
      .from('forecast_with_actual_v')
      .select('restaurant_id');
    expect(error).toBeNull();
    const rows = (data ?? []) as Array<{ restaurant_id: string }>;
    // Every row returned must belong to tenant A (view WHERE clause enforces this).
    expect(rows.every((r) => r.restaurant_id === tenantA)).toBe(true);
  });

  it('forecast_with_actual_v: tenant B only sees own restaurant_id — symmetric pair', async () => {
    const c = tenantClient();
    await c.auth.signInWithPassword({ email: emailB, password });
    const { data, error } = await c
      .from('forecast_with_actual_v')
      .select('restaurant_id');
    expect(error).toBeNull();
    const rows = (data ?? []) as Array<{ restaurant_id: string }>;
    expect(rows.every((r) => r.restaurant_id === tenantB)).toBe(true);
  });

  // INSERT lockdown — authenticated role must be denied writes on both tables
  it('forecast_daily: authenticated role INSERT is denied (service-role only)', async () => {
    const c = tenantClient();
    await c.auth.signInWithPassword({ email: emailA, password });
    const { error } = await c.from('forecast_daily').insert({
      restaurant_id: tenantA,
      kpi_name: 'revenue_eur',
      target_date: '2099-06-01',
      model_name: 'rls-write-test',
      run_date: '2099-06-01',
      forecast_track: 'bau',
      yhat: 1.0,
      yhat_lower: 0.5,
      yhat_upper: 1.5,
    } as never);
    // REVOKE INSERT means this must error — error≠null is unambiguous proof.
    expect(error).not.toBeNull();
  });

  it('forecast_quality: authenticated role INSERT is denied (service-role only)', async () => {
    const c = tenantClient();
    await c.auth.signInWithPassword({ email: emailA, password });
    const { error } = await c.from('forecast_quality').insert({
      restaurant_id: tenantA,
      kpi_name: 'revenue_eur',
      model_name: 'rls-write-test',
      horizon_days: 1,
      evaluation_window: 'last_7_days',
      n_days: 7,
      rmse: 1.0,
      mape: 0.01,
      mean_bias: 0.0,
    } as never);
    expect(error).not.toBeNull();
  });
});
