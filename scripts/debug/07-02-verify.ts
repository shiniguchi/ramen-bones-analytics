// Phase 07-02 Task 2 verification: schema + backfill + view shape.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const db = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

async function rpcSql<T = any>(sql: string): Promise<T> {
  // No generic SQL RPC exists; use REST via supabase-js is structured only.
  // Fall back to PostgREST-safe calls: we query via .from().select() for
  // information_schema.columns by using a view if available, otherwise per-
  // table counts through normal .from() handles most of what we need.
  throw new Error('not used');
}

async function main() {
  // 1. NOT NULL count for wl_issuing_country + backfill % card_type
  const { count: total } = await db
    .from('transactions')
    .select('*', { count: 'exact', head: true });
  console.log('transactions.total', total);

  const { count: withCountry } = await db
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .not('wl_issuing_country', 'is', null);
  console.log('transactions.wl_issuing_country NOT NULL', withCountry);

  const { count: withCardType } = await db
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .not('card_type', 'is', null);
  console.log('transactions.card_type NOT NULL', withCardType);

  // 2. Distinct card_type values + counts
  const { data: txSample } = await db
    .from('transactions')
    .select('card_type')
    .limit(10000);
  const cardDist = new Map<string, number>();
  for (const r of txSample ?? []) {
    const k = (r as any).card_type ?? 'NULL';
    cardDist.set(k, (cardDist.get(k) ?? 0) + 1);
  }
  console.log('\ncard_type distribution (sample up to 10k):');
  for (const [k, n] of [...cardDist.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`  ${n.toString().padStart(6)}  ${k}`);

  // 3. Distinct country list (sample up to 10k)
  const { data: countrySample } = await db
    .from('transactions')
    .select('wl_issuing_country')
    .limit(10000);
  const countries = new Map<string, number>();
  for (const r of countrySample ?? []) {
    const k = (r as any).wl_issuing_country ?? 'NULL';
    countries.set(k, (countries.get(k) ?? 0) + 1);
  }
  console.log('\nwl_issuing_country distribution (sample up to 10k):');
  for (const [k, n] of [...countries.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`  ${n.toString().padStart(6)}  ${k}`);

  // 4. 20-invoice spot check: pull 20 random invoices and compare backfill
  //    vs a fresh read of staging.
  const { data: spotTx } = await db
    .from('transactions')
    .select('restaurant_id, source_tx_id, wl_issuing_country, card_type')
    .not('wl_issuing_country', 'is', null)
    .limit(20);
  console.log('\n=== 20-invoice spot check ===');
  let pass = 0;
  let fail = 0;
  for (const t of spotTx ?? []) {
    const { data: stg } = await db
      .from('stg_orderbird_order_items')
      .select('wl_issuing_country, wl_card_type, wl_payment_type, card_type, row_index')
      .eq('restaurant_id', (t as any).restaurant_id)
      .eq('invoice_number', (t as any).source_tx_id)
      .order('row_index', { ascending: true })
      .limit(1);
    const first = (stg ?? [])[0] as any;
    if (!first) {
      console.log(`  MISS stg row for inv=${(t as any).source_tx_id}`);
      fail++;
      continue;
    }
    const rawCountry = (first.wl_issuing_country ?? '').trim();
    const rawNetwork =
      (first.wl_payment_type ?? '').trim() ||
      (first.wl_card_type ?? '').trim() ||
      (first.card_type ?? '').trim();
    console.log(
      `  inv=${(t as any).source_tx_id}  tx.country=${(t as any).wl_issuing_country}  stg.country=${JSON.stringify(rawCountry)}  tx.card=${(t as any).card_type}  stg.raw=${JSON.stringify(rawNetwork)}`,
    );
    // Minimal sanity: tx.card_type must not be NULL (backfill populated it)
    if ((t as any).card_type) pass++;
    else fail++;
  }
  console.log(`spot check: pass=${pass} fail=${fail}`);

  // 5. Schema check: select one row including both new columns (if the
  //    select succeeds, the columns exist).
  const { data: schemaCheck, error: schemaErr } = await db
    .from('transactions')
    .select('wl_issuing_country, card_type')
    .limit(1);
  console.log('\nschema check (new columns exist):', !schemaErr, schemaCheck);

  // 6. View shape — try selecting via the view columns
  const { error: viewErr } = await db
    .from('transactions_filterable_v')
    .select('restaurant_id, business_date, gross_cents, sales_type, payment_method, wl_issuing_country')
    .limit(0);
  console.log('view has wl_issuing_country column:', !viewErr, viewErr?.message);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
