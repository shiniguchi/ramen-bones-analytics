// tests/unit/forecastConfig.test.ts
// Phase 16 Plan 09 retired the CAMPAIGN_START constant — the campaign date
// now comes from /api/campaign-uplift (sourced from campaign_calendar). The
// test asserts the constant has been removed; if anyone re-adds it, the
// import-named test will fail and the retirement is reversed.
import { describe, it, expect } from 'vitest';
import * as forecastConfig from '../../src/lib/forecastConfig';

describe('forecastConfig (Phase 16 retirement)', () => {
  it('CAMPAIGN_START is no longer exported (retired in Phase 16 Plan 09 / Guard 10)', () => {
    expect(
      Object.prototype.hasOwnProperty.call(forecastConfig, 'CAMPAIGN_START')
    ).toBe(false);
  });
});
