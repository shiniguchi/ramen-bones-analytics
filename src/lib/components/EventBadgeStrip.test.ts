// @vitest-environment jsdom
// Phase 16.3-03 Task 2 — RED tests for EventBadgeStrip.svelte.
// Asserts D-03 visual rules (one badge per bucket, single-event vs
// multi-event color via EVENT_PRIORITY, count corner '5+' rollup),
// D-06 fixed-height empty-bucket behaviour, SC6 ≥44px tap-target,
// keyboard accessibility (tabindex=0 + role=button + aria-label),
// and the XSS / palette anti-pattern gates.
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

vi.mock('$app/state', () => ({
  page: { data: { locale: 'en' } }
}));

import EventBadgeStrip from './EventBadgeStrip.svelte';
import { EVENT_TYPE_COLORS } from '$lib/eventTypeColors';
import type { ForecastEvent } from '$lib/forecastEventClamp';

const buckets = [
  { iso: '2026-04-13', left: 0,   width: 30 },
  { iso: '2026-04-14', left: 30,  width: 30 },
  { iso: '2026-04-15', left: 60,  width: 30 },
  { iso: '2026-04-16', left: 90,  width: 30 }
];

describe('EventBadgeStrip', () => {
  it('renders nothing inside an empty bucket but keeps strip height', () => {
    const { container } = render(EventBadgeStrip, {
      events: [] as ForecastEvent[],
      buckets,
      grain: 'day' as const,
      width: 120
    });
    const strip = container.querySelector('[data-testid="event-badge-strip"]') as HTMLElement;
    expect(strip).not.toBeNull();
    // D-06: strip height is fixed at 44px even when no badges render.
    expect(strip.style.height).toBe('44px');
    expect(strip.style.width).toBe('120px');
    expect(container.querySelectorAll('[data-testid="event-strip-badge"]').length).toBe(0);
  });

  it('renders ONE badge per bucket (not one per event) with single-event color', () => {
    const events: ForecastEvent[] = [
      { type: 'campaign_start', date: '2026-04-14', label: 'Spring launch' },
      { type: 'holiday',        date: '2026-04-15', label: 'Easter' }
    ];
    const { container } = render(EventBadgeStrip, {
      events,
      buckets,
      grain: 'day' as const,
      width: 120
    });
    const badges = container.querySelectorAll<HTMLButtonElement>('[data-testid="event-strip-badge"]');
    expect(badges.length).toBe(2);

    const apr14 = container.querySelector<HTMLButtonElement>(
      '[data-testid="event-strip-badge"][data-bucket-iso="2026-04-14"]'
    )!;
    const apr15 = container.querySelector<HTMLButtonElement>(
      '[data-testid="event-strip-badge"][data-bucket-iso="2026-04-15"]'
    )!;

    expect(apr14.style.backgroundColor).toBe('rgb(220, 38, 38)'); // #dc2626
    expect(apr15.style.backgroundColor).toBe('rgb(22, 163, 74)'); // #16a34a

    // Sanity-check the palette source so this assertion stays in lockstep.
    expect(EVENT_TYPE_COLORS.campaign_start).toBe('#dc2626');
    expect(EVENT_TYPE_COLORS.holiday).toBe('#16a34a');
  });

  it('multi-event bucket uses the highest-priority colour and shows a count corner', () => {
    const events: ForecastEvent[] = [
      // recurring_event = priority 1
      { type: 'recurring_event', date: '2026-04-14', label: 'Live music' },
      // holiday = priority 2
      { type: 'holiday',         date: '2026-04-14', label: 'Easter' },
      // campaign_start = priority 5 — should win
      { type: 'campaign_start',  date: '2026-04-14', label: 'Spring launch' }
    ];
    const { container } = render(EventBadgeStrip, {
      events,
      buckets,
      grain: 'day' as const,
      width: 120
    });
    const badge = container.querySelector<HTMLButtonElement>(
      '[data-testid="event-strip-badge"][data-bucket-iso="2026-04-14"]'
    )!;
    expect(badge.style.backgroundColor).toBe('rgb(220, 38, 38)'); // campaign_start = #dc2626 wins
    expect(badge.dataset.eventCount).toBe('3');
    const counter = badge.querySelector('[data-testid="event-strip-count"]');
    expect(counter?.textContent?.trim()).toBe('3');
  });

  it('rolls counts ≥5 to the literal "5+" string per D-03', () => {
    const events: ForecastEvent[] = Array.from({ length: 7 }, (_, i) => ({
      type: 'holiday' as const,
      date: '2026-04-14',
      label: `H${i}`
    }));
    const { container } = render(EventBadgeStrip, {
      events,
      buckets,
      grain: 'day' as const,
      width: 120
    });
    const counter = container.querySelector('[data-testid="event-strip-count"]');
    expect(counter?.textContent?.trim()).toBe('5+');
  });

  it('badge meets ≥44×44 tap-target minimum and is keyboard reachable', () => {
    const events: ForecastEvent[] = [
      { type: 'holiday', date: '2026-04-14', label: 'Easter' }
    ];
    const { container } = render(EventBadgeStrip, {
      events,
      buckets,
      grain: 'day' as const,
      width: 120
    });
    const badge = container.querySelector<HTMLButtonElement>(
      '[data-testid="event-strip-badge"]'
    )!;
    // Bucket width is 30 in fixture; must be promoted to ≥44 for tap target.
    const widthPx = parseInt(badge.style.width, 10);
    expect(widthPx).toBeGreaterThanOrEqual(44);
    expect(badge.tabIndex).toBe(0);
    expect(badge.getAttribute('aria-label')).toMatch(/2026-04-14/);
  });

  it('opens the popup on click and toggles closed on second click', async () => {
    const events: ForecastEvent[] = [
      { type: 'campaign_start', date: '2026-04-14', label: 'Spring launch' }
    ];
    const { container } = render(EventBadgeStrip, {
      events,
      buckets,
      grain: 'day' as const,
      width: 120
    });
    const badge = container.querySelector<HTMLButtonElement>(
      '[data-testid="event-strip-badge"]'
    )!;
    expect(container.querySelector('[data-testid="chart-hover-popup"]')).toBeNull();
    await fireEvent.click(badge);
    expect(container.querySelector('[data-testid="chart-hover-popup"]')).not.toBeNull();
    await fireEvent.click(badge);
    expect(container.querySelector('[data-testid="chart-hover-popup"]')).toBeNull();
  });

  it('opens the popup via Enter / Space keys for keyboard users', async () => {
    const events: ForecastEvent[] = [
      { type: 'campaign_start', date: '2026-04-14', label: 'Spring launch' }
    ];
    const { container } = render(EventBadgeStrip, {
      events,
      buckets,
      grain: 'day' as const,
      width: 120
    });
    const badge = container.querySelector<HTMLButtonElement>(
      '[data-testid="event-strip-badge"]'
    )!;
    badge.focus();
    await fireEvent.keyDown(badge, { key: 'Enter' });
    expect(container.querySelector('[data-testid="chart-hover-popup"]')).not.toBeNull();
    await fireEvent.keyDown(badge, { key: 'Enter' });
    expect(container.querySelector('[data-testid="chart-hover-popup"]')).toBeNull();
    await fireEvent.keyDown(badge, { key: ' ' });
    expect(container.querySelector('[data-testid="chart-hover-popup"]')).not.toBeNull();
  });
});
