import { describe, it, expect } from 'vitest';
import { adminClient } from '../helpers/supabase';

const admin = adminClient();

describe('FND-04: kpi_daily_mv wrapper template', () => {
  it('kpi_daily_mv has a unique index', async () => {
    const { data, error } = await admin
      .from('pg_indexes')
      .select('indexname, indexdef')
      .eq('schemaname', 'public')
      .eq('tablename', 'kpi_daily_mv');
    expect(error).toBeNull();
    const unique = (data ?? []).find((r: { indexdef: string }) => /UNIQUE/i.test(r.indexdef));
    expect(unique).toBeDefined();
  });

  it('authenticated role has NO SELECT on kpi_daily_mv', async () => {
    const { data, error } = await admin.rpc('test_table_privileges', {
      table_name: 'kpi_daily_mv',
      role_name: 'authenticated'
    });
    expect(error).toBeNull();
    const privs = (data ?? []).map((r: { privilege_type: string }) => r.privilege_type);
    expect(privs).not.toContain('SELECT');
  });

  it('authenticated role DOES have SELECT on kpi_daily_v', async () => {
    const { data, error } = await admin.rpc('test_table_privileges', {
      table_name: 'kpi_daily_v',
      role_name: 'authenticated'
    });
    expect(error).toBeNull();
    const privs = (data ?? []).map((r: { privilege_type: string }) => r.privilege_type);
    expect(privs).toContain('SELECT');
  });
});
