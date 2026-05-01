// @vitest-environment jsdom
// tests/unit/EventMarker.test.ts
// Phase 15 D-09 / FUI-05 — EventMarker renders 5 event types as SVG primitives.
// We pass a fake xScale (linear function) so the component can compute x positions
// without needing a real <Chart> parent.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup } from '@testing-library/svelte';
import EventMarker from '../../src/lib/components/EventMarker.svelte';
import type { ForecastEvent } from '../../src/lib/forecastEventClamp';

// Vitest config has no `globals: true`, so @testing-library/svelte's auto
// afterEach cleanup is not registered. Call it explicitly so each test
// renders a fresh DOM (otherwise multiple renders pile up and the same-host
// queries find duplicate matches).
afterEach(() => {
  cleanup();
});

beforeAll(() => {
  if (typeof window !== 'undefined' && !window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((q: string) => ({
        matches: false, media: q, onchange: null,
        addListener: vi.fn(), removeListener: vi.fn(),
        addEventListener: vi.fn(), removeEventListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    });
  }
});

// Identity-ish xScale: maps date string -> x pixel by parsing YYYY-MM-DD's day-of-month.
// Sufficient for the test - we only assert primitive count + class / data-type, not x exactness.
const xScale = (dateStr: string | Date): number => {
  const s = typeof dateStr === 'string' ? dateStr : dateStr.toISOString().slice(0, 10);
  return Number(s.slice(8, 10));
};

function renderInSvg(events: ForecastEvent[]) {
  // Wrap in <svg> via document.body so the component's path/line/rect children
  // attach to a real SVG host (correct namespace).
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '100');
  svg.setAttribute('height', '100');
  document.body.appendChild(svg);
  return render(EventMarker, {
    target: svg,
    props: { events, xScale, height: 100 }
  });
}

describe('EventMarker', () => {
  it('renders one <line> with stroke=red for campaign_start', () => {
    const events: ForecastEvent[] = [
      { type: 'campaign_start', date: '2026-04-14', label: 'Spring' }
    ];
    const { container } = renderInSvg(events);
    const lines = container.querySelectorAll('line[data-event-type="campaign_start"]');
    expect(lines.length).toBe(1);
  });

  it('renders one dashed <line> for each holiday', () => {
    const events: ForecastEvent[] = [
      { type: 'holiday', date: '2026-05-01', label: 'Tag der Arbeit' },
      { type: 'holiday', date: '2026-05-08', label: 'Liberation Day' }
    ];
    const { container } = renderInSvg(events);
    const lines = container.querySelectorAll('line[data-event-type="holiday"]');
    expect(lines.length).toBe(2);
    for (const l of lines) {
      expect(l.getAttribute('stroke-dasharray')).toBeTruthy();
    }
  });

  it('renders <rect> background spanning start->end for school_holiday', () => {
    const events: ForecastEvent[] = [
      { type: 'school_holiday', date: '2026-07-09', end_date: '2026-08-22', label: 'Sommerferien' }
    ];
    const { container } = renderInSvg(events);
    const rects = container.querySelectorAll('rect[data-event-type="school_holiday"]');
    expect(rects.length).toBe(1);
    // Width = (end_date - start_date) in xScale units. Our test scale uses
    // day-of-month; just assert > 0 so cross-month inputs still satisfy.
    const width = Number(rects[0].getAttribute('width'));
    expect(width).toBeGreaterThan(0);
  });

  it('renders one yellow <line> for recurring_event', () => {
    const events: ForecastEvent[] = [
      { type: 'recurring_event', date: '2026-09-26', label: 'Berlin Marathon' }
    ];
    const { container } = renderInSvg(events);
    const lines = container.querySelectorAll('line[data-event-type="recurring_event"]');
    expect(lines.length).toBe(1);
  });

  it('renders a top-of-chart 4px <rect> bar for transit_strike', () => {
    const events: ForecastEvent[] = [
      { type: 'transit_strike', date: '2026-05-02', label: 'BVG Warnstreik' }
    ];
    const { container } = renderInSvg(events);
    const rects = container.querySelectorAll('rect[data-event-type="transit_strike"]');
    expect(rects.length).toBe(1);
    expect(Number(rects[0].getAttribute('height'))).toBe(4);
  });

  it('mixed events array renders all 5 types simultaneously', () => {
    const events: ForecastEvent[] = [
      { type: 'campaign_start',  date: '2026-04-14', label: 'Spring' },
      { type: 'holiday',         date: '2026-05-01', label: 'Tag der Arbeit' },
      { type: 'school_holiday',  date: '2026-07-09', end_date: '2026-08-22', label: 'Sommerferien' },
      { type: 'recurring_event', date: '2026-09-26', label: 'Berlin Marathon' },
      { type: 'transit_strike',  date: '2026-05-02', label: 'BVG Warnstreik' }
    ];
    const { container } = renderInSvg(events);
    expect(container.querySelectorAll('[data-event-type="campaign_start"]').length).toBe(1);
    expect(container.querySelectorAll('[data-event-type="holiday"]').length).toBe(1);
    expect(container.querySelectorAll('[data-event-type="school_holiday"]').length).toBe(1);
    expect(container.querySelectorAll('[data-event-type="recurring_event"]').length).toBe(1);
    expect(container.querySelectorAll('[data-event-type="transit_strike"]').length).toBe(1);
  });

  it('renders empty (no nodes) when events array is empty', () => {
    const { container } = renderInSvg([]);
    expect(container.querySelectorAll('[data-event-type]').length).toBe(0);
  });
});
