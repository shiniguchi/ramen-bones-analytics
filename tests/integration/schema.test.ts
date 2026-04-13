import { describe, it, expect } from 'vitest';
import { adminClient } from '../helpers/supabase';

const admin = adminClient();

describe('FND-01: tenancy schema exists with RLS enabled', () => {
  it('restaurants, memberships, transactions all have rowsecurity = true', async () => {
    const { data, error } = await admin.rpc('test_rls_enabled', {
      tables: ['restaurants', 'memberships', 'transactions']
    });
    expect(error).toBeNull();
    const byName = Object.fromEntries(
      (data ?? []).map((r: { tablename: string; rls_enabled: boolean }) => [r.tablename, r.rls_enabled])
    );
    expect(byName['restaurants']).toBe(true);
    expect(byName['memberships']).toBe(true);
    expect(byName['transactions']).toBe(true);
  });
});
