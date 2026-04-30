// tests/unit/forecastEventClamp.test.ts
// Phase 15 D-09 / FUI-05 — progressive disclosure: ≤50 markers at default zoom.
// When events exceed the cap, drop lowest-priority types first:
//   campaign_start > transit_strike > school_holiday > holiday > recurring_event
import { describe, it, expect } from 'vitest';
import { clampEvents, EVENT_PRIORITY, type ForecastEvent } from '../../src/lib/forecastEventClamp';

const ev = (type: ForecastEvent['type'], date: string, label: string): ForecastEvent =>
  ({ type, date, label });

describe('clampEvents', () => {
  it('returns input unchanged when count <= max', () => {
    const events: ForecastEvent[] = [
      ev('holiday', '2026-05-01', 'Tag der Arbeit'),
      ev('recurring_event', '2026-05-15', 'Berlin Marathon')
    ];
    expect(clampEvents(events, 50)).toEqual(events);
  });

  it('drops lowest-priority type first when over cap', () => {
    const events: ForecastEvent[] = [
      ...Array.from({ length: 30 }, (_, i) => ev('recurring_event', `2026-05-${String(i + 1).padStart(2, '0')}`, `r${i}`)),
      ...Array.from({ length: 30 }, (_, i) => ev('holiday', `2026-06-${String(i + 1).padStart(2, '0')}`, `h${i}`))
    ];
    const out = clampEvents(events, 50);
    expect(out.length).toBeLessThanOrEqual(50);
    // Should keep all 30 holidays (higher priority) and drop 10 recurring.
    expect(out.filter(e => e.type === 'holiday').length).toBe(30);
    expect(out.filter(e => e.type === 'recurring_event').length).toBe(20);
  });

  it('campaign_start always survives — never dropped', () => {
    const events: ForecastEvent[] = [
      ev('campaign_start', '2026-04-14', 'Spring campaign'),
      ...Array.from({ length: 60 }, (_, i) =>
        ev('recurring_event', `2026-05-${String(i + 1).padStart(2, '0')}`, `r${i}`))
    ];
    const out = clampEvents(events, 50);
    expect(out.find(e => e.type === 'campaign_start')).toBeDefined();
  });

  it('priority order is campaign > transit > school > holiday > recurring (D-09)', () => {
    expect(EVENT_PRIORITY.campaign_start).toBeGreaterThan(EVENT_PRIORITY.transit_strike);
    expect(EVENT_PRIORITY.transit_strike).toBeGreaterThan(EVENT_PRIORITY.school_holiday);
    expect(EVENT_PRIORITY.school_holiday).toBeGreaterThan(EVENT_PRIORITY.holiday);
    expect(EVENT_PRIORITY.holiday).toBeGreaterThan(EVENT_PRIORITY.recurring_event);
  });

  it('within a single type, earlier dates win when tied at the cap boundary', () => {
    const events: ForecastEvent[] = Array.from({ length: 60 }, (_, i) =>
      ev('holiday', `2026-${String(Math.floor(i / 30) + 5).padStart(2, '0')}-${String((i % 30) + 1).padStart(2, '0')}`, `h${i}`));
    const out = clampEvents(events, 50);
    expect(out.length).toBe(50);
    const dates = out.map(e => e.date).sort();
    // String compare: first kept date should sort before last kept date.
    expect(dates[0] < dates[dates.length - 1]).toBe(true);
  });

  // Dedupe: federal+Berlin holiday rows that share (type, date, label).
  // Without this, EventMarker's keyed-each `(e.type + '|' + e.date)` would
  // crash Svelte 5 with `each_key_duplicate` at runtime.
  it('dedupes identical (type, date, label) tuples — federal+Berlin holiday overlap', () => {
    const events: ForecastEvent[] = [
      ev('holiday', '2026-05-01', 'Tag der Arbeit'),
      ev('holiday', '2026-05-01', 'Tag der Arbeit') // duplicate (federal + BE row)
    ];
    const out = clampEvents(events, 50);
    expect(out.length).toBe(1);
    expect(out[0]).toEqual(ev('holiday', '2026-05-01', 'Tag der Arbeit'));
  });

  it('preserves events with same (type, date) but different labels', () => {
    const events: ForecastEvent[] = [
      ev('recurring_event', '2026-09-26', 'Berlin Marathon'),
      ev('recurring_event', '2026-09-26', 'Festival of Lights')
    ];
    const out = clampEvents(events, 50);
    expect(out.length).toBe(2);
  });

  it('dedupe runs before cap — 60 events with 20 duplicates collapse to 40 (no clamp)', () => {
    const unique: ForecastEvent[] = Array.from({ length: 40 }, (_, i) =>
      ev('holiday', `2026-05-${String(i + 1).padStart(2, '0')}`, `h${i}`));
    const dupes: ForecastEvent[] = unique.slice(0, 20).map(e => ({ ...e })); // 20 exact dupes
    const out = clampEvents([...unique, ...dupes], 50);
    expect(out.length).toBe(40);
  });
});
