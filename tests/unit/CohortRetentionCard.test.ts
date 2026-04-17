// @vitest-environment jsdom
// Phase 10 Plan 07 — flipped from .todo to real assertions in 10-07.
// Verifies D-17 weekly-clamp hint on CohortRetentionCard (VA-06 UX parity
// with VA-09/VA-10 cohort charts).
import { describe, it, expect, beforeAll, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
import CohortRetentionCard from '../../src/lib/components/CohortRetentionCard.svelte';
import { initStore } from '../../src/lib/dashboardStore.svelte';
import { FILTER_DEFAULTS } from '../../src/lib/filters';
import type { RetentionRow } from '../../src/lib/sparseFilter';

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

// Minimal retention fixture — one cohort, 3 rows.
const mockData: RetentionRow[] = [
  { cohort_week: '2026-03-23', period_weeks: 0, retention_rate: 1.0, cohort_size_week: 10, cohort_age_weeks: 3 },
  { cohort_week: '2026-03-23', period_weeks: 1, retention_rate: 0.5, cohort_size_week: 10, cohort_age_weeks: 3 },
  { cohort_week: '2026-03-23', period_weeks: 2, retention_rate: 0.4, cohort_size_week: 10, cohort_age_weeks: 3 }
];

describe('CohortRetentionCard weekly-clamp hint (D-17)', () => {
  it('shows "Cohort view shows weekly" hint when global grain=day', () => {
    initStore({
      dailyRows: [],
      window: { from: '2026-04-13', to: '2026-04-14', priorFrom: null, priorTo: null },
      grain: 'day',
      salesType: 'all',
      cashFilter: 'all',
      filters: { ...FILTER_DEFAULTS, grain: 'day' }
    });
    const { getByTestId } = render(CohortRetentionCard, { props: { data: mockData } });
    const hint = getByTestId('cohort-clamp-hint');
    expect(hint).toBeTruthy();
    expect(hint.textContent).toContain('Cohort view shows weekly');
  });

  it('omits hint when grain=week (clamp is no-op)', () => {
    initStore({
      dailyRows: [],
      window: { from: '2026-04-13', to: '2026-04-14', priorFrom: null, priorTo: null },
      grain: 'week',
      salesType: 'all',
      cashFilter: 'all',
      filters: { ...FILTER_DEFAULTS, grain: 'week' }
    });
    const { queryByTestId } = render(CohortRetentionCard, { props: { data: mockData } });
    expect(queryByTestId('cohort-clamp-hint')).toBeNull();
  });

  it('omits hint when grain=month (hint only flags day-grain)', () => {
    initStore({
      dailyRows: [],
      window: { from: '2026-04-13', to: '2026-04-14', priorFrom: null, priorTo: null },
      grain: 'month',
      salesType: 'all',
      cashFilter: 'all',
      filters: { ...FILTER_DEFAULTS, grain: 'month' }
    });
    const { queryByTestId } = render(CohortRetentionCard, { props: { data: mockData } });
    expect(queryByTestId('cohort-clamp-hint')).toBeNull();
  });
});
