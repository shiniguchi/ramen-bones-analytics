// tests/unit/forecastConfig.test.ts
// Phase 15 D-08 — hard-coded campaign-start. Phase 16 replaces this constant
// with a campaign_calendar lookup. The test pins the date so any drift fails CI.
import { describe, it, expect } from 'vitest';
import { CAMPAIGN_START } from '../../src/lib/forecastConfig';

describe('forecastConfig', () => {
  it('CAMPAIGN_START is 2026-04-14 (Phase 15 D-08 stub for friend-owner spring campaign)', () => {
    expect(CAMPAIGN_START.toISOString().slice(0, 10)).toBe('2026-04-14');
  });

  it('CAMPAIGN_START is a Date instance (not a string), so date-fns helpers can consume it directly', () => {
    expect(CAMPAIGN_START).toBeInstanceOf(Date);
  });
});
