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
//
// 16.2 polish refactor (2026-05-05): the forecast-overlay state and SVG
// markup moved out of the cards into three shared modules
// (forecastOverlay.svelte.ts + ForecastOverlay.svelte + ForecastTooltipRows.svelte).
// Tests are split: card-level grep stays on the card; overlay-level grep
// reads the new shared modules.
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

const readSrc = (rel: string) =>
  fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

describe('CalendarRevenueCard (VA-04) empty state', () => {
  it('renders "No revenue yet" EmptyState when store has zero rows', () => {
    seedEmptyStore();
    const { container } = render(CalendarRevenueCard);
    expect(container.textContent).toContain('No revenue yet');
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

// ─── Card-level source artifacts ────────────────────────────────────────────
// These guard what each card still owns directly: bars, axis, KPI key,
// metric name, testid, top-level legends.

describe('CalendarRevenueCard (VA-04) source artifacts', () => {
  const src = readSrc('src/lib/components/CalendarRevenueCard.svelte');

  it("imports Chart + Svg + Bars primitives from 'layerchart'", () => {
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
    expect(src).toMatch(/\{#each\s+series\s+as\s+s[^}]*\}[\s\S]*?<Bars\s+[^>]*seriesKey=\{s\.key\}/);
  });
  it("shapeForChart called with 'revenue_cents' metric", () => {
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
  it('overlays a trend line via Spline + bucketTrend', () => {
    expect(src).toMatch(/<Spline\b/);
    expect(src).toMatch(/bucketTrend/);
  });
});

describe('CalendarRevenueCard (15-12) forecast overlay wiring', () => {
  const src = readSrc('src/lib/components/CalendarRevenueCard.svelte');

  it('uses createForecastOverlay factory with kpi="revenue_eur"', () => {
    expect(src).toMatch(/createForecastOverlay/);
    expect(src).toMatch(/kpi:\s*['"]revenue_eur['"]/);
  });
  it('renders the shared <ForecastOverlay> SVG layer', () => {
    expect(src).toMatch(/<ForecastOverlay\b/);
  });
  it('renders the shared <ForecastTooltipRows> in Tooltip.List', () => {
    expect(src).toMatch(/<ForecastTooltipRows\b/);
  });
  it('uses scaleTime + xInterval for time-axis bars', () => {
    expect(src).toMatch(/scaleTime\s*\(\s*\)/);
    expect(src).toMatch(/\{xInterval\}/);
    expect(src).toMatch(/timeDay/);
    expect(src).toMatch(/timeMonday/);
    expect(src).toMatch(/timeMonth/);
  });
  it('extends xDomain to today + 365d for forecast horizon', () => {
    expect(src).toMatch(/addDays\(\s*new\s+Date\(\)\s*,\s*365\s*\)/);
  });
  it('renders ForecastLegend wired to overlay state', () => {
    expect(src).toMatch(
      /<ForecastLegend[\s\S]*?availableModels=\{overlay\.availableModels\}[\s\S]*?visibleModels=\{overlay\.visibleModels\}[\s\S]*?ontoggle=\{overlay\.toggleModel\}/
    );
  });
});

describe('CalendarCountsCard (VA-05) source artifacts', () => {
  const src = readSrc('src/lib/components/CalendarCountsCard.svelte');

  it("imports Chart + Svg + Bars primitives from 'layerchart'", () => {
    expect(src).toMatch(/import\s+\{[^}]*\bChart\b[^}]*\}\s+from\s+['"]layerchart['"]/);
    expect(src).toMatch(/\bBars\b/);
    expect(src).toMatch(/\bSvg\b/);
  });
  it("shapeForChart called with 'tx_count' metric (NOT revenue_cents)", () => {
    expect(src).toMatch(/shapeForChart\s*\(\s*[^,]+,\s*['"]tx_count['"][\s,][^)]*\)/);
    expect(src).not.toMatch(/shapeForChart\s*\(\s*[^,]+,\s*['"]revenue_cents['"][\s,][^)]*\)/);
  });
  it('contains data-testid="calendar-counts-card"', () => {
    expect(src).toMatch(/data-testid=["']calendar-counts-card["']/);
  });
  it('stacks bars via {#each series} emitting one <Bars seriesKey=...> per visit bucket', () => {
    expect(src).toMatch(/\{#each\s+series\s+as\s+s[^}]*\}[\s\S]*?<Bars\s+[^>]*seriesKey=\{s\.key\}/);
  });
  it('does NOT hand-roll bars via <Rect> (Anti-Pattern)', () => {
    expect(src).not.toMatch(/<Rect\b/);
  });
  it('appends "txn" unit to y-axis ticks', () => {
    expect(src).toMatch(/formatIntShort\s*\([^)]*['"]txn['"]/);
  });
  it('overlays a trend line via Spline + bucketTrend', () => {
    expect(src).toMatch(/<Spline\b/);
    expect(src).toMatch(/bucketTrend/);
  });
});

describe('CalendarCountsCard (15-13) forecast overlay wiring', () => {
  const src = readSrc('src/lib/components/CalendarCountsCard.svelte');

  it('uses createForecastOverlay factory with kpi="invoice_count" (NOT revenue_eur)', () => {
    expect(src).toMatch(/createForecastOverlay/);
    expect(src).toMatch(/kpi:\s*['"]invoice_count['"]/);
    expect(src).not.toMatch(/kpi:\s*['"]revenue_eur['"]/);
  });
  it('renders the shared <ForecastOverlay> SVG layer', () => {
    expect(src).toMatch(/<ForecastOverlay\b/);
  });
  it('renders the shared <ForecastTooltipRows> in Tooltip.List', () => {
    expect(src).toMatch(/<ForecastTooltipRows\b/);
  });
  it('uses scaleTime + xInterval for time-axis bars', () => {
    expect(src).toMatch(/scaleTime\s*\(\s*\)/);
    expect(src).toMatch(/\{xInterval\}/);
    expect(src).toMatch(/timeDay/);
    expect(src).toMatch(/timeMonday/);
    expect(src).toMatch(/timeMonth/);
  });
  it('extends xDomain to today + 365d for forecast horizon', () => {
    expect(src).toMatch(/addDays\(\s*new\s+Date\(\)\s*,\s*365\s*\)/);
  });
  it('renders ForecastLegend wired to overlay state', () => {
    expect(src).toMatch(
      /<ForecastLegend[\s\S]*?availableModels=\{overlay\.availableModels\}[\s\S]*?visibleModels=\{overlay\.visibleModels\}[\s\S]*?ontoggle=\{overlay\.toggleModel\}/
    );
  });
});

// ─── Shared-module artifacts ─────────────────────────────────────────────────
// State-factory + SVG overlay + tooltip rows live in their own files now.

describe('forecastOverlay.svelte.ts factory contract', () => {
  const src = readSrc('src/lib/forecastOverlay.svelte.ts');

  it('exports createForecastOverlay + ForecastRow + ForecastPayload + DEFAULT_VISIBLE_MODELS', () => {
    expect(src).toMatch(/export\s+function\s+createForecastOverlay/);
    expect(src).toMatch(/export\s+type\s+ForecastRow/);
    expect(src).toMatch(/export\s+type\s+ForecastPayload/);
    expect(src).toMatch(/export\s+const\s+DEFAULT_VISIBLE_MODELS/);
  });
  it('default visibleModels include sarimax + naive_dow + ets + theta', () => {
    expect(src).toMatch(/'sarimax'/);
    expect(src).toMatch(/'naive_dow'/);
    expect(src).toMatch(/'ets'/);
    expect(src).toMatch(/'theta'/);
  });
  it('toggleModel creates a NEW Set (Svelte 5 reactivity)', () => {
    expect(src).toMatch(/const\s+next\s*=\s*new\s+Set\(visibleModels\)/);
  });
  it('fetches /api/forecast?kpi=${kpi}&granularity=${grain}', () => {
    expect(src).toMatch(/\/api\/forecast\?kpi=\$\{[^}]*\}&granularity=\$\{[^}]*\}/);
  });
  it('lastFetchedGrain guard prevents reactive loops', () => {
    expect(src).toMatch(/lastFetchedGrain/);
  });
  it('seriesByModel sorts each model rows ascending by target_date', () => {
    expect(src).toMatch(/\.sort\(\(a,\s*b\)\s*=>\s*a\.target_date\.localeCompare\(b\.target_date\)\)/);
  });
});

describe('ForecastOverlay.svelte SVG markup', () => {
  const src = readSrc('src/lib/components/ForecastOverlay.svelte');

  it('renders Area for CI band (yhat_lower / yhat_upper)', () => {
    expect(src).toMatch(/<Area\b[\s\S]*?yhat_lower/);
    expect(src).toMatch(/<Area\b[\s\S]*?yhat_upper/);
  });
  it('renders Spline for line per visible model (yhat_mean)', () => {
    expect(src).toMatch(/<Spline\b[\s\S]*?yhat_mean/);
  });
  it('CI band uses fillOpacity 0.06 (back-layer mush prevention)', () => {
    expect(src).toMatch(/fillOpacity=\{?0\.06\}?/);
  });
  it('naive_dow uses thinner stroke (1px) than other models (2px)', () => {
    expect(src).toMatch(/isNaive\s*\?\s*1\s*:\s*2/);
  });
  it('all forecast lines dashed (4 4) for past+future unification', () => {
    expect(src).toMatch(/stroke-dasharray="4 4"/);
  });
  it('renders hover guide line when hoveredBucketIso is set', () => {
    expect(src).toMatch(/\{#if\s+hoveredBucketIso\b/);
    expect(src).toMatch(/<line\b[\s\S]*?stroke-dasharray="2 2"/);
  });
  it('renders hover dot per visible model at the hovered bucket', () => {
    expect(src).toMatch(/<circle\b[\s\S]*?cy=\{chartCtx\.yScale\(fr\.yhat_mean\)\}/);
  });
});

describe('ForecastTooltipRows.svelte', () => {
  const src = readSrc('src/lib/components/ForecastTooltipRows.svelte');

  it('each <li> spans the full grid (1 / -1) so model rows do not pair into 2 columns', () => {
    expect(src).toMatch(/style:grid-column="1 \/ -1"/);
  });
  it('shows mean + (low–high) range using formatValue prop', () => {
    expect(src).toMatch(/formatValue\(fr\.yhat_mean\)/);
    expect(src).toMatch(/formatValue\(fr\.yhat_lower\)/);
    expect(src).toMatch(/formatValue\(fr\.yhat_upper\)/);
  });
});
