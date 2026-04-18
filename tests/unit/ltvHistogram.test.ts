// Pass 3 (quick-260418-3ec) rewrite — dynamic €5 LTV bins replace the 6 hardcoded ones.
// Bin contract: right-exclusive [minCents, maxCents); labels use U+2013 en-dash.
// Auto-scales to max revenue up to a €250 cap; overflow bin '€250+' appended only
// when data exceeds the cap.
import { describe, it, expect } from 'vitest';
import {
  buildLtvBins,
  binCustomerRevenue,
  LTV_BIN_STEP_CENTS,
  LTV_BIN_MAX_CENTS_CAP
} from '../../src/lib/ltvBins';

describe('buildLtvBins (Pass 3 — dynamic €5 bins)', () => {
  it('constants: step=500 (€5), cap=25000 (€250)', () => {
    expect(LTV_BIN_STEP_CENTS).toBe(500);
    expect(LTV_BIN_MAX_CENTS_CAP).toBe(25000);
  });

  it('maxRevenueCents=0 → single €0–5 bin (minimum render)', () => {
    const bins = buildLtvBins(0);
    expect(bins).toHaveLength(1);
    expect(bins[0]).toEqual({ label: '€0\u20135', minCents: 0, maxCents: 500 });
  });

  it('maxRevenueCents negative → same as 0 (length 1)', () => {
    const bins = buildLtvBins(-5);
    expect(bins).toHaveLength(1);
  });

  it('maxRevenueCents=8000 → 16 bins, first €0–5, last €75–80, no overflow', () => {
    const bins = buildLtvBins(8000);
    expect(bins).toHaveLength(16);
    expect(bins[0].label).toBe('€0\u20135');
    expect(bins[bins.length - 1].label).toBe('€75\u201380');
  });

  it('maxRevenueCents=25000 → 50 bins, last €245–250, no overflow (not > cap)', () => {
    const bins = buildLtvBins(25000);
    expect(bins).toHaveLength(50);
    expect(bins[0].label).toBe('€0\u20135');
    expect(bins[bins.length - 1].label).toBe('€245\u2013250');
    expect(bins[bins.length - 1].label).not.toContain('+');
  });

  it('maxRevenueCents=30000 → 51 bins (50 step bins + overflow €250+)', () => {
    const bins = buildLtvBins(30000);
    expect(bins).toHaveLength(51);
    expect(bins[bins.length - 2].label).toBe('€245\u2013250');
    expect(bins[bins.length - 1].label).toBe('€250+');
  });

  it('labels use en-dash U+2013 (not hyphen-minus)', () => {
    const bins = buildLtvBins(8000);
    // Every non-overflow label must contain the en-dash.
    for (const b of bins) {
      if (b.label !== '€250+') {
        expect(b.label.includes('\u2013')).toBe(true);
        // Must NOT contain ASCII hyphen-minus (0x2D).
        expect(b.label.includes('-')).toBe(false);
      }
    }
  });
});

describe('binCustomerRevenue (Pass 3 — right-exclusive boundaries)', () => {
  it('0 cents → €0–5', () => {
    expect(binCustomerRevenue(0, buildLtvBins(8000))).toBe('€0\u20135');
  });

  it('499 cents → €0–5 (just below €5)', () => {
    expect(binCustomerRevenue(499, buildLtvBins(8000))).toBe('€0\u20135');
  });

  it('500 cents → €5–10 (at €5 boundary, right-exclusive)', () => {
    expect(binCustomerRevenue(500, buildLtvBins(8000))).toBe('€5\u201310');
  });

  it('7999 cents → €75–80 (last bin of 8000-scoped histogram)', () => {
    expect(binCustomerRevenue(7999, buildLtvBins(8000))).toBe('€75\u201380');
  });

  it('25000 cents with overflow bins → €250+', () => {
    expect(binCustomerRevenue(25000, buildLtvBins(30000))).toBe('€250+');
  });

  it('extremely large revenue → €250+ (overflow guard)', () => {
    expect(binCustomerRevenue(99999999, buildLtvBins(30000))).toBe('€250+');
  });
});
