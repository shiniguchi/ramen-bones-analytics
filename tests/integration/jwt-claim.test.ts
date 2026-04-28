import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminClient, tenantClient } from '../helpers/supabase';

const admin = adminClient();
const email = `claim-${Date.now()}@test.local`;
const password = `claim-pw-${Date.now()}`;
let userId: string;
let restaurantId: string;

beforeAll(async () => {
  const { data: r } = await admin
    .from('restaurants')
    .insert({ name: 'Claim TZ', timezone: 'Europe/Berlin', slug: `claim-tz-${crypto.randomUUID()}` })
    .select()
    .single();
  restaurantId = r!.id;
  const { data: u } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  userId = u.user!.id;
  await admin
    .from('memberships')
    .insert({ user_id: userId, restaurant_id: restaurantId, role: 'owner' });
});

afterAll(async () => {
  await admin.from('memberships').delete().eq('user_id', userId);
  await admin.auth.admin.deleteUser(userId);
  await admin.from('restaurants').delete().eq('id', restaurantId);
});

describe('FND-02 / Gap B: Custom Access Token Hook injects top-level restaurant_id', () => {
  it('top-level claims.restaurant_id present after signInWithPassword', async () => {
    const c = tenantClient();
    const { data, error } = await c.auth.signInWithPassword({ email, password });
    expect(error).toBeNull();
    const token = data.session!.access_token;
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    // Gap B regression guard: if custom_access_token_hook is not SECURITY
    // DEFINER, GoTrue reads 0 rows from memberships under RLS and mints a
    // JWT without restaurant_id. Migration 0015 restores SECURITY DEFINER.
    expect(
      payload.restaurant_id,
      'Gap B regression: custom_access_token_hook is not SECURITY DEFINER, so GoTrue read 0 rows from memberships under RLS and minted a JWT without restaurant_id. See supabase/migrations/0015_auth_hook_security_definer.sql.'
    ).toBe(restaurantId);
    // Top-level claim (Pitfall B): restaurant_id must NOT be nested under app_metadata
    expect(payload.app_metadata?.restaurant_id).toBeUndefined();
  });
});
