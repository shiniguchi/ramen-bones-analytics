// Phase 19-02: deferred endpoint for CalendarItemsCard + CalendarItemRevenueCard.
// Accepts ?from=&to= (ISO dates). Auth-gated, RLS-scoped via item_counts_daily_v.
// Cache-Control: private, no-store prevents CDN cross-tenant leakage.
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { fetchAll } from '$lib/supabasePagination';

type ItemCountRow = {
  business_date: string;
  item_name: string;
  sales_type: string | null;
  is_cash: boolean;
  item_count: number;
  item_revenue_cents: number;
};

const NO_STORE: Record<string, string> = {
  'Cache-Control': 'private, no-store'
};

export const GET: RequestHandler = async ({ locals, url }) => {
  const { claims } = await locals.safeGetSession();
  if (!claims) return json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });

  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!from || !to) return json({ error: 'from and to are required' }, { status: 400, headers: NO_STORE });

  try {
    const rows = await fetchAll<ItemCountRow>(() =>
      locals.supabase
        .from('item_counts_daily_v')
        .select('business_date,item_name,sales_type,is_cash,item_count,item_revenue_cents')
        .gte('business_date', from)
        .lte('business_date', to)
    );
    return json(rows, { headers: NO_STORE });
  } catch (err) {
    console.error('[/api/item-counts]', err);
    return json({ error: 'query failed' }, { status: 500, headers: NO_STORE });
  }
};
