// tests/unit/forecastEmptyStates.test.ts
// Phase 15 FUI-08 — empty-state copy + i18n keys for the four forecast states.
import { describe, it, expect } from 'vitest';
import { emptyStates } from '../../src/lib/emptyStates';
import { messages } from '../../src/lib/i18n/messages';

const FORECAST_KEYS = [
  'forecast-loading',
  'forecast-quality-empty',
  'forecast-stale',
  'forecast-uncalibrated-ci'
] as const;

describe('Forecast empty-state keys (FUI-08)', () => {
  it.each(FORECAST_KEYS)('emptyStates["%s"] has heading + body keys', (k) => {
    const entry = emptyStates[k as keyof typeof emptyStates];
    expect(entry).toBeDefined();
    expect(entry.headingKey).toMatch(/^empty_forecast_/);
    expect(entry.bodyKey).toMatch(/^empty_forecast_/);
  });

  it.each(FORECAST_KEYS)('en locale has matching heading + body for "%s"', (k) => {
    const entry = emptyStates[k as keyof typeof emptyStates];
    expect(messages.en[entry.headingKey]).toBeTypeOf('string');
    expect(messages.en[entry.bodyKey]).toBeTypeOf('string');
    expect(messages.en[entry.headingKey].length).toBeGreaterThan(0);
    expect(messages.en[entry.bodyKey].length).toBeGreaterThan(0);
  });
});
