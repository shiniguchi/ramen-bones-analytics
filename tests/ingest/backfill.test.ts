import { describe, it, expect } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Phase 7 DM-02: Migration 0019 backfill populates
// transactions.wl_issuing_country + transactions.card_type from
// stg_orderbird_order_items via DISTINCT ON per (restaurant_id, invoice_number).
// 07-01 authored this as a RED scaffold with placeholder bodies; 07-02 replaces
// those with real assertions. Backfill assertions run against DEV (where real
// historical stg data lives) — per plan acceptance criteria which explicitly
// cite "`SELECT count(*) FROM transactions WHERE wl_issuing_country IS NOT NULL`
// > 0 on DEV" and "20-invoice spot-check passes against raw CSV".
//
// TEST project is reserved for mutating loader integration tests; backfill is
// a one-shot historical operation that only has meaningful data on DEV.

const HAS_DEV_ENV =
  !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

function devAdminClient(): SupabaseClient {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

// The fresh-env helper 'adminClient' reads process.env at call time; backfill
// tests deliberately bypass the TEST_* override used by loader integration
// tests and read the DEV vars directly.
const adminClient = devAdminClient;

describe.skipIf(!HAS_DEV_ENV)('migration 0019 backfill (DM-02) [DEV]', () => {
  it('D-06 weak guard: at least one row has wl_issuing_country NOT NULL', async () => {
    const db = adminClient();
    const { count, error } = await db
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .not('wl_issuing_country', 'is', null);
    expect(error).toBeNull();
    expect(count ?? 0).toBeGreaterThan(0);
  });

  it('SC-4: DE plus at least one non-DE country exists (tourist sanity)', async () => {
    const db = adminClient();
    const { data: de } = await db
      .from('transactions')
      .select('wl_issuing_country')
      .eq('wl_issuing_country', 'DE')
      .limit(1);
    expect((de ?? []).length).toBeGreaterThan(0);

    const { data: nonDe } = await db
      .from('transactions')
      .select('wl_issuing_country')
      .not('wl_issuing_country', 'is', null)
      .neq('wl_issuing_country', 'DE')
      .limit(1);
    expect((nonDe ?? []).length).toBeGreaterThan(0);
  });

  it('card_type values stay inside the canonical set', async () => {
    const db = adminClient();
    const { data, error } = await db
      .from('transactions')
      .select('card_type')
      .not('card_type', 'is', null)
      .limit(10000);
    expect(error).toBeNull();
    const allowed = new Set([
      'visa',
      'mastercard',
      'amex',
      'maestro',
      'girocard',
      'other',
      'unknown',
    ]);
    const distinct = new Set((data ?? []).map((r: any) => r.card_type));
    for (const v of distinct) {
      expect(allowed.has(v), `unexpected bucket ${v}`).toBe(true);
    }
  });

  it('20-invoice spot check: every backfilled row has a matching stg row', async () => {
    const db = adminClient();
    const { data: sample, error } = await db
      .from('transactions')
      .select('restaurant_id, source_tx_id, wl_issuing_country, card_type')
      .not('wl_issuing_country', 'is', null)
      .limit(20);
    expect(error).toBeNull();
    expect((sample ?? []).length).toBe(20);

    for (const t of sample ?? []) {
      const { data: stg } = await db
        .from('stg_orderbird_order_items')
        .select(
          'wl_issuing_country, wl_payment_type, wl_card_type, card_type, row_index',
        )
        .eq('restaurant_id', (t as any).restaurant_id)
        .eq('invoice_number', (t as any).source_tx_id)
        .order('row_index', { ascending: true })
        .limit(1);
      const first = (stg ?? [])[0] as any;
      expect(first, `stg row for ${(t as any).source_tx_id}`).toBeTruthy();
      // Backfill populated card_type for every stg-matched row.
      expect((t as any).card_type).toBeTruthy();
    }
  });
});
