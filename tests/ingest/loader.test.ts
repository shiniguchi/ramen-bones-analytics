import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runIngest } from '../../scripts/ingest/index';
import { adminClient } from '../helpers/supabase';

// Plan 02-04 Task 1: drive runIngest against the TEST Supabase project with
// the fixture CSV. We override the generic SUPABASE_* env vars with the TEST_*
// pair at runtime (loadEnv re-reads per call), upload the fixture to the
// private orderbird-raw bucket, and scope truncation by restaurant_id so the
// test never touches unrelated rows.

const HAS_TEST_ENV =
  !!process.env.TEST_SUPABASE_URL &&
  !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

const FIXTURE_BUCKET = 'orderbird-raw';
const FIXTURE_OBJECT = 'test/sample.csv';
const FIXTURE_PATH = resolve(
  __dirname,
  'fixtures/sample.csv',
);

let restaurantId: string;

async function setupTestEnv() {
  // Override any DEV values that dotenv loaded from .env — runIngest's loadEnv
  // re-reads process.env on every invocation so this is sufficient.
  process.env.SUPABASE_URL = process.env.TEST_SUPABASE_URL!;
  process.env.SUPABASE_SERVICE_ROLE_KEY =
    process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!;
  process.env.ORDERBIRD_CSV_BUCKET = FIXTURE_BUCKET;
  process.env.ORDERBIRD_CSV_OBJECT = FIXTURE_OBJECT;

  const db = adminClient();

  // Fetch the seeded restaurant row (0005_seed_tenant.sql inserts exactly one).
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

  // Truncate scoped to this restaurant_id so unrelated test data survives.
  await db.from('transactions').delete().eq('restaurant_id', restaurantId);
  await db
    .from('stg_orderbird_order_items')
    .delete()
    .eq('restaurant_id', restaurantId);

  // Upload fixture CSV to TEST bucket (upsert so re-runs are idempotent).
  const csvBytes = readFileSync(FIXTURE_PATH);
  const { error: upErr } = await db.storage
    .from(FIXTURE_BUCKET)
    .upload(FIXTURE_OBJECT, csvBytes, {
      contentType: 'text/csv',
      upsert: true,
    });
  if (upErr) throw new Error(`Fixture upload failed: ${upErr.message}`);
}

describe('runIngest end-to-end (ING-01, ING-02)', () => {
  beforeAll(async () => {
    if (!HAS_TEST_ENV) return;
    await setupTestEnv();
  });

  (HAS_TEST_ENV ? it : it.skip)(
    'ingests fixture CSV → staging row count = CSV data row count',
    async () => {
      const report = await runIngest({ dryRun: false });
      expect(report.errors).toBe(0);
      expect(report.rows_read).toBe(30);
      expect(report.staging_upserted).toBe(30);

      const db = adminClient();
      const { count } = await db
        .from('stg_orderbird_order_items')
        .select('*', { count: 'exact', head: true })
        .eq('restaurant_id', restaurantId);
      expect(count).toBe(30);
    },
  );

  (HAS_TEST_ENV ? it : it.skip)(
    'transactions row count = unique positive non-cash invoices (21 of 22)',
    async () => {
      const db = adminClient();
      const { count } = await db
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .eq('restaurant_id', restaurantId);
      // Phase 7 fixture extension: +6 new invoices (T-VISA, T-MC, T-GIRO,
      // T-UNK, T-OTHER, T-FALLBACK). T-UNK is cash (payment_method=Bar)
      // so it is excluded alongside T-2 / T-9. T-5 (negative total) is
      // still dropped. 22 original invoices + 6 new − 1 cash − 1 negative
      // − 2 existing cash = 21.
      expect(count).toBe(21);
    },
  );

  (HAS_TEST_ENV ? it : it.skip)(
    'report flags missing-worldline and excluded-cash counters',
    async () => {
      const report = await runIngest({ dryRun: true });
      // T-6 is the only card-intended row with blank wl_card_number. T-UNK is
      // cash (pm=Bar) so excluded from this counter; T-FALLBACK has wl_card_number
      // populated (only wl_card_type + wl_issuing_country are blank on fallback).
      expect(report.missing_worldline_rows).toBe(1);
      expect(report.cash_rows_excluded).toBeGreaterThanOrEqual(1);
    },
  );
});
