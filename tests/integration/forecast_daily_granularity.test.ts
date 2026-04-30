import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminClient } from '../helpers/supabase';

// Phase 15-09 D-14: granularity column on forecast_daily.
// Verifies the migration 0057 contract behaviourally — schema shape via
// the existing test_table_columns RPC, plus insert-based proof of CHECK,
// NOT NULL, and PK uniqueness rules. PG behavioural assertions are more
// robust than pg_catalog snapshots: they catch any future change that
// loosens the constraint without leaving a CHECK in place.

const admin = adminClient();
const stamp = `g14-${Date.now()}`;
let tenantId: string;

beforeAll(async () => {
  const { data: r, error } = await admin
    .from('restaurants')
    .insert({ name: `granularity-${stamp}`, timezone: 'Europe/Berlin', slug: `g14-${crypto.randomUUID()}` })
    .select()
    .single();
  if (error) throw error;
  tenantId = r!.id;
});

afterAll(async () => {
  // Order matters: forecast_daily references restaurants(id).
  await admin.from('forecast_daily').delete().eq('restaurant_id', tenantId);
  await admin.from('restaurants').delete().eq('id', tenantId);
});

describe('Phase 15-09: forecast_daily.granularity column', () => {
  it('granularity column exists on forecast_daily', async () => {
    const { data, error } = await admin.rpc('test_table_columns', { p_table_name: 'forecast_daily' });
    expect(error).toBeNull();
    const cols = ((data ?? []) as Array<{ column_name: string; data_type: string; is_nullable: string }>);
    const granularity = cols.find((c) => c.column_name === 'granularity');
    expect(granularity).toBeDefined();
    // text type and NOT NULL — `is_nullable` is 'NO' (note: helper returns
    // pg_type.typname, so 'text' is the canonical lowercase).
    expect(granularity!.data_type).toBe('text');
    expect(granularity!.is_nullable).toBe('NO');
  });

  it('CHECK constraint rejects granularity = "hourly" (out of allowed set)', async () => {
    const { error } = await admin.from('forecast_daily').insert({
      restaurant_id: tenantId,
      kpi_name: 'revenue_eur',
      target_date: '2099-02-01',
      model_name: `${stamp}-check`,
      granularity: 'hourly',
      run_date: '2099-02-01',
      forecast_track: 'bau',
      yhat: 1.0,
      yhat_lower: 0.5,
      yhat_upper: 1.5,
    } as never);
    // CHECK violation surfaces as a 400-class error from PostgREST.
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/check|granularity/i);
  });

  it('NOT NULL: omitting granularity fails (DEFAULT was dropped post-backfill)', async () => {
    const { error } = await admin.from('forecast_daily').insert({
      restaurant_id: tenantId,
      kpi_name: 'revenue_eur',
      target_date: '2099-02-02',
      model_name: `${stamp}-notnull`,
      // granularity intentionally omitted
      run_date: '2099-02-02',
      forecast_track: 'bau',
      yhat: 1.0,
      yhat_lower: 0.5,
      yhat_upper: 1.5,
    } as never);
    // NOT NULL violation also surfaces as an error from PostgREST.
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/null|granularity/i);
  });

  it('PK includes granularity: two rows differ only by granularity → both insert successfully', async () => {
    // Phase 14's PK was 6-column; Phase 15-09's PK is 7-column with granularity.
    // If granularity were NOT in the PK, the second insert would conflict on
    // the natural key. If it IS in the PK (correct), both rows coexist.
    const base = {
      restaurant_id: tenantId,
      kpi_name: 'revenue_eur',
      target_date: '2099-03-01',
      model_name: `${stamp}-pk`,
      run_date: '2099-03-01',
      forecast_track: 'bau',
      yhat: 10.0,
      yhat_lower: 8.0,
      yhat_upper: 12.0,
    };
    const { error: e1 } = await admin.from('forecast_daily').insert({ ...base, granularity: 'day' } as never);
    expect(e1).toBeNull();
    const { error: e2 } = await admin.from('forecast_daily').insert({ ...base, granularity: 'week' } as never);
    expect(e2).toBeNull();

    // And inserting an exact duplicate of either row DOES still conflict — proves
    // the PK is enforced; granularity widens the key but does not remove uniqueness.
    const { error: dupe } = await admin.from('forecast_daily').insert({ ...base, granularity: 'day' } as never);
    expect(dupe).not.toBeNull();
  });

  it('valid grain values "day", "week", "month" all insert successfully', async () => {
    const base = {
      restaurant_id: tenantId,
      kpi_name: 'invoice_count',
      target_date: '2099-04-01',
      model_name: `${stamp}-valid`,
      run_date: '2099-04-01',
      forecast_track: 'bau',
      yhat: 5.0,
      yhat_lower: 4.0,
      yhat_upper: 6.0,
    };
    for (const g of ['day', 'week', 'month'] as const) {
      const { error } = await admin.from('forecast_daily').insert({ ...base, granularity: g } as never);
      expect(error, `granularity=${g}`).toBeNull();
    }
  });

  it('forecast_with_actual_v exposes granularity column', async () => {
    const { data, error } = await admin.rpc('test_table_columns', { p_table_name: 'forecast_with_actual_v' });
    expect(error).toBeNull();
    const names = ((data ?? []) as Array<{ column_name: string }>).map((c) => c.column_name);
    expect(names).toContain('granularity');
    // Sanity: existing Phase 14 columns are still present after the rebuild.
    expect(names).toContain('restaurant_id');
    expect(names).toContain('kpi_name');
    expect(names).toContain('target_date');
    expect(names).toContain('forecast_track');
    expect(names).toContain('actual_value');
  });

  it('forecast_daily_mv exposes granularity column (raw MV via service_role)', async () => {
    // service_role bypasses the REVOKE; this asserts the MV definition itself
    // includes granularity in its select-list (consumed by 15-11 endpoint).
    const { data, error } = await admin.rpc('test_table_columns', { p_table_name: 'forecast_daily_mv' });
    expect(error).toBeNull();
    const names = ((data ?? []) as Array<{ column_name: string }>).map((c) => c.column_name);
    expect(names).toContain('granularity');
    expect(names).toContain('restaurant_id');
    expect(names).toContain('kpi_name');
    expect(names).toContain('target_date');
  });

  it('backfill: pre-migration rows are labelled granularity=day', async () => {
    // Plan 15-09 added the granularity column with DEFAULT 'day' before
    // dropping the default. Any row that existed before migration 0057
    // ran (i.e., run_date < 2026-05-01) MUST have been backfilled to 'day'.
    // After a fresh `supabase db reset` the table may be empty — that's
    // fine, the property holds vacuously. The point of this test is to
    // catch a future regression where someone re-orders the migration
    // steps (e.g., moves DROP DEFAULT before backfill).
    const { data, error } = await admin
      .from('forecast_daily')
      .select('granularity, run_date')
      .lt('run_date', '2026-05-01');
    expect(error).toBeNull();
    for (const row of data ?? []) {
      expect(row.granularity).toBe('day');
    }
  });
});
