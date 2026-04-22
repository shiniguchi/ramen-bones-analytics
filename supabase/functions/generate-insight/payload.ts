// Builds the InsightPayload read by the LLM tool-use prompt.
// Service-role client — no JWT context. Leaf views filter on
// `auth.jwt()->>'restaurant_id'` which is NULL under service-role, so we must
// either read raw MVs directly (kpi_daily_mv, cohort_mv) or call the
// `test_*` SECURITY DEFINER RPCs that Phase 3 shipped as the admin bypass
// (see 0012_leaf_views.sql). Hitting the wrapper views directly returns zero
// rows and produces an all-zero payload that forces the fallback template —
// exactly the Gap-3 failure 05-09 is closing.

import type { SupabaseClient } from "@supabase/supabase-js";

// D-05: the shape Haiku sees. Every numeric field is a candidate for the digit-guard allowed set.
// `display` mirrors the cents-denominated `kpi`/`new_vs_returning` fields in whole-euro
// integer form so the LLM can write natural "€203" strings and the digit-guard
// (which flattens every number it finds in the payload) still accepts them.
export type InsightPayload = {
  kpi: {
    today_revenue: number;
    // `last_week_*` and `last_four_weeks_*` are CALENDAR Mon–Sun aggregates,
    // NOT rolling-7-row sums. They cover the most recent complete ISO week
    // (Mon..Sun ending on `week_ending`) and the 4 complete weeks before it.
    // Weekly refresh cadence + Mon–Sun framing = consistent reader mental model
    // regardless of which weekday the data last ingested on.
    last_week_revenue: number;
    last_four_weeks_revenue: number;
    thirty_d_revenue: number;
    ninety_d_revenue: number;
    today_delta_pct: number;
    last_week_delta_pct: number;
    last_four_weeks_delta_pct: number;
    tx_count: number;
    avg_ticket: number;
  };
  // ISO date (YYYY-MM-DD) of the Sunday that closes `last_week_*`. The
  // LLM uses this for "Week ending <date>" framing; the Edge Function also
  // stores this as the insights.business_date so the card label stays aligned.
  week_ending: string;
  cohorts: Array<{ cohort_week: string; cohort_size: number; retention: number[] }>;
  ltv: Array<{ cohort_week: string; ltv_cents: number }>;
  frequency: Array<{ bucket: string; customer_count: number }>;
  new_vs_returning: { new_revenue: number; returning_revenue: number; cash_revenue: number };
  // Euro-denominated projection: whole-euro floor of every *_cents field above.
  // The LLM is instructed to use ONLY these values (or the integer percent
  // fields) when writing currency into the headline/body.
  display: {
    currency: "EUR";
    today_revenue_eur: number;
    last_week_revenue_eur: number;
    last_four_weeks_revenue_eur: number;
    thirty_d_revenue_eur: number;
    ninety_d_revenue_eur: number;
    avg_ticket_eur: number;
    new_revenue_eur: number;
    returning_revenue_eur: number;
    cash_revenue_eur: number;
    returning_pct: number;
  };
};

// kpi_daily_mv is 1 row per business_date. Sum revenue over a rolling window anchored to "latest".
// Column names on the raw MV are revenue_cents + avg_ticket_cents; keep the older
// `revenue`/`avg_ticket` aliases as fallbacks so test fixtures keep working.
type KpiRow = {
  business_date: string;
  revenue?: number | null;
  revenue_cents?: number | null;
  tx_count?: number | null;
  avg_ticket?: number | null;
  avg_ticket_cents?: number | null;
};

function sumWindow(rows: KpiRow[], days: number): number {
  return rows.slice(0, days).reduce((acc, r) => {
    const v = (r.revenue ?? r.revenue_cents ?? 0) as number;
    return acc + (Number(v) || 0);
  }, 0);
}

function deltaPct(curr: number, prior: number): number {
  if (prior === 0) return 0;
  return Math.round(((curr - prior) / prior) * 100);
}

// Format a Date as "YYYY-MM-DD" in UTC — matches the string shape kpi_daily_mv
// returns for `business_date` so we can compare cheaply without parsing twice.
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Resolve the Sunday that closes the most recent COMPLETE Mon–Sun week in
// `rows` (which are ordered newest-first by business_date). If the newest row
// is itself a Sunday, that Sunday is returned. If it's any other weekday, we
// step back to the prior Sunday — the partial current week is excluded from
// "last week" aggregates per the weekly-cadence contract (data must not
// mis-represent incomplete weeks as complete).
function resolveLastCompleteSunday(rows: KpiRow[]): Date | null {
  if (rows.length === 0) return null;
  const newest = new Date(String(rows[0].business_date) + "T00:00:00Z");
  if (Number.isNaN(newest.getTime())) return null;
  const dow = newest.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const sunday = new Date(newest);
  sunday.setUTCDate(sunday.getUTCDate() - dow);
  return sunday;
}

// Sum revenue_cents across rows whose business_date falls within the N full
// Mon–Sun weeks ending on (and including) `endSunday`. Rows outside that
// window are ignored — the caller shifts `endSunday` back by 7*N days to
// get the prior-period comparable.
function sumCalendarWeeks(
  rows: KpiRow[],
  endSunday: Date,
  weeks: number,
): number {
  const startMonday = new Date(endSunday);
  startMonday.setUTCDate(startMonday.getUTCDate() - (7 * weeks - 1));
  const startStr = isoDate(startMonday);
  const endStr = isoDate(endSunday);
  let total = 0;
  for (const r of rows) {
    const d = String(r.business_date);
    if (d < startStr || d > endStr) continue;
    total += Number(r.revenue ?? r.revenue_cents ?? 0) || 0;
  }
  return total;
}

export async function buildPayload(
  supabase: SupabaseClient,
  restaurantId: string,
): Promise<InsightPayload> {
  // Parallel fan-out — cuts latency to the max of the queries.
  // KPI + cohort come from raw MVs (service-role can read them, both are
  // `restaurant_id`-scoped by the explicit .eq filter). LTV / frequency /
  // new_vs_returning come through the Phase-3 `test_*` SECURITY DEFINER
  // RPCs that set request.jwt.claims for the transaction — these are the
  // only admin-side paths through the JWT-filtered leaf views.
  const [kpiR, cohortR, ltvR, freqR, nvrR] = await Promise.all([
    supabase
      .from("kpi_daily_mv")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("business_date", { ascending: false })
      .limit(180),
    supabase
      .from("cohort_mv")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("cohort_week", { ascending: false })
      .limit(48),
    supabase.rpc("test_ltv", { rid: restaurantId }),
    supabase.rpc("test_frequency", { rid: restaurantId }),
    supabase.rpc("test_new_vs_returning", { rid: restaurantId }),
  ]);

  const kpiRows = (kpiR.data ?? []) as KpiRow[];
  // Today = newest row (kept for back-compat / debugging — the prompt forbids
  // the LLM from rendering it). 30d / 90d stay as rolling windows since they
  // don't align cleanly to calendar weeks anyway; neither is surfaced in the
  // v2 weekly-voice output.
  const today_revenue = Math.round(sumWindow(kpiRows, 1));
  const thirty_d_revenue = Math.round(sumWindow(kpiRows, 30));
  const ninety_d_revenue = Math.round(sumWindow(kpiRows, 90));

  // Calendar-week aggregates. "last week" = the most recent COMPLETE Mon–Sun
  // week; "prior week" = the Mon–Sun week before it. If kpiRows is empty or
  // the newest date is unparseable, resolveLastCompleteSunday returns null
  // and all week fields collapse to 0 — safe defaults that the fallback
  // template handles via the zero-edge branches.
  const lastSunday = resolveLastCompleteSunday(kpiRows);
  const priorSunday = lastSunday
    ? new Date(new Date(lastSunday).setUTCDate(lastSunday.getUTCDate() - 7))
    : null;
  const fourWeeksPriorSunday = lastSunday
    ? new Date(new Date(lastSunday).setUTCDate(lastSunday.getUTCDate() - 28))
    : null;

  const last_week_revenue = lastSunday
    ? Math.round(sumCalendarWeeks(kpiRows, lastSunday, 1))
    : 0;
  const prior_week_revenue = priorSunday
    ? Math.round(sumCalendarWeeks(kpiRows, priorSunday, 1))
    : 0;
  const last_four_weeks_revenue = lastSunday
    ? Math.round(sumCalendarWeeks(kpiRows, lastSunday, 4))
    : 0;
  const prior_four_weeks_revenue = fourWeeksPriorSunday
    ? Math.round(sumCalendarWeeks(kpiRows, fourWeeksPriorSunday, 4))
    : 0;

  const prior_today =
    kpiRows.length > 7
      ? Number(kpiRows[7]?.revenue ?? kpiRows[7]?.revenue_cents ?? 0) || 0
      : 0;
  const today_delta_pct = deltaPct(today_revenue, prior_today);
  const last_week_delta_pct = deltaPct(last_week_revenue, prior_week_revenue);
  const last_four_weeks_delta_pct = deltaPct(
    last_four_weeks_revenue,
    prior_four_weeks_revenue,
  );
  const week_ending = lastSunday ? isoDate(lastSunday) : "";

  const tx_count = kpiRows.slice(0, 1).reduce((a, r) => a + (Number(r.tx_count ?? 0) || 0), 0);
  const avg_ticket = Math.round(
    Number(kpiRows[0]?.avg_ticket ?? kpiRows[0]?.avg_ticket_cents ?? 0) || 0,
  );

  // Cohort rows: retention columns are w0..wN; collapse wide→long.
  const cohorts = (cohortR.data ?? []).slice(0, 12).map((row: Record<string, unknown>) => {
    const retention: number[] = [];
    for (let i = 0; i < 12; i++) {
      const v = row[`w${i}`] ?? row[`period_${i}`];
      if (typeof v === "number") retention.push(Math.round(v * 100) / 100);
    }
    return {
      cohort_week: String(row.cohort_week ?? ""),
      cohort_size: Number(row.cohort_size ?? 0),
      retention,
    };
  });

  const ltv = (ltvR.data ?? []).map((row: Record<string, unknown>) => ({
    cohort_week: String(row.cohort_week ?? ""),
    ltv_cents: Math.round(Number(row.ltv_cents ?? row.ltv ?? 0)),
  }));

  const frequency = (freqR.data ?? []).map((row: Record<string, unknown>) => ({
    bucket: String(row.bucket ?? row.visit_bucket ?? ""),
    customer_count: Number(row.customer_count ?? row.count ?? 0),
  }));

  // `test_new_vs_returning` returns one row per (business_date, bucket).
  // Collapse to the 3 scalars the D-05 payload + fallback template expect:
  // sum revenue_cents per bucket over the last complete Mon–Sun week (the
  // same window as last_week_revenue). `blackout_unknown` folds into
  // cash_revenue to preserve the D-19 tie-out invariant
  // (total = new + returning + cash_anonymous + blackout).
  type NvrRow = {
    business_date?: string;
    bucket?: string;
    revenue_cents?: number | null;
  };
  const nvrRows = (nvrR.data ?? []) as NvrRow[];
  const weekStartStr = lastSunday
    ? isoDate(new Date(new Date(lastSunday).setUTCDate(lastSunday.getUTCDate() - 6)))
    : "";
  const weekEndStr = lastSunday ? isoDate(lastSunday) : "";
  const inLastWeek = (d: string) =>
    weekStartStr !== "" && d >= weekStartStr && d <= weekEndStr;
  const nvrTotals = { new: 0, returning: 0, cash: 0 };
  for (const row of nvrRows) {
    if (!inLastWeek(String(row.business_date ?? ""))) continue;
    const v = Number(row.revenue_cents ?? 0) || 0;
    switch (row.bucket) {
      case "new":
        nvrTotals.new += v;
        break;
      case "returning":
        nvrTotals.returning += v;
        break;
      case "cash_anonymous":
      case "blackout_unknown":
        nvrTotals.cash += v;
        break;
    }
  }
  const new_vs_returning = {
    new_revenue: Math.round(nvrTotals.new),
    returning_revenue: Math.round(nvrTotals.returning),
    cash_revenue: Math.round(nvrTotals.cash),
  };

  // Whole-euro projection: floor(cents / 100). The LLM writes "€X" using these,
  // and the digit-guard's flatten pass picks them up so the output validates.
  const toEur = (cents: number): number => Math.floor((Number(cents) || 0) / 100);
  const totalNvr =
    new_vs_returning.new_revenue +
    new_vs_returning.returning_revenue +
    new_vs_returning.cash_revenue;
  const returning_pct =
    totalNvr > 0
      ? Math.round((new_vs_returning.returning_revenue / totalNvr) * 100)
      : 0;

  const display = {
    currency: "EUR" as const,
    today_revenue_eur: toEur(today_revenue),
    last_week_revenue_eur: toEur(last_week_revenue),
    last_four_weeks_revenue_eur: toEur(last_four_weeks_revenue),
    thirty_d_revenue_eur: toEur(thirty_d_revenue),
    ninety_d_revenue_eur: toEur(ninety_d_revenue),
    avg_ticket_eur: toEur(avg_ticket),
    new_revenue_eur: toEur(new_vs_returning.new_revenue),
    returning_revenue_eur: toEur(new_vs_returning.returning_revenue),
    cash_revenue_eur: toEur(new_vs_returning.cash_revenue),
    returning_pct,
  };

  return {
    kpi: {
      today_revenue,
      last_week_revenue,
      last_four_weeks_revenue,
      thirty_d_revenue,
      ninety_d_revenue,
      today_delta_pct,
      last_week_delta_pct,
      last_four_weeks_delta_pct,
      tx_count,
      avg_ticket,
    },
    week_ending,
    cohorts,
    ltv,
    frequency,
    new_vs_returning,
    display,
  };
}
