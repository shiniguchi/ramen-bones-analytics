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

  it("imports BarChart from 'layerchart'", () => {
    // Allow additional named imports (Bars, Spline) alongside BarChart — needed
    // for the custom marks snippet that overlays the trend line (quick-260418-trn).
    expect(src).toMatch(/import\s+\{[^}]*\bBarChart\b[^}]*\}\s+from\s+['"]layerchart['"]/);
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
  it('uses seriesLayout="stack" + orientation="vertical"', () => {
    expect(src).toMatch(/seriesLayout=["']stack["']/);
    expect(src).toMatch(/orientation=["']vertical["']/);
  });
  it("shapeForChart called with 'revenue_cents' metric", () => {
    expect(src).toMatch(/shapeForChart\s*\(\s*[^,]+,\s*['"]revenue_cents['"]\s*\)/);
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

describe('CalendarCountsCard (VA-05) source artifacts', () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/components/CalendarCountsCard.svelte'),
    'utf8'
  );

  it("imports BarChart from 'layerchart'", () => {
    expect(src).toMatch(/import\s+\{[^}]*\bBarChart\b[^}]*\}\s+from\s+['"]layerchart['"]/);
  });
  it("shapeForChart called with 'tx_count' metric (NOT revenue_cents)", () => {
    expect(src).toMatch(/shapeForChart\s*\(\s*[^,]+,\s*['"]tx_count['"]\s*\)/);
    expect(src).not.toMatch(/shapeForChart\s*\(\s*[^,]+,\s*['"]revenue_cents['"]\s*\)/);
  });
  it('contains data-testid="calendar-counts-card"', () => {
    expect(src).toMatch(/data-testid=["']calendar-counts-card["']/);
  });
  it('uses seriesLayout="stack" + orientation="vertical"', () => {
    expect(src).toMatch(/seriesLayout=["']stack["']/);
    expect(src).toMatch(/orientation=["']vertical["']/);
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
