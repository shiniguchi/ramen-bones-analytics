// @vitest-environment jsdom
// Phase 10 Plan 05 — RED tests for CalendarRevenueCard (VA-04) + CalendarCountsCard (VA-05).
// Flips GREEN when the two cards ship under src/lib/components/.
//
// Rendering the cards for real requires LayerChart BarChart + browser-layout
// APIs that JSDOM doesn't support (IntersectionObserver, ResizeObserver,
// getBoundingClientRect). We therefore focus on:
//   1. Empty-state branch (no LayerChart mount path) rendered via EmptyState
//   2. Static artifact assertions — data-testid + imports in source
// The full visual assertion lives in the e2e suite (charts-all.spec.ts).
import { describe, it, expect, beforeAll, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
import fs from 'node:fs';
import path from 'node:path';
import CalendarRevenueCard from '../../src/lib/components/CalendarRevenueCard.svelte';
import CalendarCountsCard from '../../src/lib/components/CalendarCountsCard.svelte';
import { initStore } from '../../src/lib/dashboardStore.svelte';
import { FILTER_DEFAULTS } from '../../src/lib/filters';

// LayerChart uses matchMedia; JSDOM doesn't provide it.
beforeAll(() => {
  if (typeof window !== 'undefined' && !window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    });
  }
});

function seedEmptyStore() {
  initStore({
    dailyRows: [],
    window: { from: '2025-01-01', to: '2025-01-31', priorFrom: null, priorTo: null },
    grain: 'week',
    salesType: 'all',
    cashFilter: 'all',
    filters: { ...FILTER_DEFAULTS }
  });
}

describe('CalendarRevenueCard (VA-04) empty state', () => {
  it('renders "No revenue yet" EmptyState when store has zero rows', () => {
    seedEmptyStore();
    const { container } = render(CalendarRevenueCard);
    expect(container.textContent).toContain('No revenue yet');
    // Card wrapper data-testid is always present
    expect(container.querySelector('[data-testid="calendar-revenue-card"]')).toBeTruthy();
  });
});

describe('CalendarCountsCard (VA-05) empty state', () => {
  it('renders "No transactions yet" EmptyState when store has zero rows', () => {
    seedEmptyStore();
    const { container } = render(CalendarCountsCard);
    expect(container.textContent).toContain('No transactions yet');
    expect(container.querySelector('[data-testid="calendar-counts-card"]')).toBeTruthy();
  });
});

// Static artifact assertions — catch regressions the jsdom render can't hit.
// These assert the load-bearing imports + props from the plan's key_links.
describe('CalendarRevenueCard (VA-04) source artifacts', () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/components/CalendarRevenueCard.svelte'),
    'utf8'
  );

  it("imports Chart + Svg + Bars primitives from 'layerchart'", () => {
    // Post-refactor: switched from high-level BarChart to low-level primitives
    // (Chart + Svg + Axis + Bars + Spline + Text + Tooltip) to enable per-series
    // stacking control + custom trend-line overlay via Spline.
    expect(src).toMatch(/import\s+\{[^}]*\bChart\b[^}]*\}\s+from\s+['"]layerchart['"]/);
    expect(src).toMatch(/\bBars\b/);
    expect(src).toMatch(/\bSvg\b/);
  });
  it('imports getFiltered + getFilters from dashboardStore', () => {
    expect(src).toMatch(/getFiltered/);
    expect(src).toMatch(/getFilters/);
    expect(src).toMatch(/from\s+['"]\$lib\/dashboardStore\.svelte['"]/);
  });
  it('imports VISIT_SEQ_COLORS + CASH_COLOR from chartPalettes', () => {
    expect(src).toMatch(/VISIT_SEQ_COLORS/);
    expect(src).toMatch(/CASH_COLOR/);
    expect(src).toMatch(/from\s+['"]\$lib\/chartPalettes['"]/);
  });
  it('stacks bars via {#each series} emitting one <Bars seriesKey=...> per visit bucket', () => {
    // Post-refactor: low-level Bars has no seriesLayout prop; stacking is
    // expressed by iterating `series` (derived from visit_seq buckets) and
    // emitting one Bars element per key. Vertical orientation is LayerChart's
    // implicit default inside <Svg>, so the explicit `orientation` prop is gone.
    expect(src).toMatch(/\{#each\s+series\s+as\s+s[^}]*\}[\s\S]*?<Bars\s+[^>]*seriesKey=\{s\.key\}/);
  });
  it("shapeForChart called with 'revenue_cents' metric", () => {
    // Accepts an optional 3rd arg (expectedBuckets for zero-fill).
    expect(src).toMatch(/shapeForChart\s*\(\s*[^,]+,\s*['"]revenue_cents['"][\s,][^)]*\)/);
  });
  it('contains data-testid="calendar-revenue-card"', () => {
    expect(src).toMatch(/data-testid=["']calendar-revenue-card["']/);
  });
  it('renders VisitSeqLegend with showCash binding', () => {
    expect(src).toMatch(/<VisitSeqLegend\s+\{?\s*showCash/);
  });
  it('does NOT hand-roll bars via <Rect> (Anti-Pattern)', () => {
    expect(src).not.toMatch(/<Rect\b/);
  });
  it('overlays a trend line via Spline in the marks snippet', () => {
    expect(src).toMatch(/<Spline\b/);
    expect(src).toMatch(/bucketTrend/);
  });
});

// Phase 15-12: Forecast overlay artifact assertions. Live-render assertions
// can't run reliably in jsdom (LayerChart needs ResizeObserver / layout APIs);
// the e2e suite (charts-all.spec.ts) covers the visual gate. These guard the
// overlay's structural contract — toggling, data flow, scale alignment.
describe('CalendarRevenueCard (15-12) forecast overlay artifacts', () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/components/CalendarRevenueCard.svelte'),
    'utf8'
  );

  it('imports ForecastLegend + clientFetch + FORECAST_MODEL_COLORS', () => {
    expect(src).toMatch(/import\s+ForecastLegend\b/);
    expect(src).toMatch(/import\s*\{\s*clientFetch\s*\}/);
    expect(src).toMatch(/FORECAST_MODEL_COLORS/);
  });

  it('fetches /api/forecast?kpi=revenue_eur&granularity=', () => {
    expect(src).toMatch(/\/api\/forecast\?kpi=revenue_eur&granularity=/);
  });

  it('defaults visibleModels to {sarimax, naive_dow} (D-15)', () => {
    expect(src).toMatch(/new\s+Set<string>\(\s*\[\s*['"]sarimax['"]\s*,\s*['"]naive_dow['"]\s*\]/);
  });

  it('toggleModel creates a NEW Set (Svelte 5 reactivity)', () => {
    // Required so $derived chains re-run; mutating the existing Set fails silently.
    expect(src).toMatch(/const\s+next\s*=\s*new\s+Set\(visibleModels\)/);
  });

  it('renders Area for CI band + Spline for line per visible model', () => {
    expect(src).toMatch(/<Area\b[\s\S]*?y0=\{[\s\S]*?yhat_lower/);
    expect(src).toMatch(/<Area\b[\s\S]*?y1=\{[\s\S]*?yhat_upper/);
    expect(src).toMatch(/<Spline\b[\s\S]*?y=\{[\s\S]*?yhat_mean/);
    // Both Area + Spline iterate seriesByModel — toggling drops both layers
    // for that model (Option B per D-17).
    expect(src).toMatch(/seriesByModel\.entries\(\)[\s\S]*?<Area/);
    expect(src).toMatch(/seriesByModel\.entries\(\)[\s\S]*?<Spline[\s\S]*?yhat_mean/);
  });

  it('uses scaleTime + xInterval for time-axis bars', () => {
    expect(src).toMatch(/scaleTime\s*\(\s*\)/);
    expect(src).toMatch(/xInterval=\{xInterval\}/);
    expect(src).toMatch(/timeDay/);
    expect(src).toMatch(/timeMonday/);
    expect(src).toMatch(/timeMonth/);
  });

  it('extends xDomain to today + 365d for forecast horizon', () => {
    expect(src).toMatch(/addDays\(\s*new\s+Date\(\)\s*,\s*365\s*\)/);
  });

  it('naive_dow renders dashed at stroke-width=1', () => {
    expect(src).toMatch(/isNaive\s*\?\s*1\s*:\s*2/);
    expect(src).toMatch(/isNaive\s*\?\s*['"]4 4['"]/);
  });

  it('CI band uses fillOpacity 0.06 (back layer mush prevention)', () => {
    expect(src).toMatch(/fillOpacity=\{?0\.06\}?/);
  });

  it('renders ForecastLegend chip row when forecastData present', () => {
    expect(src).toMatch(
      /<ForecastLegend\s+\{availableModels\}\s+\{visibleModels\}\s+ontoggle=\{toggleModel\}/
    );
  });

  it('lastFetchedGrain guard prevents reactive loops', () => {
    expect(src).toMatch(/lastFetchedGrain/);
  });
});

describe('CalendarCountsCard (VA-05) source artifacts', () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/components/CalendarCountsCard.svelte'),
    'utf8'
  );

  it("imports Chart + Svg + Bars primitives from 'layerchart'", () => {
    // Post-refactor: same low-level primitive migration as CalendarRevenueCard.
    expect(src).toMatch(/import\s+\{[^}]*\bChart\b[^}]*\}\s+from\s+['"]layerchart['"]/);
    expect(src).toMatch(/\bBars\b/);
    expect(src).toMatch(/\bSvg\b/);
  });
  it("shapeForChart called with 'tx_count' metric (NOT revenue_cents)", () => {
    // Accepts an optional 3rd arg (expectedBuckets for zero-fill).
    expect(src).toMatch(/shapeForChart\s*\(\s*[^,]+,\s*['"]tx_count['"][\s,][^)]*\)/);
    expect(src).not.toMatch(/shapeForChart\s*\(\s*[^,]+,\s*['"]revenue_cents['"][\s,][^)]*\)/);
  });
  it('contains data-testid="calendar-counts-card"', () => {
    expect(src).toMatch(/data-testid=["']calendar-counts-card["']/);
  });
  it('stacks bars via {#each series} emitting one <Bars seriesKey=...> per visit bucket', () => {
    // Post-refactor: orientation + seriesLayout props gone with the BarChart
    // migration. Vertical stacking is expressed by iterating `series` and
    // emitting one Bars per key.
    expect(src).toMatch(/\{#each\s+series\s+as\s+s[^}]*\}[\s\S]*?<Bars\s+[^>]*seriesKey=\{s\.key\}/);
  });
  it('does NOT hand-roll bars via <Rect> (Anti-Pattern)', () => {
    expect(src).not.toMatch(/<Rect\b/);
  });
  it('appends "txn" unit to y-axis ticks', () => {
    expect(src).toMatch(/formatIntShort\s*\([^)]*['"]txn['"]/);
  });
  it('overlays a trend line via Spline in the marks snippet', () => {
    expect(src).toMatch(/<Spline\b/);
    expect(src).toMatch(/bucketTrend/);
  });
});

// Phase 15-13: Forecast overlay artifact assertions for CalendarCountsCard.
// Sister of the 15-12 CalendarRevenueCard suite — same overlay contract but
// against the invoice_count KPI. Live render skipped (jsdom can't), e2e in
// charts-all.spec.ts gate. These guard the structural contract.
describe('CalendarCountsCard (15-13) forecast overlay artifacts', () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/components/CalendarCountsCard.svelte'),
    'utf8'
  );

  it('imports ForecastLegend + clientFetch + FORECAST_MODEL_COLORS', () => {
    expect(src).toMatch(/import\s+ForecastLegend\b/);
    expect(src).toMatch(/import\s*\{\s*clientFetch\s*\}/);
    expect(src).toMatch(/FORECAST_MODEL_COLORS/);
  });

  it('fetches /api/forecast?kpi=invoice_count&granularity= (NOT revenue_eur)', () => {
    expect(src).toMatch(/\/api\/forecast\?kpi=invoice_count&granularity=/);
    expect(src).not.toMatch(/\/api\/forecast\?kpi=revenue_eur&granularity=/);
  });

  it('defaults visibleModels to {sarimax, naive_dow} (D-15)', () => {
    expect(src).toMatch(/new\s+Set<string>\(\s*\[\s*['"]sarimax['"]\s*,\s*['"]naive_dow['"]\s*\]/);
  });

  it('toggleModel creates a NEW Set (Svelte 5 reactivity)', () => {
    // Required so $derived chains re-run; mutating the existing Set fails silently.
    expect(src).toMatch(/const\s+next\s*=\s*new\s+Set\(visibleModels\)/);
  });

  it('renders Area for CI band + Spline for line per visible model', () => {
    expect(src).toMatch(/<Area\b[\s\S]*?y0=\{[\s\S]*?yhat_lower/);
    expect(src).toMatch(/<Area\b[\s\S]*?y1=\{[\s\S]*?yhat_upper/);
    expect(src).toMatch(/<Spline\b[\s\S]*?y=\{[\s\S]*?yhat_mean/);
    // Both Area + Spline iterate seriesByModel — toggling drops both layers
    // for that model (Option B per D-17).
    expect(src).toMatch(/seriesByModel\.entries\(\)[\s\S]*?<Area/);
    expect(src).toMatch(/seriesByModel\.entries\(\)[\s\S]*?<Spline[\s\S]*?yhat_mean/);
  });

  it('uses scaleTime + xInterval for time-axis bars', () => {
    expect(src).toMatch(/scaleTime\s*\(\s*\)/);
    expect(src).toMatch(/xInterval=\{xInterval\}/);
    expect(src).toMatch(/timeDay/);
    expect(src).toMatch(/timeMonday/);
    expect(src).toMatch(/timeMonth/);
  });

  it('extends xDomain to today + 365d for forecast horizon', () => {
    expect(src).toMatch(/addDays\(\s*new\s+Date\(\)\s*,\s*365\s*\)/);
  });

  it('naive_dow renders dashed at stroke-width=1', () => {
    expect(src).toMatch(/isNaive\s*\?\s*1\s*:\s*2/);
    expect(src).toMatch(/isNaive\s*\?\s*['"]4 4['"]/);
  });

  it('CI band uses fillOpacity 0.06 (back layer mush prevention)', () => {
    expect(src).toMatch(/fillOpacity=\{?0\.06\}?/);
  });

  it('renders ForecastLegend chip row when forecastData present', () => {
    expect(src).toMatch(
      /<ForecastLegend\s+\{availableModels\}\s+\{visibleModels\}\s+ontoggle=\{toggleModel\}/
    );
  });

  it('lastFetchedGrain guard prevents reactive loops', () => {
    expect(src).toMatch(/lastFetchedGrain/);
  });

  it('renders yhat_mean directly (NO /100 divisor — invoice_count is integer COUNT)', () => {
    // Critical KPI scaling rule: revenue_cents bars divide by /100 for EUR rendering,
    // but invoice_count is already an integer count. Yhat values from /api/forecast
    // come through unchanged. A stray /100 here would shrink the forecast 100x.
    expect(src).not.toMatch(/yhat_mean[^}]*\/\s*100/);
    expect(src).not.toMatch(/yhat_lower[^}]*\/\s*100/);
    expect(src).not.toMatch(/yhat_upper[^}]*\/\s*100/);
  });
});
