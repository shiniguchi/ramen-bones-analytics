import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { adminClient } from '../helpers/supabase';

const admin = adminClient();
const email = `session-${Date.now()}@test.local`;
const password = `session-pw-${Date.now()}`;
let userId: string;
let restaurantId: string;

beforeAll(async () => {
  const { data: r } = await admin
    .from('restaurants')
    .insert({ name: 'Session TZ', timezone: 'Europe/Berlin' })
    .select()
    .single();
  restaurantId = r!.id;
  const { data: u } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  userId = u.user!.id;
  await admin
    .from('memberships')
    .insert({ user_id: userId, restaurant_id: restaurantId, role: 'owner' });
  // Ensure kpi_daily_mv snapshot includes the newly seeded tenant
  await admin.rpc('refresh_kpi_daily_mv');
});

afterAll(async () => {
  await admin.from('memberships').delete().eq('user_id', userId);
  await admin.auth.admin.deleteUser(userId);
  await admin.from('restaurants').delete().eq('id', restaurantId);
});

describe('FND-06: session survives simulated browser refresh (Phase 1 proxy)', () => {
  it('rehydrating a new client with captured tokens returns the same claims', async () => {
    const URL = process.env.TEST_SUPABASE_URL!;
    const ANON = process.env.TEST_SUPABASE_ANON_KEY!;
    const first = createClient(URL, ANON, { auth: { persistSession: false } });
    const { data } = await first.auth.signInWithPassword({ email, password });
    const access = data.session!.access_token;
    const refresh = data.session!.refresh_token;

    // Simulate new browser session: fresh client, hydrate with captured tokens
    const second = createClient(URL, ANON, { auth: { persistSession: false } });
    await second.auth.setSession({ access_token: access, refresh_token: refresh });

    const { data: user } = await second.auth.getUser();
    expect(user.user?.id).toBe(userId);

    const { data: rows, error } = await second.from('kpi_daily_v').select();
    expect(error).toBeNull();
    expect(
      (rows ?? []).every((r: { restaurant_id: string }) => r.restaurant_id === restaurantId)
    ).toBe(true);
  });
});
