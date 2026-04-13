import { describe, it, expect, beforeAll } from 'vitest';
// Plan 03 will create scripts/ingest/index.ts. Until then this import is the
// RED signal — Cannot find module — that the wave 0 harness is wired.
import { runIngest } from '../../scripts/ingest/index';
import { adminClient } from '../helpers/supabase';

const HAS_TEST_ENV = !!process.env.TEST_SUPABASE_URL;

describe('runIngest end-to-end (ING-01, ING-02)', () => {
  beforeAll(() => {
    if (!HAS_TEST_ENV) return;
  });

  (HAS_TEST_ENV ? it : it.skip)(
    'ingests fixture CSV → staging row count = CSV data row count',
    async () => {
      process.env.ORDERBIRD_CSV_OBJECT =
        'tests/ingest/fixtures/sample.csv';
      const report = await runIngest({ dryRun: false });
      expect(report.rows_read).toBe(24);
      expect(report.staging_upserted).toBe(24);

      const db = adminClient();
      const { count } = await db
        .from('stg_orderbird_order_items')
        .select('*', { count: 'exact', head: true });
      expect(count).toBe(24);
    }
  );

  (HAS_TEST_ENV ? it : it.skip)(
    'transactions row count = unique positive invoices (15 of 16)',
    async () => {
      const db = adminClient();
      const { count } = await db
        .from('transactions')
        .select('*', { count: 'exact', head: true });
      // T-5 (negative total) is dropped → 16 - 1 = 15
      expect(count).toBe(15);
    }
  );

  (HAS_TEST_ENV ? it : it.skip)(
    'report flags missing-worldline and excluded-cash counters',
    async () => {
      process.env.ORDERBIRD_CSV_OBJECT =
        'tests/ingest/fixtures/sample.csv';
      const report = await runIngest({ dryRun: true });
      expect(report.missing_worldline_rows).toBe(1);
      expect(report.cash_rows_excluded).toBeGreaterThanOrEqual(1);
    }
  );
});
