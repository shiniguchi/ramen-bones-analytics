// Phase 10 Plan 01 — Nyquist RED scaffold for chart palettes (D-06, D-07, D-15).
// Tests MUST fail until plan 10-04 creates src/lib/chartPalettes.ts exporting
// VISIT_SEQ_COLORS (8 shades), CASH_COLOR (#a1a1aa zinc-400),
// ITEM_COLORS (8 from schemeTableau10), and OTHER_COLOR (= CASH_COLOR).
import { describe, it, expect } from 'vitest';
import {
  VISIT_SEQ_COLORS,
  CASH_COLOR,
  ITEM_COLORS,
  OTHER_COLOR
} from '../../src/lib/chartPalettes';

describe('chartPalettes', () => {
  it('VISIT_SEQ_COLORS has 8 distinct sequential shades (D-06)', () => {
    expect(VISIT_SEQ_COLORS.length).toBe(8);
    expect(new Set(VISIT_SEQ_COLORS).size).toBe(8);
  });

  it('CASH_COLOR is #a1a1aa (D-07 zinc-400 neutral gray)', () => {
    expect(CASH_COLOR).toBe('#a1a1aa');
  });

  it('ITEM_COLORS has 8 colors from schemeTableau10 (D-15)', () => {
    expect(ITEM_COLORS.length).toBe(8);
    expect(new Set(ITEM_COLORS).size).toBe(8);
  });

  it('OTHER_COLOR equals CASH_COLOR (consistent neutral for "Other" rollup)', () => {
    expect(OTHER_COLOR).toBe(CASH_COLOR);
  });
});
