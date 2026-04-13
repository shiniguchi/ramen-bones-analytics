import { describe, it, expect } from 'vitest';
// Plan 03 will create scripts/ingest/index.ts. RED until then.
import { runIngest } from '../../scripts/ingest/index';
import { adminClient } from '../helpers/supabase';

const HAS_TEST_ENV = !!process.env.TEST_SUPABASE_URL;

describe('runIngest idempotency (ING-02, ING-05)', () => {
  (HAS_TEST_ENV ? it : it.skip)(
    'two consecutive runs against same fixture produce zero diff',
    async () => {
      process.env.ORDERBIRD_CSV_OBJECT =
        'tests/ingest/fixtures/sample.csv';

      const db = adminClient();

      // First run — establishes baseline
      const first = await runIngest({ dryRun: false });
      expect(first.errors).toBe(0);

      const { count: stgBefore } = await db
        .from('stg_orderbird_order_items')
        .select('*', { count: 'exact', head: true });
      const { count: txBefore } = await db
        .from('transactions')
        .select('*', { count: 'exact', head: true });

      // Second run — should be a no-op
      const second = await runIngest({ dryRun: false });
      expect(second.errors).toBe(0);
      expect(second.transactions_new).toBe(0);
      expect(second.transactions_updated).toBe(0);

      const { count: stgAfter } = await db
        .from('stg_orderbird_order_items')
        .select('*', { count: 'exact', head: true });
      const { count: txAfter } = await db
        .from('transactions')
        .select('*', { count: 'exact', head: true });

      expect(stgAfter).toBe(stgBefore);
      expect(txAfter).toBe(txBefore);
    }
  );
});
