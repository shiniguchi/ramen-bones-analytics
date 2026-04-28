import { describe, it, expect } from 'vitest';
import { adminClient, tenantClient } from '../helpers/supabase';

const admin = adminClient();

// Phase 13 EXT-08: hybrid RLS verification.
// `weather_daily` is the first table covered (Task 2). Tasks 3–8 append
// `describe()` blocks for `holidays`, `school_holidays`, `transit_alerts`,
// `recurring_events`, `pipeline_runs` extension, and `shop_calendar`.
// Shared (location-keyed) tables read with `using (true)` for any auth'd
// user; writes are revoked from authenticated/anon. Tenant-scoped tables
// key on auth.jwt()->>'restaurant_id'.

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
    expect(cols['wind_kph']).toBeDefined();
    expect(cols['cloud_cover']).toBeDefined();
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

describe('Phase 13 schema: holidays', () => {
  it('table exists with the expected columns', async () => {
    const { data, error } = await admin.rpc('test_table_columns', { p_table_name: 'holidays' });
    expect(error).toBeNull();
    const names = (data ?? []).map((c: any) => c.column_name);
    expect(names).toContain('date');
    expect(names).toContain('name');
    expect(names).toContain('country_code');
    expect(names).toContain('subdiv_code');
    expect(names).toContain('fetched_at');
  });

  it('anon SELECT allowed, INSERT denied', async () => {
    const c = tenantClient();
    const { error: selErr } = await c.from('holidays').select('date').limit(1);
    expect(selErr).toBeNull();
    const { error: insErr } = await c
      .from('holidays')
      .insert({ date: '2099-01-01', name: 'fake', country_code: 'DE' });
    expect(insErr).not.toBeNull();
  });
});

describe('Phase 13 schema: school_holidays', () => {
  it('table exists with the expected columns', async () => {
    const { data, error } = await admin.rpc('test_table_columns', { p_table_name: 'school_holidays' });
    expect(error).toBeNull();
    const names = (data ?? []).map((c: any) => c.column_name);
    expect(names).toContain('state_code');
    expect(names).toContain('block_name');
    expect(names).toContain('start_date');
    expect(names).toContain('end_date');
    expect(names).toContain('year');
    expect(names).toContain('fetched_at');
  });

  it('anon SELECT allowed, INSERT denied', async () => {
    const c = tenantClient();
    const { error: selErr } = await c.from('school_holidays').select('start_date').limit(1);
    expect(selErr).toBeNull();
    const { error: insErr } = await c
      .from('school_holidays')
      .insert({ state_code: 'BE', block_name: 'Fake', start_date: '2099-01-01', end_date: '2099-01-02', year: 2099 });
    expect(insErr).not.toBeNull();
  });
});
