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
});
