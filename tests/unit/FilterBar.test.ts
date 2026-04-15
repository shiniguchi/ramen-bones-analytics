// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import FilterBar from '$lib/components/FilterBar.svelte';
import DatePickerPopover from '$lib/components/DatePickerPopover.svelte';
import type { FiltersState } from '$lib/filters';
import type { RangeWindow } from '$lib/dateRange';

const baseWindow: RangeWindow = {
  from: '2026-04-09',
  to: '2026-04-15',
  priorFrom: '2026-04-02',
  priorTo: '2026-04-08'
};

const baseFilters: FiltersState = {
  range: '7d',
  grain: 'week',
  sales_type: undefined,
  payment_method: undefined,
  from: undefined,
  to: undefined
};

describe('FilterBar', () => {
  it('renders date picker, grain toggle, and Filters button when both distinct arrays non-empty', () => {
    const { container } = render(FilterBar, {
      filters: baseFilters,
      window: baseWindow,
      distinctSalesTypes: ['INHOUSE', 'TAKEAWAY'],
      distinctPaymentMethods: ['Visa', 'Bar'],
      distinctCountries: ['__de_only__', '__non_de_only__', 'DE', 'AT', '__unknown__']
    });
    // Sticky wrapper present
    expect(container.querySelector('[data-slot="filter-bar"]')).not.toBeNull();
    // Grain toggle present
    expect(container.querySelector('[role="group"][aria-label="Grain selector"]')).not.toBeNull();
    // Filters button present
    const filtersBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Filters'
    );
    expect(filtersBtn).toBeTruthy();
  });

  it('hides the Filters button when both distinct arrays are empty (D-13)', () => {
    const { container } = render(FilterBar, {
      filters: baseFilters,
      window: baseWindow,
      distinctSalesTypes: [],
      distinctPaymentMethods: [],
      distinctCountries: []
    });
    const filtersBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Filters'
    );
    expect(filtersBtn).toBeUndefined();
  });

  it('applies border-primary tint to Filters button when sales_type is set (D-04)', () => {
    const { container } = render(FilterBar, {
      filters: { ...baseFilters, sales_type: ['INHOUSE'] },
      window: baseWindow,
      distinctSalesTypes: ['INHOUSE', 'TAKEAWAY'],
      distinctPaymentMethods: ['Visa'],
      distinctCountries: []
    });
    const filtersBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Filters'
    );
    expect(filtersBtn?.className).toMatch(/border-primary\/60/);
  });
});

describe('DatePickerPopover trigger', () => {
  it("renders 'Custom' on line 1 when filters.range === 'custom'", () => {
    const { container } = render(DatePickerPopover, {
      filters: { ...baseFilters, range: 'custom', from: '2026-04-01', to: '2026-04-10' },
      window: {
        from: '2026-04-01',
        to: '2026-04-10',
        priorFrom: '2026-03-22',
        priorTo: '2026-03-31'
      }
    });
    // Trigger button is the only <button> before popover opens.
    const btn = container.querySelector('button');
    expect(btn?.textContent).toMatch(/Custom/);
  });

  it("renders '7d' on line 1 and formatted date range on line 2 when range === '7d'", () => {
    const { container } = render(DatePickerPopover, {
      filters: baseFilters,
      window: baseWindow
    });
    const btn = container.querySelector('button');
    const text = btn?.textContent ?? '';
    expect(text).toMatch(/7d/);
    // Formatted "MMM d – MMM d" — Apr 9 – Apr 15
    expect(text).toMatch(/Apr\s*9\s*–\s*Apr\s*15/);
  });
});
