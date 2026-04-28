import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminClient } from '../helpers/supabase';

const admin = adminClient();
let restaurantId: string;

beforeAll(async () => {
  const { data } = await admin
    .from('restaurants')
    .insert({ name: 'TZ Fixture', timezone: 'Europe/Berlin', slug: `tz-fixture-${crypto.randomUUID()}` })
    .select()
    .single();
  restaurantId = data!.id;

  // Pitfall E: always write fixtures with explicit +00 UTC offset.
  // 21:45 UTC on 2026-04-13 = 23:45 Europe/Berlin (CEST, same day)
  // 22:30 UTC on 2026-04-13 = 00:30 Europe/Berlin next day (2026-04-14)
  await admin.from('transactions').insert([
    {
      restaurant_id: restaurantId,
      source_tx_id: 'same-day',
      occurred_at: '2026-04-13 21:45:00+00',
      gross_cents: 100,
      net_cents: 90
    },
    {
      restaurant_id: restaurantId,
      source_tx_id: 'next-day',
      occurred_at: '2026-04-13 22:30:00+00',
      gross_cents: 200,
      net_cents: 180
    }
  ]);
});

afterAll(async () => {
  await admin.from('transactions').delete().eq('restaurant_id', restaurantId);
  await admin.from('restaurants').delete().eq('id', restaurantId);
});

describe('FND-08: business_date derivation via AT TIME ZONE (Europe/Berlin)', () => {
  it('23:45 Berlin lands on 2026-04-13 and 00:30 Berlin lands on 2026-04-14', async () => {
    const { data, error } = await admin.rpc('test_business_date', { rid: restaurantId });
    expect(error).toBeNull();
    const byId = Object.fromEntries(
      (data ?? []).map((r: { source_tx_id: string; business_date: string }) => [
        r.source_tx_id,
        r.business_date
      ])
    );
    expect(byId['same-day']).toBe('2026-04-13');
    expect(byId['next-day']).toBe('2026-04-14');
  });
});
