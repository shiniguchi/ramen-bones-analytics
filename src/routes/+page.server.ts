// Root dashboard loader. Reads chip/grain from URL, exposes freshness, and
// ships a logout action. Downstream plans (04-03..04-05) extend the load body
// with parallel Promise.all fan-out over the *_v wrapper views; the import and
// export surface is the final shape.
import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { chipToRange, type Range, type Grain } from '$lib/dateRange';

export const load: PageServerLoad = async ({ locals, url }) => {
  const range = (url.searchParams.get('range') ?? '7d') as Range;
  const grain = (url.searchParams.get('grain') ?? 'week') as Grain;

  // `locals.supabase` is already JWT-bound via hooks + layout (Guard 2).
  // Per-card error isolation: a freshness query failure must NOT throw —
  // the FreshnessLabel renders "No data yet" when null.
  let freshness: string | null = null;
  try {
    const { data } = await locals.supabase
      .from('data_freshness_v')
      .select('last_ingested_at')
      .maybeSingle();
    freshness = (data?.last_ingested_at as string | null) ?? null;
  } catch (err) {
    console.error('[+page.server] data_freshness_v query failed', err);
  }

  return {
    range,
    grain,
    freshness,
    window: chipToRange(range)
  };
};

export const actions: Actions = {
  logout: async ({ locals }) => {
    await locals.supabase.auth.signOut();
    throw redirect(303, '/login');
  }
};
