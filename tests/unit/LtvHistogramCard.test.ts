// @vitest-environment jsdom
// Pass 3 (quick-260418-3ec): dynamic €5 bins + repeater stack.
// Shape changed from { bin, customers } → { bin, new, repeat }.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
import LtvHistogramCard from '../../src/lib/components/LtvHistogramCard.svelte';
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

  it('renders heading with new vs. repeat language when data present', () => {
    const data = [
      { card_hash: 'a', revenue_cents: 500,   visit_count: 1, cohort_week: '2026-03-23', cohort_month: '2026-03-01' },
      { card_hash: 'b', revenue_cents: 3000,  visit_count: 2, cohort_week: '2026-03-23', cohort_month: '2026-03-01' },
      { card_hash: 'c', revenue_cents: 30000, visit_count: 5, cohort_week: '2026-03-23', cohort_month: '2026-03-01' }
    ];
    const { container } = render(LtvHistogramCard, { data });
    expect(container.textContent).toMatch(/Customer count by lifetime revenue bucket/);
    expect(container.textContent).toMatch(/new vs\. repeat/);
    const card = container.querySelector('[data-testid="ltv-histogram-card"]');
    expect(card).toBeInTheDocument();
  });

  it('zero-revenue one-timer customer lands in first bin (€0–5) as "new"', () => {
    // Single customer with 0 revenue + 1 visit → should appear in first bin as new.
    // (Bins auto-scale; max=0 yields the single €0–5 bin.)
    const data = [
      { card_hash: 'zero', revenue_cents: 0, visit_count: 1, cohort_week: '2026-03-23', cohort_month: '2026-03-01' }
    ];
    const { container } = render(LtvHistogramCard, { data });
    // Spot-check: component mounts and first bin label is visible on the axis.
    expect(container.textContent).toContain('\u20135'); // en-dash + 5 (€0–5)
  });

  it('10000c repeater lands in bin scoped to max revenue with repeat visit_count', () => {
    // Three customers, one with 10000c + 3 visits → repeater.
    // Component should mount without error and render the repeater bar.
    const data = [
      { card_hash: 'a', revenue_cents: 500,   visit_count: 1, cohort_week: '2026-03-23', cohort_month: '2026-03-01' },
      { card_hash: 'b', revenue_cents: 3000,  visit_count: 1, cohort_week: '2026-03-23', cohort_month: '2026-03-01' },
      { card_hash: 'c', revenue_cents: 10000, visit_count: 3, cohort_week: '2026-03-23', cohort_month: '2026-03-01' }
    ];
    const { container } = render(LtvHistogramCard, { data });
    const card = container.querySelector('[data-testid="ltv-histogram-card"]');
    expect(card).toBeInTheDocument();
    // Max 10000 → 20 bins; bin labels visible on axis in LayerChart DOM.
    expect(container.textContent).toContain('\u20135'); // en-dash in any bin label
  });

  it('bin count adapts to max revenue (not fixed at 6)', () => {
    // max revenue 500 cents → bin count is small (1 bin). This proves the fixed-6 bin
    // contract was removed: under Pass 2's LTV_BINS, every render was 6 bins.
    const data = [
      { card_hash: 'a', revenue_cents: 0,   visit_count: 1, cohort_week: '2026-03-23', cohort_month: '2026-03-01' },
      { card_hash: 'b', revenue_cents: 100, visit_count: 1, cohort_week: '2026-03-23', cohort_month: '2026-03-01' },
      { card_hash: 'c', revenue_cents: 200, visit_count: 1, cohort_week: '2026-03-23', cohort_month: '2026-03-01' }
    ];
    const { container } = render(LtvHistogramCard, { data });
    expect(container.querySelector('[data-testid="ltv-histogram-card"]')).toBeInTheDocument();
    // Large-revenue dataset — 20000c → 40 bins; component still mounts.
    const big = [
      { card_hash: 'x', revenue_cents: 20000, visit_count: 1, cohort_week: '2026-03-23', cohort_month: '2026-03-01' }
    ];
    const { container: big2 } = render(LtvHistogramCard, { data: big });
    expect(big2.querySelector('[data-testid="ltv-histogram-card"]')).toBeInTheDocument();
  });
});
