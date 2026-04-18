// Chart palette contract — covers D-06 (VISIT_SEQ_COLORS), D-07 (CASH_COLOR),
// and Pass 4 Item #1 (ITEM_COLORS expanded to 20 for top-20 menu items).
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

  it('ITEM_COLORS has 20 unique colors (Pass 4 Item #1 — top-20 menu items)', () => {
    expect(ITEM_COLORS.length).toBe(20);
    expect(new Set(ITEM_COLORS).size).toBe(20);
  });

  it('OTHER_COLOR equals CASH_COLOR (consistent neutral for "Other" rollup)', () => {
    expect(OTHER_COLOR).toBe(CASH_COLOR);
  });
});
