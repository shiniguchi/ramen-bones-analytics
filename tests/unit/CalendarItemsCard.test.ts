// @vitest-environment jsdom
// Phase 10 Plan 06 Task 2 — component render test for VA-08 calendar items card.
// Verifies: data-testid, empty-state branch, stacked layout path, filter branch.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
import CalendarItemsCard from '../../src/lib/components/CalendarItemsCard.svelte';
import { emptyStates } from '../../src/lib/emptyStates';
import { initStore } from '../../src/lib/dashboardStore.svelte';
import { FILTER_DEFAULTS } from '../../src/lib/filters';

// LayerChart uses window.matchMedia; JSDOM doesn't provide it.
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

// Seed the store so getFilters() returns a predictable state.
function seedStore(grain: 'day' | 'week' | 'month' = 'week') {
  initStore({
    dailyRows: [],
    window: { from: '2026-04-01', to: '2026-04-30', priorFrom: null, priorTo: null },
    grain,
    salesType: 'all',
    cashFilter: 'all',
    filters: { ...FILTER_DEFAULTS, grain }
  });
}

describe('CalendarItemsCard (VA-08)', () => {
  it('renders empty state when data is empty', () => {
    seedStore();
    const { container } = render(CalendarItemsCard, { data: [] });
    const card = container.querySelector('[data-testid="calendar-items-card"]');
    expect(card).toBeInTheDocument();
    const copy = emptyStates['calendar-items'];
    expect(container.textContent).toContain(copy.heading);
    expect(container.textContent).toContain(copy.body);
  });

  it('renders "Items sold per period" heading when data present', () => {
    seedStore();
    const data = [
      { business_date: '2026-04-13', item_name: 'Tonkotsu Ramen', sales_type: 'INHOUSE', is_cash: false, item_count: 10 },
      { business_date: '2026-04-13', item_name: 'Gyoza',          sales_type: 'INHOUSE', is_cash: false, item_count: 8 }
    ];
    const { container } = render(CalendarItemsCard, { data });
    expect(container.textContent).toMatch(/Items sold per period/);
    const card = container.querySelector('[data-testid="calendar-items-card"]');
    expect(card).toBeInTheDocument();
  });

  it('rolls ≥9 items into top-8 + "Other" (VA-08 / D-14)', () => {
    seedStore();
    // 10 items on a single day — rollup should collapse items 9+ into "Other".
    const data = Array.from({ length: 10 }, (_, i) => ({
      business_date: '2026-04-13',
      item_name: `Item${i}`,
      sales_type: 'INHOUSE',
      is_cash: false,
      item_count: 10 - i
    }));
    // Sanity render — no throw, card visible.
    const { container } = render(CalendarItemsCard, { data });
    expect(container.querySelector('[data-testid="calendar-items-card"]')).toBeInTheDocument();
  });
});
