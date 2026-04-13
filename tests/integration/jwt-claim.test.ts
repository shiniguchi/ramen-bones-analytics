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
    .insert({ name: 'Claim TZ', timezone: 'Europe/Berlin' })
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

describe('FND-02: Custom Access Token Hook injects top-level restaurant_id', () => {
  it('top-level claims.restaurant_id present after signInWithPassword', async () => {
    const c = tenantClient();
    const { data, error } = await c.auth.signInWithPassword({ email, password });
    expect(error).toBeNull();
    const token = data.session!.access_token;
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    // Top-level claim (Pitfall B): restaurant_id must NOT be nested under app_metadata
    expect(payload.restaurant_id).toBe(restaurantId);
    expect(payload.app_metadata?.restaurant_id).toBeUndefined();
  });
});
