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

  it('RLS policy pipeline_runs_read exists with global+tenant rule', async () => {
    const { data, error } = await admin.rpc('test_table_policies', { p_table_name: 'pipeline_runs' });
    expect(error).toBeNull();
    const policies = (data ?? []).map((p: any) => p.policyname);
    expect(policies).toContain('pipeline_runs_read');
  });
});
