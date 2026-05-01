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
