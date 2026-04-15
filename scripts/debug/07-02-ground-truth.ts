// Phase 07-02 Task 1: ground-truth queries against DEV.
// Run: tsx scripts/debug/07-02-ground-truth.ts
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function fetchAll(): Promise<
  Array<{
    wl_card_type: string | null;
    card_type: string | null;
    wl_payment_type: string | null;
    wl_issuing_country: string | null;
  }>
> {
  const pageSize = 1000;
  let from = 0;
  const out: any[] = [];
  for (;;) {
    const { data, error } = await db
      .from('stg_orderbird_order_items')
      .select('wl_card_type, card_type, wl_payment_type, wl_issuing_country')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

async function main() {
  const rows = await fetchAll();
  console.log('staging_rows', rows.length);

  const cardCounts = new Map<string, number>();
  const payTypeCounts = new Map<string, number>();
  const countryCounts = new Map<string, number>();
  for (const r of rows) {
    const wl = (r.wl_card_type ?? '').trim();
    const pos = (r.card_type ?? '').trim();
    const raw = wl || pos || '';
    cardCounts.set(raw, (cardCounts.get(raw) ?? 0) + 1);
    const wlPay = (r.wl_payment_type ?? '').trim();
    payTypeCounts.set(wlPay, (payTypeCounts.get(wlPay) ?? 0) + 1);
    const c = (r.wl_issuing_country ?? '').trim();
    countryCounts.set(c, (countryCounts.get(c) ?? 0) + 1);
  }

  console.log('\n=== raw_card_type distribution (Worldline wl_card_type, POS fallback) ===');
  for (const [k, n] of [...cardCounts.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`${n.toString().padStart(6)}  ${JSON.stringify(k)}`);

  console.log('\n=== wl_payment_type distribution (card network indicator?) ===');
  for (const [k, n] of [...payTypeCounts.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`${n.toString().padStart(6)}  ${JSON.stringify(k)}`);

  console.log('\n=== wl_issuing_country distribution ===');
  for (const [k, n] of [...countryCounts.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`${n.toString().padStart(6)}  ${JSON.stringify(k)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
