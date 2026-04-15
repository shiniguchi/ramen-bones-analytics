import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runIngest } from '../../scripts/ingest/index';
import { adminClient } from '../helpers/supabase';

// Plan 02-04 Task 1: prove ING-02 — a second runIngest over the same fixture
// is a zero-diff no-op on both grains.

const HAS_TEST_ENV =
  !!process.env.TEST_SUPABASE_URL &&
  !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

const FIXTURE_BUCKET = 'orderbird-raw';
const FIXTURE_OBJECT = 'test/sample.csv';
const FIXTURE_PATH = resolve(__dirname, 'fixtures/sample.csv');

let restaurantId: string;

async function setupTestEnv() {
  process.env.SUPABASE_URL = process.env.TEST_SUPABASE_URL!;
  process.env.SUPABASE_SERVICE_ROLE_KEY =
    process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!;
  process.env.ORDERBIRD_CSV_BUCKET = FIXTURE_BUCKET;
  process.env.ORDERBIRD_CSV_OBJECT = FIXTURE_OBJECT;

  const db = adminClient();

  const { data: restaurants, error: rErr } = await db
    .from('restaurants')
    .select('id')
    .limit(1);
  if (rErr) throw new Error(`Restaurant lookup failed: ${rErr.message}`);
  if (!restaurants || restaurants.length === 0) {
    throw new Error('No restaurant seeded in TEST project');
  }
  restaurantId = restaurants[0].id;
  process.env.RESTAURANT_ID = restaurantId;

  await db.from('transactions').delete().eq('restaurant_id', restaurantId);
  await db
    .from('stg_orderbird_order_items')
    .delete()
    .eq('restaurant_id', restaurantId);

  const csvBytes = readFileSync(FIXTURE_PATH);
  const { error: upErr } = await db.storage
    .from(FIXTURE_BUCKET)
    .upload(FIXTURE_OBJECT, csvBytes, {
      contentType: 'text/csv',
      upsert: true,
    });
  if (upErr) throw new Error(`Fixture upload failed: ${upErr.message}`);
}

describe('runIngest idempotency (ING-02, ING-05)', () => {
  beforeAll(async () => {
    if (!HAS_TEST_ENV) return;
    await setupTestEnv();
  });

  (HAS_TEST_ENV ? it : it.skip)(
    'two consecutive runs against same fixture produce zero diff',
    async () => {
      const db = adminClient();

      // First run establishes the baseline.
      const first = await runIngest({ dryRun: false });
      expect(first.errors).toBe(0);

      const { count: stgBefore } = await db
        .from('stg_orderbird_order_items')
        .select('*', { count: 'exact', head: true })
        .eq('restaurant_id', restaurantId);
      const { count: txBefore } = await db
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .eq('restaurant_id', restaurantId);

      // Second run — must be a no-op.
      const second = await runIngest({ dryRun: false });
      expect(second.errors).toBe(0);
      expect(second.transactions_new).toBe(0);

      const { count: stgAfter } = await db
        .from('stg_orderbird_order_items')
        .select('*', { count: 'exact', head: true })
        .eq('restaurant_id', restaurantId);
      const { count: txAfter } = await db
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .eq('restaurant_id', restaurantId);

      expect(stgAfter).toBe(stgBefore);
      expect(txAfter).toBe(txBefore);
    },
  );

  // 07-03: loader writes wl_issuing_country + card_type on every ingest (DM-03).
  // Migration 0019 has been applied to TEST project per 07-02 SUMMARY.
  (HAS_TEST_ENV ? it : it.skip)(
    'two sequential runs leave wl_issuing_country + card_type unchanged on re-ingested rows',
    async () => {
      const db = adminClient();

      // First run (may already have been run by previous test).
      await runIngest({ dryRun: false });

      // Snapshot T-VISA before the second run — a canonical card-txn fixture
      // row with wl_payment_type=Visa, wl_issuing_country=DE.
      const { data: before } = await db
        .from('transactions')
        .select('source_tx_id, wl_issuing_country, card_type')
        .eq('restaurant_id', restaurantId)
        .eq('source_tx_id', 'T-VISA')
        .single();

      expect(before?.wl_issuing_country).toBe('DE');
      expect(before?.card_type).toBe('visa');

      // Second run must be zero-diff on new rows; re-upserted rows are
      // reported as updated (supabase has no insert-vs-update signal, so we
      // only pin transactions_new=0 here).
      const second = await runIngest({ dryRun: false });
      expect(second.transactions_new).toBe(0);

      const { data: after } = await db
        .from('transactions')
        .select('source_tx_id, wl_issuing_country, card_type')
        .eq('restaurant_id', restaurantId)
        .eq('source_tx_id', 'T-VISA')
        .single();

      expect(after?.wl_issuing_country).toBe(before?.wl_issuing_country);
      expect(after?.card_type).toBe(before?.card_type);

      // T-FALLBACK: POS fallback path. wl_payment_type='', wl_card_type='',
      // POS card_type='Visa' → canonical 'visa'. wl_issuing_country='NL'.
      const { data: fallback } = await db
        .from('transactions')
        .select('wl_issuing_country, card_type')
        .eq('restaurant_id', restaurantId)
        .eq('source_tx_id', 'T-FALLBACK')
        .single();
      expect(fallback?.card_type).toBe('visa');
      expect(fallback?.wl_issuing_country).toBe('NL');

      // T-UNK: cash invoice, all wl_* + POS empty → card_type='unknown',
      // wl_issuing_country=NULL (D-06 honest NULL).
      const { data: unk } = await db
        .from('transactions')
        .select('wl_issuing_country, card_type')
        .eq('restaurant_id', restaurantId)
        .eq('source_tx_id', 'T-UNK')
        .single();
      expect(unk?.card_type).toBe('unknown');
      expect(unk?.wl_issuing_country).toBeNull();
    },
  );
});
