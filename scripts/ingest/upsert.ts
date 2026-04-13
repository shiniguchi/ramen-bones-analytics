// Phase 02 ING-02: batch upserts for both grains.
// Chunk size 500 keeps each request well under Supabase's 1MB payload cap
// (each staging row is ~1KB text) while still amortizing round-trips.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { StagingRow, TxRow } from './types';

const CHUNK = 500;

export async function upsertStaging(
  client: SupabaseClient,
  rows: StagingRow[],
): Promise<number> {
  let upserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    const { error } = await client
      .from('stg_orderbird_order_items')
      .upsert(batch, {
        onConflict: 'restaurant_id,invoice_number,row_index',
        ignoreDuplicates: false,
      });
    if (error) {
      // Log invoice + row_index only — never row content (may contain wl_*).
      throw new Error(
        `Staging upsert failed at batch starting row_index=${batch[0]?.row_index} invoice=${batch[0]?.invoice_number}: ${error.message}`,
      );
    }
    upserted += batch.length;
  }
  return upserted;
}

export async function upsertTransactions(
  client: SupabaseClient,
  rows: TxRow[],
): Promise<number> {
  let upserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    // Strip the non-DB invoice_number field before writing.
    const payload = batch.map((r) => {
      const { invoice_number, ...rest } = r;
      return rest;
    });
    const { error } = await client
      .from('transactions')
      .upsert(payload, {
        onConflict: 'restaurant_id,source_tx_id',
        ignoreDuplicates: false,
      });
    if (error) {
      throw new Error(
        `Transactions upsert failed at batch starting source_tx_id=${batch[0]?.source_tx_id}: ${error.message}`,
      );
    }
    upserted += batch.length;
  }
  return upserted;
}

export async function countTransactions(
  client: SupabaseClient,
  restaurantId: string,
): Promise<number> {
  const { count, error } = await client
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('restaurant_id', restaurantId);
  if (error) throw new Error(`Count query failed: ${error.message}`);
  return count ?? 0;
}
