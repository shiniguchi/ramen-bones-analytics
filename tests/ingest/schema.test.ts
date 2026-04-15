import { describe, it, expect } from 'vitest';
import { adminClient } from '../helpers/supabase';

// Phase 7 DM-01: transactions gains wl_issuing_country char(2) + card_type text
// via migration 0019. Wave 0 RED scaffold — skipped until Wave 1 lands the
// migration (07-02-PLAN.md).
//
// TODO(07-02): unskip when migration 0019_transactions_country_cardtype.sql ships.

const HAS_TEST_ENV =
  !!process.env.TEST_SUPABASE_URL &&
  !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

describe.skip('transactions schema — wl_issuing_country + card_type (DM-01)', () => {
  (HAS_TEST_ENV ? it : it.skip)(
    'wl_issuing_country column exists as char(2)',
    async () => {
      process.env.SUPABASE_URL = process.env.TEST_SUPABASE_URL!;
      process.env.SUPABASE_SERVICE_ROLE_KEY =
        process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!;
      const db = adminClient();
      const { data, error } = await db
        .rpc('exec_sql_read', {
          sql: `
            select column_name, data_type, character_maximum_length
              from information_schema.columns
             where table_schema = 'public'
               and table_name   = 'transactions'
               and column_name  = 'wl_issuing_country'
          `,
        });
      // Fallback to direct from() if rpc helper not available.
      expect(error).toBeNull();
      const row = (data as Array<{
        column_name: string;
        data_type: string;
        character_maximum_length: number | null;
      }> | null)?.[0];
      expect(row).toBeDefined();
      expect(row!.data_type).toBe('character');
      expect(row!.character_maximum_length).toBe(2);
    },
  );

  (HAS_TEST_ENV ? it : it.skip)('card_type column exists as text', async () => {
    process.env.SUPABASE_URL = process.env.TEST_SUPABASE_URL!;
    process.env.SUPABASE_SERVICE_ROLE_KEY =
      process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!;
    const db = adminClient();
    const { data, error } = await db.rpc('exec_sql_read', {
      sql: `
        select column_name, data_type
          from information_schema.columns
         where table_schema = 'public'
           and table_name   = 'transactions'
           and column_name  = 'card_type'
      `,
    });
    expect(error).toBeNull();
    const row = (data as Array<{ column_name: string; data_type: string }> | null)?.[0];
    expect(row).toBeDefined();
    expect(row!.data_type).toBe('text');
  });
});
