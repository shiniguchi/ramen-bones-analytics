// src/lib/forecastOverlay.svelte.ts
// Shared forecast-overlay state for the calendar bar charts. The two cards
// (CalendarCountsCard, CalendarRevenueCard) used to duplicate ~150 lines of
// fetch + reactive derivations apiece — only the kpi key and value formatters
// differed. This factory centralises the duplication.
//
// Design: rune-based factory function returning a reactive object. Caller
// passes thunks (() => x) for inputs that change over time (grain, chartData,
// xInterval, chartCtx) so the factory can re-derive without prop drilling
// through Svelte 5 $derived runes. Unscoped imports are safe in .svelte.ts
// modules.
import { format, parseISO } from 'date-fns';
import { clientFetch } from '$lib/clientFetch';
import { type Granularity } from '$lib/forecastValidation';
import type { ForecastEvent } from '$lib/forecastEventClamp';

export type ForecastRow = {
  target_date: string;
  model_name: string;
  yhat_mean: number;
  yhat_lower: number;
  yhat_upper: number;
  horizon_days: number;
};

// Phase 17 BCK-01/BCK-02 — backtest verdict types mirrored from +server.ts.
export type BacktestVerdict = 'PASS' | 'FAIL' | 'PENDING' | 'UNCALIBRATED' | null;
export type ModelBacktestRow = { h7?: BacktestVerdict; h35?: BacktestVerdict; h120?: BacktestVerdict; h365?: BacktestVerdict };

export type ForecastPayload = {
  rows: ForecastRow[];
  actuals: { date: string; value: number }[];
  // Phase 16.3 D-04 / Claude's Discretion: tightened from `unknown[]` to
  // `ForecastEvent[]` so downstream consumers (EventBadgeStrip, hover popups)
  // get end-to-end TS narrowing. Server already returns `clampEvents()` output
  // of exactly this shape.
  events: ForecastEvent[];
  last_run: string | null;
  kpi: 'revenue_eur' | 'invoice_count';
  granularity: Granularity;
  // Phase 17 BCK-01/BCK-02 — backtest verdict per (model, horizon).
  // Empty object on cold-start (before rolling_origin_cv rows exist).
  modelBacktestStatus?: Record<string, ModelBacktestRow>;
};

// Default-visible models on first render. Other models (prophet/chronos/
// neuralprophet) stay off until the user toggles them in ForecastLegend —
// see ModelAvailabilityDisclosure for per-grain availability rationale.
export const DEFAULT_VISIBLE_MODELS = ['sarimax', 'naive_dow', 'ets', 'theta'] as const;

export type ChartDataRow = { bucket: string; bucket_d: Date };

export type ForecastOverlayInputs = {
  /** Which KPI's forecast to fetch from /api/forecast. */
  kpi: 'invoice_count' | 'revenue_eur';
  /** Reactive granularity getter (re-fetches on change). */
  grain: () => Granularity;
  /** Reactive chart data getter (used to map hovered bucket label -> ISO). */
  chartData: () => readonly ChartDataRow[];
  /** Reactive d3-time interval getter (drives bucketCenter pixel math). */
  xInterval: () => { offset: (d: Date, n: number) => Date };
  /** Reactive LayerChart context getter (exposes tooltip.data + scales). */
  chartCtx: () => { tooltip?: { data?: { bucket?: string } } } | undefined;
  /** Phase 16.3 D-05: optional past-events backfill window. When the
   *  getter returns a YYYY-MM-DD string, /api/forecast events feed extends
   *  back to that date. Null = forecast-window only (existing behavior).
   *  Re-fetches when grain OR rangeStart change. */
  rangeStart?: () => string | null;
};

export type ForecastOverlay = {
  readonly forecastData: ForecastPayload | null;
  readonly visibleModels: ReadonlySet<string>;
  readonly availableModels: readonly string[];
  readonly seriesByModel: ReadonlyMap<string, readonly ForecastRow[]>;
  readonly lastActualDate: string | null;
  readonly forecastWindowStart: Date | null;
  readonly hoveredBucketIso: string | null;
  /** Phase 16.3 D-04: clamped event list (max 50; priority-sorted upstream).
   *  Pass-through of `forecastData.events` so consumers (EventBadgeStrip,
   *  hover popups) read events without re-fetching. */
  readonly events: readonly ForecastEvent[];
  toggleModel(name: string): void;
  bucketCenter(d: Date): Date;
};

/**
 * Create the reactive state for a forecast overlay layer on top of a
 * stacked bar chart. Returns getters so consumers stay in sync without
 * Svelte $bindable() ceremony. Side effect: registers a $effect that
 * fetches /api/forecast whenever grain() changes.
 *
 * Usage (inside a .svelte component's <script>):
 *   const overlay = createForecastOverlay({
 *     kpi: 'invoice_count',
 *     grain: () => getFilters().grain as Granularity,
 *     chartData: () => chartData,
 *     xInterval: () => xInterval,
 *     chartCtx: () => chartCtx,
 *   });
 *   // Then read overlay.seriesByModel, overlay.hoveredBucketIso, etc.
 */
export function createForecastOverlay(opts: ForecastOverlayInputs): ForecastOverlay {
  let forecastData = $state<ForecastPayload | null>(null);
  let visibleModels = $state(new Set<string>(DEFAULT_VISIBLE_MODELS));
  // Phase 16.3 D-05: cache key widens from `grain` to `grain|rangeStart` so a
  // caller updating rangeStart re-fires the fetch even if grain stays the same.
  // Without this widening the existing grain guard would block the new fetch.
  let lastFetchedKey: string | null = null;

  function toggleModel(name: string) {
    // Always create a NEW Set to trigger Svelte 5 reactivity.
    const next = new Set(visibleModels);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    visibleModels = next;
  }

  // Re-fetch /api/forecast when grain OR rangeStart changes. Guard with
  // lastFetchedKey (composite of both) to prevent reactive loops if the
  // response itself touches reactive state. Phase 16.3 D-05 threads the
  // optional `range_start` query param through so each card can backfill
  // events to its earliest visible bucket. encodeURIComponent applied
  // defensively even though the server (Plan 16.3-05) gates on a strict
  // YYYY-MM-DD regex + future-date check.
  $effect(() => {
    const g = opts.grain();
    const rs = opts.rangeStart?.() ?? null;
    const key = `${g}|${rs ?? ''}`;
    if (lastFetchedKey === key) return;
    lastFetchedKey = key;
    const rsParam = rs ? `&range_start=${encodeURIComponent(rs)}` : '';
    clientFetch<ForecastPayload>(`/api/forecast?kpi=${opts.kpi}&granularity=${g}${rsParam}`)
      .then((d) => { forecastData = d; })
      .catch(() => { forecastData = null; });
  });

  // Group forecast rows per model, filtered by visibleModels. Each model's
  // rows sorted ascending by target_date for clean Spline drawing.
  const seriesByModel = $derived.by(() => {
    const map = new Map<string, ForecastRow[]>();
    for (const r of forecastData?.rows ?? []) {
      if (!visibleModels.has(r.model_name)) continue;
      if (!map.has(r.model_name)) map.set(r.model_name, []);
      map.get(r.model_name)!.push(r);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.target_date.localeCompare(b.target_date));
    }
    return map;
  });

  // Last actual date — server-truth max from /api/forecast actuals (already
  // bucketed to grain by the API hotfix). null on cold-start.
  const lastActualDate = $derived<string | null>(
    (forecastData?.actuals ?? []).reduce<string | null>(
      (mx, a) => (mx === null || a.date > mx) ? a.date : mx,
      null
    )
  );

  // Leftmost forecast date (any visible model) for chart-domain widening.
  const forecastWindowStart = $derived.by<Date | null>(() => {
    let minIso: string | null = null;
    for (const rows of seriesByModel.values()) {
      if (rows.length === 0) continue;
      const first = rows[0].target_date; // sorted asc above
      if (minIso === null || first < minIso) minIso = first;
    }
    return minIso === null ? null : parseISO(minIso);
  });

  const availableModels = $derived(
    Array.from(new Set((forecastData?.rows ?? []).map((r) => r.model_name)))
  );

  // Bucket center on a time scale. LayerChart Spline uses xScale(d) which
  // places points at the bar's LEFT edge; shifting to (d + xInterval.offset(d, 1)) / 2
  // lands the line dot on the bar's center. Day = +12h, week = +3.5d, month = ~+15d.
  function bucketCenter(d: Date): Date {
    return new Date((d.getTime() + opts.xInterval().offset(d, 1).getTime()) / 2);
  }

  // ISO yyyy-MM-dd of the currently hovered bar bucket, or null. Drives the
  // vertical guide line + per-model dots in <ForecastOverlay>.
  const hoveredBucketIso = $derived.by<string | null>(() => {
    const data = opts.chartCtx()?.tooltip?.data;
    if (!data) return null;
    const idx = opts.chartData().findIndex((r) => r.bucket === data.bucket);
    if (idx < 0) return null;
    const d = opts.chartData()[idx]?.bucket_d;
    return d instanceof Date ? format(d, 'yyyy-MM-dd') : null;
  });

  return {
    get forecastData() { return forecastData; },
    get visibleModels() { return visibleModels; },
    get availableModels() { return availableModels; },
    get seriesByModel() { return seriesByModel; },
    get lastActualDate() { return lastActualDate; },
    get forecastWindowStart() { return forecastWindowStart; },
    get hoveredBucketIso() { return hoveredBucketIso; },
    // Phase 16.3 D-04: pass-through clamped events for EventBadgeStrip / popup
    // consumers — empty array on cold start so callers never have to null-guard.
    get events() { return forecastData?.events ?? []; },
    toggleModel,
    bucketCenter
  };
}
