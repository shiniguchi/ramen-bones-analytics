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

  // TODO(07-03): unskip when loader writes wl_issuing_country + card_type (DM-03).
  // Skip-guarded: only run if the wl_issuing_country column exists on transactions.
  (HAS_TEST_ENV ? it.skip : it.skip)(
    'two sequential runs leave wl_issuing_country + card_type unchanged on re-ingested rows',
    async () => {
      const db = adminClient();

      // Check the column exists — if not, skip (Wave 0 / pre-migration state).
      const colCheck = await db.rpc('exec_sql_read', {
        sql: `
          select 1
            from information_schema.columns
           where table_schema = 'public'
             and table_name   = 'transactions'
             and column_name  = 'wl_issuing_country'
        `,
      });
      if (!colCheck.data || (colCheck.data as unknown[]).length === 0) return;

      // First run (may already have been run by previous test).
      await runIngest({ dryRun: false });

      // Snapshot one re-ingested invoice before the second run.
      const { data: before } = await db
        .from('transactions')
        .select('source_tx_id, wl_issuing_country, card_type')
        .eq('restaurant_id', restaurantId)
        .eq('source_tx_id', 'T-3')
        .single();

      // Second run must be zero-diff.
      const second = await runIngest({ dryRun: false });
      expect(second.transactions_new).toBe(0);
      expect(second.transactions_updated).toBe(0);

      const { data: after } = await db
        .from('transactions')
        .select('source_tx_id, wl_issuing_country, card_type')
        .eq('restaurant_id', restaurantId)
        .eq('source_tx_id', 'T-3')
        .single();

      expect(after?.wl_issuing_country).toBe(before?.wl_issuing_country);
      expect(after?.card_type).toBe(before?.card_type);
    },
  );
});
