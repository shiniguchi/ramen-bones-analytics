// Phase 8 — Visit Attribution MV integration tests.
//
// Tests VA-01 (visit_seq correctness), VA-02 (is_cash boolean),
// RLS wrapper isolation, and refresh_analytics_mvs() including
// the new visit_attribution_mv.
//
// Reuses the 3-customer fixture from Phase 3 plus a cash transaction.

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { adminClient, tenantClient } from '../helpers/supabase';
import { seed3CustomerFixture, cleanupFixture, FIXTURE_TXS } from './helpers/phase3-fixtures';

describe('Phase 8 — Visit Attribution MV', () => {
  let admin: ReturnType<typeof adminClient>;
  let restaurantId: string;

  beforeAll(async () => {
    admin = adminClient();

    // Get the test restaurant
    const { data, error } = await admin
      .from('restaurants')
      .select('id')
      .limit(1)
      .single();
    if (error) throw error;
    restaurantId = data!.id;

    // Clean + seed the 3-customer fixture (hash-a: 3 visits, hash-b: 3, hash-c: 2)
    await cleanupFixture(admin, restaurantId);
    await seed3CustomerFixture(admin, restaurantId);

    // Add a cash transaction (no card_hash) for is_cash testing
    const cashTx = {
      restaurant_id: restaurantId,
      source_tx_id: 'fixture-cash-1',
      card_hash: null,
      occurred_at: '2025-08-10T12:00:00+02:00',
      payment_method: 'cash',
      gross_cents: 900,
      tip_cents: 0,
      net_cents: Math.round(900 / 1.07)
    };
    const { error: cashErr } = await admin
      .from('transactions')
      .upsert(cashTx, { onConflict: 'restaurant_id,source_tx_id' });
    if (cashErr) throw cashErr;

    // Refresh all MVs (now includes visit_attribution_mv)
    const { error: refreshErr } = await admin.rpc('refresh_analytics_mvs');
    if (refreshErr) throw refreshErr;
  });

  afterAll(async () => {
    if (admin && restaurantId) {
      await cleanupFixture(admin, restaurantId);
      // Also clean up the cash fixture row
      await admin
        .from('transactions')
        .delete()
        .eq('restaurant_id', restaurantId)
        .eq('source_tx_id', 'fixture-cash-1');
    }
  });

  // VA-01: visit_seq correctness via ROW_NUMBER
  describe('VA-01 visit_seq correctness', () => {
    it('hash-a has visit_seq 1, 2, 3 ordered by occurred_at', async () => {
      const { data, error } = await admin.rpc('test_visit_attribution', {
        rid: restaurantId
      });
      if (error) throw error;

      const rows = (data as Array<{
        tx_id: string;
        card_hash: string;
        visit_seq: number | null;
        business_date: string;
      }>)
        .filter((r) => r.card_hash === 'hash-a')
        .sort((a, b) => a.business_date.localeCompare(b.business_date));

      expect(rows).toHaveLength(3);
      expect(rows[0].visit_seq).toBe(1);
      expect(rows[1].visit_seq).toBe(2);
      expect(rows[2].visit_seq).toBe(3);
    });

    it('hash-b has visit_seq 1, 2, 3 ordered by occurred_at', async () => {
      const { data, error } = await admin.rpc('test_visit_attribution', {
        rid: restaurantId
      });
      if (error) throw error;

      const rows = (data as Array<{
        card_hash: string;
        visit_seq: number | null;
        business_date: string;
      }>)
        .filter((r) => r.card_hash === 'hash-b')
        .sort((a, b) => a.business_date.localeCompare(b.business_date));

      expect(rows).toHaveLength(3);
      expect(rows[0].visit_seq).toBe(1);
      expect(rows[1].visit_seq).toBe(2);
      expect(rows[2].visit_seq).toBe(3);
    });

    it('hash-c has visit_seq 1, 2 ordered by occurred_at', async () => {
      const { data, error } = await admin.rpc('test_visit_attribution', {
        rid: restaurantId
      });
      if (error) throw error;

      const rows = (data as Array<{
        card_hash: string;
        visit_seq: number | null;
        business_date: string;
      }>)
        .filter((r) => r.card_hash === 'hash-c')
        .sort((a, b) => a.business_date.localeCompare(b.business_date));

      expect(rows).toHaveLength(2);
      expect(rows[0].visit_seq).toBe(1);
      expect(rows[1].visit_seq).toBe(2);
    });
  });

  // VA-02: is_cash boolean
  describe('VA-02 is_cash boolean', () => {
    it('cash transactions have is_cash=true and visit_seq=NULL', async () => {
      const { data, error } = await admin.rpc('test_visit_attribution', {
        rid: restaurantId
      });
      if (error) throw error;

      const cashRows = (data as Array<{
        card_hash: string | null;
        is_cash: boolean;
        visit_seq: number | null;
      }>).filter((r) => r.is_cash === true);

      expect(cashRows.length).toBeGreaterThanOrEqual(1);
      for (const row of cashRows) {
        expect(row.card_hash).toBeNull();
        expect(row.visit_seq).toBeNull();
      }
    });

    it('card transactions have is_cash=false and visit_seq >= 1', async () => {
      const { data, error } = await admin.rpc('test_visit_attribution', {
        rid: restaurantId
      });
      if (error) throw error;

      const cardRows = (data as Array<{
        card_hash: string | null;
        is_cash: boolean;
        visit_seq: number | null;
      }>).filter((r) => r.is_cash === false);

      // 8 card transactions in fixture (3+3+2)
      expect(cardRows.length).toBe(8);
      for (const row of cardRows) {
        expect(row.card_hash).not.toBeNull();
        expect(row.visit_seq).toBeGreaterThanOrEqual(1);
      }
    });
  });

  // RLS wrapper: tenant isolation via test_visit_attribution
  describe('RLS wrapper tenant isolation', () => {
    it('anon client cannot SELECT from visit_attribution_mv directly', async () => {
      const c = tenantClient();
      const { data, error } = await c.from('visit_attribution_mv').select('tx_id');
      const blocked = !!error || (data ?? []).length === 0;
      expect(blocked).toBe(true);
    });

    it('visit_attribution_v returns zero rows for anonymous (no JWT)', async () => {
      const c = tenantClient();
      const { data, error } = await c.from('visit_attribution_v').select('tx_id');
      expect(error).toBeNull();
      expect((data ?? []).length).toBe(0);
    });
  });

  // Refresh function includes visit_attribution_mv
  describe('refresh_analytics_mvs includes visit_attribution_mv', () => {
    it('refresh_analytics_mvs() succeeds (covers all 3 MVs)', async () => {
      const { error } = await admin.rpc('refresh_analytics_mvs');
      expect(error).toBeNull();
    });
  });
});
