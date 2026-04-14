// Phase 3 — 3-customer fixture seeder.
//
// Seeds a deterministic 8-row transaction set into `public.transactions` so
// every Phase 3 plan (cohort/retention/LTV/KPI/frequency) can assert exact
// numbers against cohort_mv / ltv_mv / kpi_daily_mv.
//
// Fixture shape (verbatim from 03-RESEARCH.md §Code Examples):
//   customer A — 2025-08-04, 2025-08-18, 2025-09-29   (cohort_week=2025-08-04)
//   customer B — 2025-08-05, 2025-08-11, 2025-08-25   (cohort_week=2025-08-04, returns period 1)
//   customer C — 2025-11-10, 2025-11-17               (cohort_week=2025-11-10)
//
// Usage:
//   const admin = adminClient();
//   await seed3CustomerFixture(admin, restaurantId);
//   // ...run refresh_analytics_mvs() + assertions...
//   await cleanupFixture(admin, restaurantId);

import type { SupabaseClient } from '@supabase/supabase-js';

export interface FixtureTx {
  card_hash: string;
  occurred_at: string; // ISO 8601 with Berlin offset
  gross_cents: number;
}

// ISO Monday-aligned dates chosen so A+B share cohort_week=2025-08-04 (Mon)
// and C lands in cohort_week=2025-11-10 (Mon). See 03-RESEARCH.md §Code Examples.
export const FIXTURE_TXS: FixtureTx[] = [
  { card_hash: 'hash-a', occurred_at: '2025-08-04T12:00:00+02:00', gross_cents: 1500 },
  { card_hash: 'hash-a', occurred_at: '2025-08-18T12:00:00+02:00', gross_cents: 1800 },
  { card_hash: 'hash-a', occurred_at: '2025-09-29T12:00:00+02:00', gross_cents: 2100 },
  { card_hash: 'hash-b', occurred_at: '2025-08-05T12:00:00+02:00', gross_cents: 1400 },
  { card_hash: 'hash-b', occurred_at: '2025-08-11T12:00:00+02:00', gross_cents: 1700 },
  { card_hash: 'hash-b', occurred_at: '2025-08-25T12:00:00+02:00', gross_cents: 1600 },
  { card_hash: 'hash-c', occurred_at: '2025-11-10T12:00:00+02:00', gross_cents: 1300 },
  { card_hash: 'hash-c', occurred_at: '2025-11-17T12:00:00+02:00', gross_cents: 1200 }
];

// Chunk size matches Phase 2 loader convention — half the Supabase 1MB
// payload cap, plenty of headroom for the 8-row fixture.
const CHUNK = 500;

/**
 * Insert FIXTURE_TXS into public.transactions scoped to `restaurantId`.
 * Uses service-role client — bypasses RLS by design. Upsert on the natural
 * key `(restaurant_id, source_tx_id)` so reruns are idempotent.
 */
export async function seed3CustomerFixture(
  admin: SupabaseClient,
  restaurantId: string
): Promise<void> {
  // Build row payload — schema is from migrations 0003 + 0008.
  // No business_date column on transactions; cohort_mv derives it via
  // AT TIME ZONE restaurants.timezone. net_cents at 7% VAT matches the
  // Phase 2 loader default for food.
  const rows = FIXTURE_TXS.map((tx, i) => ({
    restaurant_id: restaurantId,
    source_tx_id: `fixture-${i}`,
    card_hash: tx.card_hash,
    occurred_at: tx.occurred_at,
    payment_method: 'card',
    gross_cents: tx.gross_cents,
    tip_cents: 0,
    net_cents: Math.round(tx.gross_cents / 1.07)
  }));

  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    const { error } = await admin
      .from('transactions')
      .upsert(batch, { onConflict: 'restaurant_id,source_tx_id' });
    if (error) throw error;
  }
}

/**
 * Delete all fixture rows for a restaurant. Safe to call before/after tests.
 */
export async function cleanupFixture(
  admin: SupabaseClient,
  restaurantId: string
): Promise<void> {
  const { error } = await admin
    .from('transactions')
    .delete()
    .eq('restaurant_id', restaurantId)
    .like('source_tx_id', 'fixture-%');
  if (error) throw error;
}
