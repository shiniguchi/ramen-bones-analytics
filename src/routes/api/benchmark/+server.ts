// Phase 19-02: deferred endpoint for CohortRetentionCard benchmark overlay.
// No date params — benchmark data is lifetime/static. Auth-gated, RLS-scoped
// via benchmark_curve_v + benchmark_sources_v security_invoker wrappers.
// Cache-Control: private, no-store prevents CDN cross-tenant leakage.
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { fetchAll } from '$lib/supabasePagination';

type BenchmarkAnchorRow = {
  period_weeks: number;
  lower_p20: number;
  mid_p50: number;
  upper_p80: number;
  source_count: number;
};

type BenchmarkSourceRow = {
  period_weeks: number;
  id: number;
  label: string;
  country: string;
  segment: string;
  credibility: 'HIGH' | 'MEDIUM' | 'LOW';
  cuisine_match: number;
  metric_type: string;
  conversion_note: string | null;
};

const NO_STORE: Record<string, string> = {
  'Cache-Control': 'private, no-store'
};

export const GET: RequestHandler = async ({ locals }) => {
  const { claims } = await locals.safeGetSession();
  if (!claims) return json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });

  try {
    const [anchors, sources] = await Promise.all([
      fetchAll<BenchmarkAnchorRow>(() =>
        locals.supabase
          .from('benchmark_curve_v')
          .select('period_weeks,lower_p20,mid_p50,upper_p80,source_count')
      ),
      fetchAll<BenchmarkSourceRow>(() =>
        locals.supabase
          .from('benchmark_sources_v')
          .select('period_weeks,id,label,country,segment,credibility,cuisine_match,metric_type,conversion_note')
      )
    ]);
    return json({ anchors, sources }, { headers: NO_STORE });
  } catch (err) {
    console.error('[/api/benchmark]', err);
    return json({ error: 'query failed' }, { status: 500, headers: NO_STORE });
  }
};
