import { describe, it, expect } from 'vitest';
import { adminClient, tenantClient } from '../helpers/supabase';

const admin = adminClient();

// Phase 13 EXT-08: hybrid RLS verification across all 7 new tables.
// Shared location-keyed tables read with `using (true)` for any auth'd user;
// writes are revoked from authenticated/anon. Tenant-scoped tables key on
// auth.jwt()->>'restaurant_id'.

describe('Phase 13 schema: weather_daily', () => {
  it('table exists with the expected columns', async () => {
    const { data, error } = await admin.rpc('test_table_columns', {
      p_table_name: 'weather_daily'
    });
    expect(error).toBeNull();
    const cols = (data ?? []).reduce(
      (acc: Record<string, any>, c: any) => ({ ...acc, [c.column_name]: c }),
      {} as Record<string, any>
    );
    expect(cols['date']).toBeDefined();
    expect(cols['location']).toBeDefined();
    expect(cols['temp_min_c']).toBeDefined();
    expect(cols['temp_max_c']).toBeDefined();
    expect(cols['precip_mm']).toBeDefined();
    expect(cols['provider']).toBeDefined();
    expect(cols['fetched_at']).toBeDefined();
  });

  it('anon client can SELECT but cannot INSERT', async () => {
    const c = tenantClient();
    const { error: selErr } = await c.from('weather_daily').select('date').limit(1);
    expect(selErr).toBeNull();
    const { error: insErr } = await c
      .from('weather_daily')
      .insert({ date: '2099-01-01', location: 'berlin', provider: 'test' });
    expect(insErr).not.toBeNull();
  });
});
