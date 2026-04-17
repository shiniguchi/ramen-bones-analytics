import { describe, it, expect, beforeAll } from 'vitest';
import { adminClient } from '../helpers/supabase';

// Phase 7 DM-01: transactions gains wl_issuing_country char(2) + card_type text
// via migration 0019. 07-01 authored this as a RED scaffold (skipped, using a
// non-existent exec_sql_read RPC). 07-02 flips it GREEN by querying the live
// schema through PostgREST and exercising the normalize_card_type SQL function
// via .rpc().

const HAS_TEST_ENV =
  !!process.env.TEST_SUPABASE_URL &&
  !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

beforeAll(() => {
  if (!HAS_TEST_ENV) return;
  // Mirror loader.test.ts: runIngest / adminClient read SUPABASE_* at call
  // time, so override with the TEST_* pair.
  process.env.SUPABASE_URL = process.env.TEST_SUPABASE_URL!;
  process.env.SUPABASE_SERVICE_ROLE_KEY =
    process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!;
});

describe.skipIf(!HAS_TEST_ENV)(
  'transactions schema — wl_issuing_country + card_type (DM-01)',
  () => {
    it('transactions table selects wl_issuing_country + card_type without error', async () => {
      const db = adminClient();
      const { error } = await db
        .from('transactions')
        .select('wl_issuing_country, card_type')
        .limit(1);
      expect(error).toBeNull();
    });

    it('transactions_filterable_v exposes wl_issuing_country (view refresh)', async () => {
      const db = adminClient();
      const { error } = await db
        .from('transactions_filterable_v')
        .select(
          'restaurant_id, business_date, gross_cents, sales_type, payment_method, wl_issuing_country',
        )
        .limit(0);
      expect(error).toBeNull();
    });

    it('public.normalize_card_type() maps the canonical buckets correctly', async () => {
      const db = adminClient();
      const cases: Array<[string | null, string]> = [
        ['Visa', 'visa'],
        ['VISA', 'visa'],
        ['Visa Debit', 'visa'],
        ['MasterCard', 'mastercard'],
        ['Mastercard Debit', 'mastercard'],
        ['mc', 'mastercard'],
        ['American Express', 'amex'],
        ['amex', 'amex'],
        ['Maestro', 'maestro'],
        ['V PAY', 'maestro'],
        ['girocard', 'girocard'],
        ['EC', 'girocard'],
        ['Diners', 'other'],
        ['Revolut', 'other'],
        ['Debit', 'unknown'],
        ['Credit', 'unknown'],
        ['', 'unknown'],
        ['   ', 'unknown'],
        [null, 'unknown'],
      ];
      for (const [raw, expected] of cases) {
        const { data, error } = await db.rpc('normalize_card_type', { raw });
        expect(error, `normalize_card_type(${JSON.stringify(raw)}) err`).toBeNull();
        expect(data, `normalize_card_type(${JSON.stringify(raw)})`).toBe(expected);
      }
    });

    it('public.country_name_to_iso2() maps Worldline country names to ISO-2', async () => {
      const db = adminClient();
      const cases: Array<[string | null, string | null]> = [
        ['Germany', 'DE'],
        ['Austria', 'AT'],
        ['Switzerland', 'CH'],
        ['United States', 'US'],
        ['United Kingdom', 'GB'],
        ['Japan', 'JP'],
        ['Taiwan, Province of China', 'TW'],
        ['Korea, Republic of', 'KR'],
        ['', null],
        [null, null],
      ];
      for (const [name, expected] of cases) {
        const { data, error } = await db.rpc('country_name_to_iso2', { name });
        expect(error, `country_name_to_iso2(${JSON.stringify(name)}) err`).toBeNull();
        expect(data, `country_name_to_iso2(${JSON.stringify(name)})`).toBe(expected);
      }
    });

    it('canonical fixture TS↔SQL identity', async () => {
      const db = adminClient();
      // Load the shared fixture and assert every entry round-trips through SQL.
      const fixture = await import('./fixtures/canonical-card-types.json', {
        assert: { type: 'json' },
      });
      const entries = (fixture as any).default as Array<{
        input: string | null;
        expected: string;
      }>;
      for (const { input, expected } of entries) {
        const { data, error } = await db.rpc('normalize_card_type', { raw: input });
        expect(error, `fixture ${JSON.stringify(input)} err`).toBeNull();
        expect(data, `fixture ${JSON.stringify(input)}`).toBe(expected);
      }
    });
  },
);
