// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import DatePickerPopover from '$lib/components/DatePickerPopover.svelte';
import FilterBar from '$lib/components/FilterBar.svelte';
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
  sales_type: 'all',
  is_cash: 'all',
  days: [1, 2, 3, 4, 5, 6, 7],
  from: undefined,
  to: undefined
};

// FilterBar is now a thin layout wrapper with no complex logic to unit-test.
// The FilterSheet and MultiSelectDropdown tests are removed (components deleted).
// DatePickerPopover tests remain as they validate the trigger label logic.

describe('DatePickerPopover trigger', () => {
  it("renders 'Custom' on line 1 when filters.range === 'custom'", () => {
    const { container } = render(DatePickerPopover, {
      filters: { ...baseFilters, range: 'custom', from: '2026-04-01', to: '2026-04-10' },
      window: {
        from: '2026-04-01',
        to: '2026-04-10',
        priorFrom: '2026-03-22',
        priorTo: '2026-03-31'
      },
      onrangechange: () => {}
    });
    const btn = container.querySelector('button');
    expect(btn?.textContent).toMatch(/Custom/);
  });

  it("renders '7d' on line 1 and formatted date range on line 2 when range === '7d'", () => {
    const { container } = render(DatePickerPopover, {
      filters: baseFilters,
      window: baseWindow,
      onrangechange: () => {}
    });
    const btn = container.querySelector('button');
    const text = btn?.textContent ?? '';
    expect(text).toMatch(/7d/);
    expect(text).toMatch(/Apr\s*9\s*–\s*Apr\s*15/);
  });
});

// quick-260420-wdf: Days popover smoke test.
describe('FilterBar Days popover', () => {
  it('renders 7 day checkboxes (Mon..Sun) + Weekdays preset when opened', async () => {
    // Popover portals into #popover-root; add it to document for the test.
    if (!document.getElementById('popover-root')) {
      const root = document.createElement('div');
      root.id = 'popover-root';
      document.body.appendChild(root);
    }

    const { getByTestId } = render(FilterBar, {
      filters: baseFilters,
      window: baseWindow,
      days: baseFilters.days,
      onrangechange: () => {},
      onsalestypechange: () => {},
      oncashfilterchange: () => {},
      onDaysChange: () => {}
    });

    // Trigger renders inline — click it to open the popover.
    const trigger = getByTestId('days-popover-trigger');
    await fireEvent.click(trigger);

    // Popover content is portaled into document — query body for content.
    const content = document.body.querySelector('[data-testid="days-popover-content"]');
    expect(content).toBeTruthy();

    // All 7 day labels present (Mon..Sun).
    const text = content?.textContent ?? '';
    for (const label of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
      expect(text).toContain(label);
    }

    // Weekdays preset button is rendered.
    const weekdaysBtn = document.body.querySelector('[data-testid="days-preset-weekdays"]');
    expect(weekdaysBtn).toBeTruthy();
  });
});
