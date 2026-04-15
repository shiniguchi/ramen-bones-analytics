import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
async function main() {
  const { data } = await db
    .from('transactions')
    .select('restaurant_id, source_tx_id, payment_method, card_type, wl_issuing_country')
    .is('card_type', null)
    .limit(10);
  console.log('tx with card_type=NULL (first 10):');
  for (const r of data ?? []) console.log(' ', r);

  const { count: cashCount } = await db
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('payment_method', 'Bar');
  console.log('tx payment_method=Bar total', cashCount);

  // Any NULL card_type that is NOT a cash invoice?
  const { data: anomalies } = await db
    .from('transactions')
    .select('source_tx_id, payment_method, card_type')
    .is('card_type', null)
    .neq('payment_method', 'Bar');
  console.log('NON-CASH tx with card_type=NULL:', (anomalies ?? []).length);
  for (const r of anomalies ?? []) console.log(' ', r);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
