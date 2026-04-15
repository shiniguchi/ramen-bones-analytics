import { describe, it, expect } from 'vitest';
import { adminClient } from '../helpers/supabase';

// Phase 7 DM-02: Migration 0019 backfill populates transactions.wl_issuing_country
// + transactions.card_type from stg_orderbird_order_items via DISTINCT ON per
// (restaurant_id, invoice_number). Wave 0 RED scaffold.
//
// TODO(07-02): unskip when migration 0019 ships. This test seeds 3 staging
// invoices + 3 transaction shells, runs the backfill block, and asserts the
// (country, card_type) pair lands on each row correctly.

const HAS_TEST_ENV =
  !!process.env.TEST_SUPABASE_URL &&
  !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

describe.skip('migration 0019 backfill (DM-02)', () => {
  (HAS_TEST_ENV ? it : it.skip)(
    'backfills (DE, visa) from Worldline-populated row',
    async () => {
      // Seed 1: wl_card_type='Visa', wl_issuing_country='DE' → expects (DE, visa)
      // Covered by the larger multi-row seed below.
      expect(true).toBe(true); // placeholder until fixture seeding helper exists
    },
  );

  (HAS_TEST_ENV ? it : it.skip)(
    'backfills (AT, mastercard) via POS fallback when wl_card_type is empty',
    async () => {
      // Seed 2: wl_card_type='', card_type='Mastercard', wl_issuing_country='AT'
      // → expects (AT, mastercard) via COALESCE fallback.
      expect(true).toBe(true);
    },
  );

  (HAS_TEST_ENV ? it : it.skip)(
    'backfills (NULL, unknown) for April-blackout-style fully-empty rows',
    async () => {
      // Seed 3: wl_card_type='', card_type='', wl_issuing_country=''
      // → expects (NULL, 'unknown') — both fields empty fall through.
      expect(true).toBe(true);
    },
  );
});
