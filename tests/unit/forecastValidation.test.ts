// tests/unit/forecastValidation.test.ts
// Phase 15 D-11 — validate ?horizon= + ?granularity= against the clamp matrix:
//   7d  → day
//   5w  → day | week
//   4mo → week | month
//   1yr → month
import { describe, it, expect } from 'vitest';
import {
  parseHorizon,
  parseGranularity,
  isValidCombo,
  type Horizon,
  type Granularity,
  HORIZON_DAYS
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

describe('isValidCombo (D-11 clamp matrix)', () => {
  const valid: Array<[Horizon, Granularity]> = [
    [7, 'day'],
    [35, 'day'], [35, 'week'],
    [120, 'week'], [120, 'month'],
    [365, 'month']
  ];
  const invalid: Array<[Horizon, Granularity]> = [
    [7, 'week'], [7, 'month'],
    [35, 'month'],
    [120, 'day'],
    [365, 'day'], [365, 'week']
  ];
  it.each(valid)('accepts horizon=%i granularity=%s', (h, g) => {
    expect(isValidCombo(h, g)).toBe(true);
  });
  it.each(invalid)('rejects horizon=%i granularity=%s', (h, g) => {
    expect(isValidCombo(h, g)).toBe(false);
  });
});

describe('HORIZON_DAYS constants', () => {
  it('exposes 7/35/120/365 (FUI-03)', () => {
    expect(HORIZON_DAYS).toEqual([7, 35, 120, 365]);
  });
});
