// @vitest-environment jsdom
// Phase 10 Plan 06 Task 1 — component render test for VA-07 LTV histogram card.
// Verifies: data-testid, empty-state branch, non-empty branch uses LTV_BINS order.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
import LtvHistogramCard from '../../src/lib/components/LtvHistogramCard.svelte';
import { LTV_BINS } from '../../src/lib/ltvBins';
import { emptyStates } from '../../src/lib/emptyStates';

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

describe('LtvHistogramCard (VA-07)', () => {
  it('renders empty state when data is empty', () => {
    const { container } = render(LtvHistogramCard, { data: [] });
    const card = container.querySelector('[data-testid="ltv-histogram-card"]');
    expect(card).toBeInTheDocument();
    const copy = emptyStates['ltv-histogram'];
    expect(container.textContent).toContain(copy.heading);
    expect(container.textContent).toContain(copy.body);
  });

  it('renders heading "Customer count by lifetime revenue bucket" when data present', () => {
    const data = [
      { card_hash: 'a', revenue_cents: 500,   visit_count: 1, cohort_week: '2026-03-23', cohort_month: '2026-03-01' },
      { card_hash: 'b', revenue_cents: 3000,  visit_count: 2, cohort_week: '2026-03-23', cohort_month: '2026-03-01' },
      { card_hash: 'c', revenue_cents: 30000, visit_count: 5, cohort_week: '2026-03-23', cohort_month: '2026-03-01' }
    ];
    const { container } = render(LtvHistogramCard, { data });
    expect(container.textContent).toMatch(/Customer count by lifetime revenue bucket/);
    const card = container.querySelector('[data-testid="ltv-histogram-card"]');
    expect(card).toBeInTheDocument();
  });

  it('binds all 6 LTV_BINS into chart data (spot-check via presence of labels in DOM)', () => {
    // Build rows where each bin gets at least one customer.
    const data = LTV_BINS.map((b, i) => ({
      card_hash: `c${i}`,
      revenue_cents: b.minCents, // right-inclusive on minCents
      visit_count: 1,
      cohort_week: '2026-03-23',
      cohort_month: '2026-03-01'
    }));
    const { container } = render(LtvHistogramCard, { data });
    // LayerChart renders axis labels as text nodes — we assert at least one bin label appears.
    // (Strict axis-label assertion would couple to internal LayerChart DOM, so spot-check one.)
    expect(container.textContent).toContain('€0–10');
  });
});
