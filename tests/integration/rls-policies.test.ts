import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminClient, tenantClient } from '../helpers/supabase';

const admin = adminClient();
const emailA = `rls-a-${Date.now()}@test.local`;
const emailB = `rls-b-${Date.now()}@test.local`;
const password = `rls-pw-${Date.now()}`;

let tenantA: string;
let tenantB: string;
let userA: string;
let userB: string;

beforeAll(async () => {
  const { data: a } = await admin
    .from('restaurants')
    .insert({ name: 'RLS Tenant A', timezone: 'Europe/Berlin' })
    .select()
    .single();
  tenantA = a!.id;
  const { data: b } = await admin
    .from('restaurants')
    .insert({ name: 'RLS Tenant B', timezone: 'Europe/Berlin' })
    .select()
    .single();
  tenantB = b!.id;

  const { data: ua } = await admin.auth.admin.createUser({ email: emailA, password, email_confirm: true });
  userA = ua.user!.id;
  const { data: ub } = await admin.auth.admin.createUser({ email: emailB, password, email_confirm: true });
  userB = ub.user!.id;

  await admin.from('memberships').insert([
    { user_id: userA, restaurant_id: tenantA, role: 'owner' },
    { user_id: userB, restaurant_id: tenantB, role: 'owner' }
  ]);
});

afterAll(async () => {
  await admin.from('memberships').delete().in('user_id', [userA, userB]);
  await admin.auth.admin.deleteUser(userA);
  await admin.auth.admin.deleteUser(userB);
  await admin.from('restaurants').delete().in('id', [tenantA, tenantB]);
});

describe('FND-03: RLS policies on base tables', () => {
  it('tenant A sees exactly one restaurant row (its own)', async () => {
    const c = tenantClient();
    await c.auth.signInWithPassword({ email: emailA, password });
    const { data, error } = await c.from('restaurants').select();
    expect(error).toBeNull();
    expect(data!.length).toBe(1);
    expect(data![0].id).toBe(tenantA);
  });

  it('tenant A sees exactly one membership row (its own)', async () => {
    const c = tenantClient();
    await c.auth.signInWithPassword({ email: emailA, password });
    const { data, error } = await c.from('memberships').select();
    expect(error).toBeNull();
    expect(data!.length).toBe(1);
    expect(data![0].user_id).toBe(userA);
  });

  it('tenant A sees zero transactions (none seeded in Phase 1)', async () => {
    const c = tenantClient();
    await c.auth.signInWithPassword({ email: emailA, password });
    const { data, error } = await c.from('transactions').select();
    expect(error).toBeNull();
    expect(data!.length).toBe(0);
  });
});
