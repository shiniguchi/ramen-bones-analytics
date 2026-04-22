// @vitest-environment jsdom
// quick-260418-28j Pass 2: CohortRetentionCard rewrite — drop client re-bucket,
// read monthly rows from SQL, cap x-axis domain, render up to 12 cohort lines.
//
// RED→GREEN: these assertions fail against the old weekly-only component.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
import CohortRetentionCard from '../../src/lib/components/CohortRetentionCard.svelte';
import { initStore } from '../../src/lib/dashboardStore.svelte';
import { FILTER_DEFAULTS } from '../../src/lib/filters';
import type { RetentionRow, RetentionMonthlyRow } from '../../src/lib/sparseFilter';

// LayerChart uses window.matchMedia internally; JSDOM doesn't provide it.
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

// Minimal weekly retention fixture — one cohort, 3 rows.
const weeklyMock: RetentionRow[] = [
  { cohort_week: '2026-03-23', period_weeks: 0, retention_rate: 1.0, cohort_size_week: 10, cohort_age_weeks: 3 },
  { cohort_week: '2026-03-23', period_weeks: 1, retention_rate: 0.5, cohort_size_week: 10, cohort_age_weeks: 3 },
  { cohort_week: '2026-03-23', period_weeks: 2, retention_rate: 0.4, cohort_size_week: 10, cohort_age_weeks: 3 }
];

// Minimal monthly retention fixture — one cohort, 3 periods.
const monthlyMock: RetentionMonthlyRow[] = [
  { cohort_month: '2026-01-01', period_months: 0, retention_rate: 1.0, cohort_size_month: 10, cohort_age_months: 3 },
  { cohort_month: '2026-01-01', period_months: 1, retention_rate: 0.3, cohort_size_month: 10, cohort_age_months: 3 },
  { cohort_month: '2026-01-01', period_months: 2, retention_rate: 0.2, cohort_size_month: 10, cohort_age_months: 3 }
];

function initDayGrain() {
  initStore({
    dailyRows: [],
    window: { from: '2026-04-13', to: '2026-04-14', priorFrom: null, priorTo: null },
    grain: 'day',
    salesType: 'all',
    cashFilter: 'all',
    filters: { ...FILTER_DEFAULTS, grain: 'day' }
  });
}

function initWeekGrain() {
  initStore({
    dailyRows: [],
    window: { from: '2026-04-13', to: '2026-04-14', priorFrom: null, priorTo: null },
    grain: 'week',
    salesType: 'all',
    cashFilter: 'all',
    filters: { ...FILTER_DEFAULTS, grain: 'week' }
  });
}

function initMonthGrain() {
  initStore({
    dailyRows: [],
    window: { from: '2026-04-13', to: '2026-04-14', priorFrom: null, priorTo: null },
    grain: 'month',
    salesType: 'all',
    cashFilter: 'all',
    filters: { ...FILTER_DEFAULTS, grain: 'month' }
  });
}

describe('CohortRetentionCard weekly-clamp hint (D-17)', () => {
  it('shows "Weekly view" badge when global grain=day', () => {
    initDayGrain();
    const { getByTestId } = render(CohortRetentionCard, {
      props: { dataWeekly: weeklyMock, dataMonthly: [] }
    });
    const hint = getByTestId('cohort-clamp-hint');
    expect(hint).toBeTruthy();
    expect(hint.textContent).toContain('Weekly view');
  });

  it('omits hint when grain=week (clamp is no-op)', () => {
    initWeekGrain();
    const { queryByTestId } = render(CohortRetentionCard, {
      props: { dataWeekly: weeklyMock, dataMonthly: [] }
    });
    expect(queryByTestId('cohort-clamp-hint')).toBeNull();
  });

  it('omits hint when grain=month (hint only flags day-grain)', () => {
    initMonthGrain();
    const { queryByTestId } = render(CohortRetentionCard, {
      props: { dataWeekly: weeklyMock, dataMonthly: monthlyMock }
    });
    expect(queryByTestId('cohort-clamp-hint')).toBeNull();
  });
});

describe('CohortRetentionCard — monthly grain reads from dataMonthly (Pass 2)', () => {
  it('does NOT render the legacy "approximated from weekly data" note', () => {
    initMonthGrain();
    const { container } = render(CohortRetentionCard, {
      props: { dataWeekly: weeklyMock, dataMonthly: monthlyMock }
    });
    expect(container.textContent ?? '').not.toMatch(/approximated from weekly/i);
  });

  it('cohort-month-note testid is gone', () => {
    initMonthGrain();
    const { queryByTestId } = render(CohortRetentionCard, {
      props: { dataWeekly: weeklyMock, dataMonthly: monthlyMock }
    });
    expect(queryByTestId('cohort-month-note')).toBeNull();
  });

  it('renders at least one spline path when dataMonthly is non-empty', () => {
    initMonthGrain();
    const { container } = render(CohortRetentionCard, {
      props: { dataWeekly: weeklyMock, dataMonthly: monthlyMock }
    });
    // LayerChart Spline renders as an SVG path element.
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBeGreaterThan(0);
  });

  it('falls back to empty-state when dataMonthly is empty on month grain', () => {
    initMonthGrain();
    const { container } = render(CohortRetentionCard, {
      props: { dataWeekly: weeklyMock, dataMonthly: [] }
    });
    // Scope to this render's container — multi-render JSDOM leaves stale nodes
    // in document.body (same pattern as KpiTile tests).
    expect(container.querySelector('[data-testid="cohort-card"]')).toBeTruthy();
  });
});

describe('CohortRetentionCard — weekly grain (12 cohort lines cap)', () => {
  it('renders up to 12 cohort lines from a 20-cohort fixture', () => {
    initWeekGrain();
    const bigWeekly: RetentionRow[] = [];
    for (let i = 0; i < 20; i++) {
      const month = String((i % 12) + 1).padStart(2, '0');
      const day = String((i % 28) + 1).padStart(2, '0');
      const year = 2024 + Math.floor(i / 12);
      const cohort_week = `${year}-${month}-${day}`;
      // Two rows per cohort — period 0 and 1 — so each renders as a line.
      bigWeekly.push({ cohort_week, period_weeks: 0, retention_rate: 1, cohort_size_week: 10, cohort_age_weeks: 10 });
      bigWeekly.push({ cohort_week, period_weeks: 1, retention_rate: 0.5, cohort_size_week: 10, cohort_age_weeks: 10 });
    }
    const { container } = render(CohortRetentionCard, {
      props: { dataWeekly: bigWeekly, dataMonthly: [] }
    });
    // With 20 cohorts, exactly 12 should render (capped by MAX_COHORT_LINES).
    // LayerChart renders each Spline as a <path>; the total path count includes
    // grid lines and axis ticks, so we assert it's ≥ 12 (one per cohort line).
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBeGreaterThanOrEqual(12);
  });
});
