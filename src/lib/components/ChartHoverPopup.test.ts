// @vitest-environment jsdom
// Phase 16.3-03 Task 1 — RED tests for ChartHoverPopup.svelte.
// Asserts SC4 (per-bucket popup), C-12 (palette via $lib/eventTypeColors),
// XSS gate (no {@html}), and the show-all expander on month grain.
//
// NOTE: page.data.locale is pinned to 'en' so the EN dictionary entries from
// messages.ts (event_type_*, popup_event_count, popup_show_all_events,
// popup_show_fewer) match the assertions below. Without this, locale
// resolves to '' and t() routes everything through the EN fallback —
// behaviour identical for these keys, but pinning makes the contract
// explicit and survives any future DEFAULT_LOCALE change.
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

vi.mock('$app/state', () => ({
  page: { data: { locale: 'en' } }
}));

import ChartHoverPopup from './ChartHoverPopup.svelte';
import type { ForecastEvent } from '$lib/forecastEventClamp';

const oneEvent: ForecastEvent[] = [
  { type: 'campaign_start', date: '2026-03-15', label: 'Spring ramen launch' }
];

const threeEvents: ForecastEvent[] = [
  { type: 'campaign_start', date: '2026-03-15', label: 'Spring ramen launch' },
  { type: 'holiday',        date: '2026-03-15', label: 'Easter Monday' },
  { type: 'recurring_event', date: '2026-03-15', label: 'Live music night' }
];

// 12 events to exercise the >10 month-grain show-all expander.
const manyEvents: ForecastEvent[] = Array.from({ length: 12 }, (_, i) => ({
  type: 'recurring_event' as const,
  date: '2026-04-01',
  label: `Recurring #${i + 1}`
}));

// `events` collides with a reserved @testing-library/svelte v5 render option,
// so all props must be wrapped in `{ props: {...} }`.
describe('ChartHoverPopup', () => {
  it('renders header with bucket date and count', () => {
    const { container } = render(ChartHoverPopup, {
      props: { events: threeEvents, bucketDate: '2026-03-15', grain: 'day' }
    });
    const popup = container.querySelector('[data-testid="chart-hover-popup"]');
    expect(popup).not.toBeNull();
    expect(popup?.textContent).toContain('2026-03-15');
    expect(popup?.textContent).toContain('3 events');
  });

  it('renders one row per event with type label and event label (text interpolation only)', () => {
    const { container } = render(ChartHoverPopup, {
      props: { events: threeEvents, bucketDate: '2026-03-15', grain: 'day' }
    });
    const text = container.textContent ?? '';
    expect(text).toContain('Campaign');
    expect(text).toContain('Spring ramen launch');
    expect(text).toContain('Public holiday');
    expect(text).toContain('Easter Monday');
    expect(text).toContain('Recurring event');
    expect(text).toContain('Live music night');
  });

  it('renders all events on day grain even when count > 10 (no expander)', () => {
    const { container } = render(ChartHoverPopup, {
      props: { events: manyEvents, bucketDate: '2026-04-01', grain: 'day' }
    });
    // All 12 labels rendered; no expander button.
    expect(container.textContent).toContain('Recurring #12');
    expect(container.querySelector('[data-testid="popup-show-all-toggle"]')).toBeNull();
  });

  it('caps to 10 rows on month grain and exposes a show-all toggle', async () => {
    const { container } = render(ChartHoverPopup, {
      props: { events: manyEvents, bucketDate: '2026-04-01', grain: 'month' }
    });
    expect(container.textContent).toContain('Recurring #10');
    expect(container.textContent).not.toContain('Recurring #11');
    const toggle = container.querySelector(
      '[data-testid="popup-show-all-toggle"]'
    ) as HTMLButtonElement | null;
    expect(toggle).not.toBeNull();
    expect(toggle!.textContent).toContain('Show all 12');

    await fireEvent.click(toggle!);
    expect(container.textContent).toContain('Recurring #12');
    expect(toggle!.textContent).toContain('Show fewer');
  });

  it('renders a single-event bucket without an expander on any grain', () => {
    const { container } = render(ChartHoverPopup, {
      props: { events: oneEvent, bucketDate: '2026-03-15', grain: 'month' }
    });
    expect(container.textContent).toContain('Spring ramen launch');
    expect(container.querySelector('[data-testid="popup-show-all-toggle"]')).toBeNull();
  });

  it('marks the popup as a tooltip role with aria-live', () => {
    const { container } = render(ChartHoverPopup, {
      props: { events: oneEvent, bucketDate: '2026-03-15', grain: 'day' }
    });
    const popup = container.querySelector('[data-testid="chart-hover-popup"]');
    expect(popup?.getAttribute('role')).toBe('tooltip');
    expect(popup?.getAttribute('aria-live')).toBe('polite');
  });
});
