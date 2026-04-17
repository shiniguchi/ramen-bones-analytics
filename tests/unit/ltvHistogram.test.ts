// Phase 10 Plan 01 — Nyquist RED scaffold for LTV histogram bins (VA-07).
// Tests MUST fail until plan 10-04 creates src/lib/ltvBins.ts exporting
// LTV_BINS (6 bins per D-12) and binCustomerRevenue(cents).
import { describe, it, expect } from 'vitest';
import { LTV_BINS, binCustomerRevenue } from '../../src/lib/ltvBins';

describe('LTV_BINS (D-12: 6 bins)', () => {
  it('has exactly 6 bins', () => {
    expect(LTV_BINS.length).toBe(6);
  });

  it('labels match spec: €0–10, €10–25, €25–50, €50–100, €100–250, €250+', () => {
    expect(LTV_BINS.map(b => b.label)).toEqual([
      '€0–10', '€10–25', '€25–50', '€50–100', '€100–250', '€250+'
    ]);
  });
});

describe('binCustomerRevenue — boundary behavior', () => {
  it('0 cents → €0–10', () => {
    expect(binCustomerRevenue(0)).toBe('€0–10');
  });
  it('999 cents → €0–10 (just below €10 boundary)', () => {
    expect(binCustomerRevenue(999)).toBe('€0–10');
  });
  it('1000 cents → €10–25 (at €10 boundary)', () => {
    expect(binCustomerRevenue(1000)).toBe('€10–25');
  });
  it('2499 cents → €10–25 (just below €25)', () => {
    expect(binCustomerRevenue(2499)).toBe('€10–25');
  });
  it('2500 cents → €25–50 (at €25 boundary)', () => {
    expect(binCustomerRevenue(2500)).toBe('€25–50');
  });
  it('25000 cents → €250+ (at €250 boundary)', () => {
    expect(binCustomerRevenue(25000)).toBe('€250+');
  });
  it('Number.MAX_SAFE_INTEGER → €250+', () => {
    expect(binCustomerRevenue(Number.MAX_SAFE_INTEGER)).toBe('€250+');
  });
});
