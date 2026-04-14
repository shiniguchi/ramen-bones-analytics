import { describe, it, expect } from 'vitest';
import { chipToRange } from '../../src/lib/dateRange';

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

  it('all: epoch → today, no prior window', () => {
    const r = chipToRange('all', NOW);
    expect(r.from).toBe('1970-01-01');
    expect(r.to).toBe('2026-04-14');
    expect(r.priorFrom).toBeNull();
    expect(r.priorTo).toBeNull();
  });
});
