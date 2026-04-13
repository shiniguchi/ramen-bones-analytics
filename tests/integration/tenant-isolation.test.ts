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
    .insert({ name: 'Isolation Tenant A', timezone: 'Europe/Berlin' })
    .select()
    .single();
  tenantA = a!.id;
  const { data: b } = await admin
    .from('restaurants')
    .insert({ name: 'Isolation Tenant B', timezone: 'Europe/Berlin' })
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

describe('FND-05: two-tenant isolation on kpi_daily_v', () => {
  it('tenant A only sees tenant A rows', async () => {
    const c = tenantClient();
    await c.auth.signInWithPassword({ email: emailA, password });
    const { data, error } = await c.from('kpi_daily_v').select();
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    expect(data!.every((r: { restaurant_id: string }) => r.restaurant_id === tenantA)).toBe(true);
  });

  it('tenant B only sees tenant B rows', async () => {
    const c = tenantClient();
    await c.auth.signInWithPassword({ email: emailB, password });
    const { data, error } = await c.from('kpi_daily_v').select();
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    expect(data!.every((r: { restaurant_id: string }) => r.restaurant_id === tenantB)).toBe(true);
  });

  it('tenant A cannot read raw kpi_daily_mv directly', async () => {
    const c = tenantClient();
    await c.auth.signInWithPassword({ email: emailA, password });
    const { data, error } = await c.from('kpi_daily_mv').select();
    // Either the request errors (403/404) or returns zero rows — both acceptable.
    const blocked = !!error || (data ?? []).length === 0;
    expect(blocked).toBe(true);
  });

  it('anonymous client sees zero rows on kpi_daily_v', async () => {
    const c = tenantClient();
    const { data } = await c.from('kpi_daily_v').select();
    expect((data ?? []).length).toBe(0);
  });

  it('orphan user (no membership) sees zero rows on kpi_daily_v', async () => {
    const c = tenantClient();
    await c.auth.signInWithPassword({ email: emailOrphan, password });
    const { data, error } = await c.from('kpi_daily_v').select();
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(0);
  });
});
