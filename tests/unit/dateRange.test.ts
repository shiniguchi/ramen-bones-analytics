import { describe, it, expect } from 'vitest';
import { chipToRange, customToRange } from '../../src/lib/dateRange';
import { FROM_FLOOR } from '../../src/lib/filters';

// Anchor "now" to a fixed instant in Berlin (UTC+2 during DST April 14).
// 2026-04-14T12:00:00Z = 2026-04-14 14:00 Berlin → business_date 2026-04-14.
const NOW = new Date('2026-04-14T12:00:00Z');

describe('chipToRange', () => {
  it('7d: to = today, from = today-6d, prior = the preceding 7d', () => {
    const r = chipToRange('7d', NOW);
    expect(r.to).toBe('2026-04-14');
    expect(r.from).toBe('2026-04-08');
    expect(r.priorTo).toBe('2026-04-07');
    expect(r.priorFrom).toBe('2026-04-01');
  });

  it('today: single-day window, prior = yesterday', () => {
    const r = chipToRange('today', NOW);
    expect(r.from).toBe('2026-04-14');
    expect(r.to).toBe('2026-04-14');
    expect(r.priorFrom).toBe('2026-04-13');
    expect(r.priorTo).toBe('2026-04-13');
  });

  it('30d: 30-day window with 30-day prior', () => {
    const r = chipToRange('30d', NOW);
    expect(r.to).toBe('2026-04-14');
    expect(r.from).toBe('2026-03-16');
    expect(r.priorTo).toBe('2026-03-15');
    expect(r.priorFrom).toBe('2026-02-14');
  });

  it('all: honors injected allStart option, no prior window', () => {
    const r = chipToRange('all', NOW, { allStart: '2024-07-01' });
    expect(r.from).toBe('2024-07-01');
    expect(r.to).toBe('2026-04-14');
    expect(r.priorFrom).toBeNull();
    expect(r.priorTo).toBeNull();
  });

  // Phase 11-01 D-01: signature default must be FROM_FLOOR so any future caller
  // that forgets to pass allStart still gets a bounded window — never 1970.
  it('all: defaults to FROM_FLOOR (2024-01-01) when allStart omitted', () => {
    const r = chipToRange('all', NOW);
    expect(r.from).toBe('2024-01-01');
    expect(r.to).toBe('2026-04-14');
    expect(r.priorFrom).toBeNull();
    expect(r.priorTo).toBeNull();
  });

  // Single-source-of-truth invariant: dateRange's signature default must equal
  // the FROM_FLOOR constant exported by filters.ts.
  it('all: signature default equals FROM_FLOOR from filters.ts', () => {
    const r = chipToRange('all', NOW);
    expect(r.from).toBe(FROM_FLOOR);
  });

  // Explicit allStart wins over the signature default — this is how the SSR
  // path injects the tenant's true earliest business_date; FROM_FLOOR is only
  // a last-resort fallback.
  it('all: honors explicit allStart even if earlier than FROM_FLOOR', () => {
    const r = chipToRange('all', NOW, { allStart: '2020-01-01' });
    expect(r.from).toBe('2020-01-01');
  });

  // We don't gate on future dates; MIN(business_date) on the SSR side cannot
  // return a future value, so the caller's explicit value passes through.
  it('all: ignores allStart when later than today (passes through)', () => {
    const r = chipToRange('all', NOW, { allStart: '2099-01-01' });
    expect(r.from).toBe('2099-01-01');
  });
});

// Phase 6 Plan 01 — customToRange: mirrors chipToRange's prior-window math for
// user-picked windows. Literal ISO strings in, literal ISO strings out (no TZ shift).
describe('customToRange', () => {
  it('7-day window: prior mirrors exactly', () => {
    const r = customToRange({ from: '2026-04-08', to: '2026-04-14' });
    expect(r.from).toBe('2026-04-08');
    expect(r.to).toBe('2026-04-14');
    expect(r.priorFrom).toBe('2026-04-01');
    expect(r.priorTo).toBe('2026-04-07');
  });

  it('single day: prior is yesterday', () => {
    const r = customToRange({ from: '2026-04-15', to: '2026-04-15' });
    expect(r.from).toBe('2026-04-15');
    expect(r.to).toBe('2026-04-15');
    expect(r.priorFrom).toBe('2026-04-14');
    expect(r.priorTo).toBe('2026-04-14');
  });

  it('inverted input (to < from) swaps instead of throwing (D-17 tolerance)', () => {
    const r = customToRange({ from: '2026-04-15', to: '2026-04-08' });
    expect(r.from).toBe('2026-04-08');
    expect(r.to).toBe('2026-04-15');
    // 8-day window (Apr 8..15 inclusive) → 8-day prior (Mar 31..Apr 7)
    expect(r.priorFrom).toBe('2026-03-31');
    expect(r.priorTo).toBe('2026-04-07');
  });

  it('Berlin-TZ stable: literal ISO strings round-trip unchanged', () => {
    const r = customToRange({ from: '2026-04-08', to: '2026-04-14' });
    expect(r.from).toBe('2026-04-08');
    expect(r.to).toBe('2026-04-14');
  });
});
