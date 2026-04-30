// Chart palette contract — covers D-06 (VISIT_SEQ_COLORS), D-07 (CASH_COLOR),
// and Pass 4 Item #1 (ITEM_COLORS expanded to 20 for top-20 menu items).
import { describe, it, expect } from 'vitest';
import {
  VISIT_SEQ_COLORS,
  CASH_COLOR,
  ITEM_COLORS,
  OTHER_COLOR,
  FORECAST_MODEL_COLORS
} from '../../src/lib/chartPalettes';
import { schemeTableau10 } from 'd3-scale-chromatic';

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

describe('FORECAST_MODEL_COLORS (Phase 15 D-10)', () => {
  it('contains keys for the 5 BAU models + 2 feature-flagged models', () => {
    expect(Object.keys(FORECAST_MODEL_COLORS).sort()).toEqual([
      'chronos',
      'ets',
      'naive_dow',
      'neuralprophet',
      'prophet',
      'sarimax_bau',
      'theta'
    ]);
  });

  it('first 4 BAU models use schemeTableau10[0..3] in the documented order', () => {
    expect(FORECAST_MODEL_COLORS.sarimax_bau).toBe(schemeTableau10[0]);
    expect(FORECAST_MODEL_COLORS.prophet).toBe(schemeTableau10[1]);
    expect(FORECAST_MODEL_COLORS.ets).toBe(schemeTableau10[2]);
    expect(FORECAST_MODEL_COLORS.theta).toBe(schemeTableau10[3]);
  });

  it('naive_dow is the de-emphasized gray baseline (#a1a1aa, matches CASH_COLOR)', () => {
    expect(FORECAST_MODEL_COLORS.naive_dow).toBe('#a1a1aa');
  });

  it('Chronos / NeuralProphet pick up schemeTableau10[5..6] when their flags flip on', () => {
    expect(FORECAST_MODEL_COLORS.chronos).toBe(schemeTableau10[5]);
    expect(FORECAST_MODEL_COLORS.neuralprophet).toBe(schemeTableau10[6]);
  });
});
