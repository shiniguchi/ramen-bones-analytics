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

describe('Phase 13 schema: transit_alerts', () => {
  it('table exists with the expected columns', async () => {
    const { data, error } = await admin.rpc('test_table_columns', { p_table_name: 'transit_alerts' });
    expect(error).toBeNull();
    const names = (data ?? []).map((c: any) => c.column_name);
    expect(names).toContain('alert_id');
    expect(names).toContain('title');
    expect(names).toContain('pub_date');
    expect(names).toContain('matched_keyword');
    expect(names).toContain('description');
    expect(names).toContain('source_url');
    expect(names).toContain('fetched_at');
  });

  it('anon SELECT allowed, INSERT denied', async () => {
    const c = tenantClient();
    const { error: selErr } = await c.from('transit_alerts').select('alert_id').limit(1);
    expect(selErr).toBeNull();
    const { error: insErr } = await c
      .from('transit_alerts')
      .insert({ alert_id: 'fake', title: 'Fake', pub_date: '2099-01-01T00:00:00Z', matched_keyword: 'Streik', source_url: 'https://example.test/' });
    expect(insErr).not.toBeNull();
  });
});

describe('Phase 13 schema: recurring_events', () => {
  it('table exists with the expected columns', async () => {
    const { data, error } = await admin.rpc('test_table_columns', { p_table_name: 'recurring_events' });
    expect(error).toBeNull();
    const names = (data ?? []).map((c: any) => c.column_name);
    expect(names).toContain('event_id');
    expect(names).toContain('name');
    expect(names).toContain('category');
    expect(names).toContain('start_date');
    expect(names).toContain('end_date');
    expect(names).toContain('impact_estimate');
    expect(names).toContain('source');
    expect(names).toContain('fetched_at');
  });

  it('anon SELECT allowed, INSERT denied', async () => {
    const c = tenantClient();
    const { error: selErr } = await c.from('recurring_events').select('event_id').limit(1);
    expect(selErr).toBeNull();
    const { error: insErr } = await c
      .from('recurring_events')
      .insert({ event_id: 'fake-2099', name: 'Fake', category: 'festival', start_date: '2099-01-01', end_date: '2099-01-02', impact_estimate: 'low' });
    expect(insErr).not.toBeNull();
  });

  it('pg_cron job recurring-events-yearly-reminder is scheduled on Sep 15', async () => {
    // cron.job is in the cron schema. PostgREST exposes only the schemas listed in
    // supabase/config.toml [api].schemas (default: public). Use the service-role
    // SQL passthrough via an RPC, OR query through the service-role REST endpoint
    // with the Accept-Profile header. Simpler: define a small SECURITY DEFINER RPC
    // that returns cron.job rows for a given jobname.
    // We add it inline in 0045 (see migration). Here we just call it.
    const { data, error } = await admin.rpc('test_cron_job_schedule', { p_jobname: 'recurring-events-yearly-reminder' });
    expect(error).toBeNull();
    const rows = (data ?? []) as Array<{ jobname: string; schedule: string }>;
    expect(rows.length).toBe(1);
    // Cron schedule format is `M H D Mon DOW`. We schedule at 09:00 UTC on Sep 15
    // which means dom=15 month=9. Assert those two fields appear in the schedule
    // string. Allow flexibility on min/hour wording.
    expect(rows[0].schedule).toMatch(/15\s+9/);
  });
});

describe('Phase 13 schema: pipeline_runs extension', () => {
  it('upstream_freshness_h and restaurant_id columns exist after ALTER', async () => {
    const { data, error } = await admin.rpc('test_table_columns', { p_table_name: 'pipeline_runs' });
    expect(error).toBeNull();
    const names = (data ?? []).map((c: any) => c.column_name);
    expect(names).toContain('upstream_freshness_h');
    expect(names).toContain('restaurant_id');
    // Skeleton columns must still be present (we only ADDed, never DROPed).
    expect(names).toContain('run_id');
    expect(names).toContain('step_name');
    expect(names).toContain('started_at');
    expect(names).toContain('finished_at');
    expect(names).toContain('status');
    expect(names).toContain('row_count');
    expect(names).toContain('error_msg');
    expect(names).toContain('commit_sha');
  });

  it('RLS policy pipeline_runs_read is strict tenant-scoped (REVIEW MS-2 lockdown via 0049)', async () => {
    const { data, error } = await admin.rpc('test_table_policies', { p_table_name: 'pipeline_runs' });
    expect(error).toBeNull();
    const policies = (data ?? []) as Array<{ policyname: string; cmd: string; qual: string }>;
    const readPolicy = policies.find((p) => p.policyname === 'pipeline_runs_read');
    expect(readPolicy).toBeDefined();
    // After 0049 the global-row OR clause is gone — the policy is purely
    // `restaurant_id::text = (auth.jwt() ->> 'restaurant_id')`. A future
    // regression that re-adds `restaurant_id is null OR ...` would be caught
    // here (REVIEW T-10).
    expect(readPolicy!.qual).toContain("auth.jwt()");
    expect(readPolicy!.qual).toContain("restaurant_id");
    expect(readPolicy!.qual).not.toMatch(/restaurant_id\s+is\s+null/i);
  });
});

describe('Phase 13 schema: pipeline_runs_status_v wrapper view (REVIEW MS-2)', () => {
  it('view exists and exposes only safe columns (no error_msg, no commit_sha)', async () => {
    // Use the helper RPC to introspect the view's column list. It works on
    // views as well as tables in pg_attribute.
    const { data, error } = await admin.rpc('test_table_columns', {
      p_table_name: 'pipeline_runs_status_v',
    });
    expect(error).toBeNull();
    const names = ((data ?? []) as Array<{ column_name: string }>).map((c) => c.column_name);
    // Safe columns must be present.
    expect(names).toContain('step_name');
    expect(names).toContain('status');
    expect(names).toContain('upstream_freshness_h');
    expect(names).toContain('finished_at');
    expect(names).toContain('restaurant_id');
    // Sensitive columns must NOT be exposed.
    expect(names).not.toContain('error_msg');
    expect(names).not.toContain('commit_sha');
  });
});

describe('Phase 13 schema: shop_calendar', () => {
  it('table exists with the expected columns', async () => {
    const { data, error } = await admin.rpc('test_table_columns', { p_table_name: 'shop_calendar' });
    expect(error).toBeNull();
    const names = (data ?? []).map((c: any) => c.column_name);
    expect(names).toContain('restaurant_id');
    expect(names).toContain('date');
    expect(names).toContain('is_open');
    expect(names).toContain('open_at');
    expect(names).toContain('close_at');
    expect(names).toContain('reason');
    expect(names).toContain('fetched_at');
  });

  it('tenant-scoped RLS policy shop_calendar_read exists', async () => {
    const { data, error } = await admin.rpc('test_table_policies', { p_table_name: 'shop_calendar' });
    expect(error).toBeNull();
    const policies = (data ?? []).map((p: any) => p.policyname);
    expect(policies).toContain('shop_calendar_read');
  });

  it('anon SELECT returns zero rows (no JWT) and INSERT denied', async () => {
    const c = tenantClient();
    // Without an auth'd session, the JWT-scoped policy filters everything out.
    const { data: rows, error: selErr } = await c.from('shop_calendar').select('date').limit(1);
    expect(selErr).toBeNull();
    expect((rows ?? []).length).toBe(0);
    const { error: insErr } = await c.from('shop_calendar').insert({
      restaurant_id: '00000000-0000-0000-0000-000000000000',
      date: '2099-01-01',
      is_open: false
    });
    expect(insErr).not.toBeNull();
  });
});
