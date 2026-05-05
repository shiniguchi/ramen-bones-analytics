// tests/unit/forecastValidation.test.ts
// Phase 15 v2 D-14 — parser tests only.
//
// Plan 15-11 dropped the horizon × granularity clamp matrix (forecast is
// fitted natively per grain by 15-10), so isValidCombo /
// DEFAULT_GRANULARITY / the Horizon type were removed. The remaining
// surface — parseHorizon + parseGranularity + HORIZON_DAYS / GRANULARITIES
// constants — is what the new endpoint and HorizonToggle consume.
import { describe, it, expect } from 'vitest';
import {
  parseHorizon,
  parseGranularity,
  windowStartForGrain,
  HORIZON_DAYS,
  GRANULARITIES
} from '../../src/lib/forecastValidation';

describe('parseHorizon', () => {
  it.each(['7', '35', '120', '365'])('accepts numeric horizon "%s"', (s) => {
    expect(parseHorizon(s)).not.toBeNull();
  });
  it('returns null for missing param', () => { expect(parseHorizon(null)).toBeNull(); });
  it('returns null for unsupported horizon', () => { expect(parseHorizon('30')).toBeNull(); });
  it('returns null for junk input', () => { expect(parseHorizon('abc')).toBeNull(); });
});

describe('parseGranularity', () => {
  it('accepts day | week | month', () => {
    expect(parseGranularity('day')).toBe('day');
    expect(parseGranularity('week')).toBe('week');
    expect(parseGranularity('month')).toBe('month');
  });
  it('returns null for missing or junk', () => {
    expect(parseGranularity(null)).toBeNull();
    expect(parseGranularity('hour')).toBeNull();
  });
});

describe('constants', () => {
  it('HORIZON_DAYS exposes 7/35/120/365 (FUI-03)', () => {
    expect(HORIZON_DAYS).toEqual([7, 35, 120, 365]);
  });
  it('GRANULARITIES exposes day/week/month', () => {
    expect(GRANULARITIES).toEqual(['day', 'week', 'month']);
  });
});

// Helper: format a Date as YYYY-MM-DD in LOCAL time (not UTC) so the test
// values match the conceptual dates we author below regardless of test runner TZ.
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

describe('windowStartForGrain', () => {
  // Day grain: Mon of the latest complete Mon-Sun week relative to last_actual.
  it('day | last_actual=Mon May 11 -> Mon May 4 (CW19 incomplete -> CW18 latest)', () => {
    expect(ymd(windowStartForGrain(new Date(2026, 4, 11), 'day'))).toBe('2026-05-04');
  });
  it('day | last_actual=Sun May 3 -> Mon Apr 27 (CW18 IS complete)', () => {
    expect(ymd(windowStartForGrain(new Date(2026, 4, 3), 'day'))).toBe('2026-04-27');
  });
  it('day | last_actual=Mon Apr 27 -> Mon Apr 20 (CW18 incomplete -> CW17 latest)', () => {
    expect(ymd(windowStartForGrain(new Date(2026, 3, 27), 'day'))).toBe('2026-04-20');
  });
  it('day | last_actual=Wed Apr 22 -> Mon Apr 13 (CW17 incomplete -> CW16 latest)', () => {
    expect(ymd(windowStartForGrain(new Date(2026, 3, 22), 'day'))).toBe('2026-04-13');
  });

  // Week grain: day-anchor minus 28 days = last 5 complete weeks.
  it('week | last_actual=Sun May 3 -> Mon Mar 30 (Apr 27 - 28d)', () => {
    expect(ymd(windowStartForGrain(new Date(2026, 4, 3), 'week'))).toBe('2026-03-30');
  });
  it('week | last_actual=Mon Apr 27 -> Mon Mar 23 (Apr 20 - 28d)', () => {
    expect(ymd(windowStartForGrain(new Date(2026, 3, 27), 'week'))).toBe('2026-03-23');
  });

  // Month grain: first-of-latest-complete-month minus 3 calendar months.
  it('month | last_actual=end-of-Apr (Apr 30) -> Apr complete -> Jan 1', () => {
    expect(ymd(windowStartForGrain(new Date(2026, 3, 30), 'month'))).toBe('2026-01-01');
  });
  it('month | last_actual=mid-Apr (Apr 27) -> Apr incomplete -> Mar latest -> Dec 1 prior year', () => {
    expect(ymd(windowStartForGrain(new Date(2026, 3, 27), 'month'))).toBe('2025-12-01');
  });
  it('month | last_actual=Sun May 3 -> May incomplete -> Apr latest -> Jan 1', () => {
    expect(ymd(windowStartForGrain(new Date(2026, 4, 3), 'month'))).toBe('2026-01-01');
  });
});
