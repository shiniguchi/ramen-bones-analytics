// tests/unit/forecastResampling.test.ts
// Phase 14 C-05 / D-04: server resamples daily forecast rows into week / month.
// Client never sees raw 200-path arrays — only mean + lower + upper per bucket.
//
// Resampling rule for week: bucket key = ISO Monday-start date of target_date.
// Resampling rule for month: bucket key = first-of-month date of target_date.
// Aggregation: mean of yhat_mean, mean of yhat_lower, mean of yhat_upper.
import { describe, it, expect } from 'vitest';
import { resampleByGranularity, type ForecastRowDaily, type ForecastRowOut } from '../../src/lib/forecastResampling';

const sarimaxRow = (date: string, mean: number, lower: number, upper: number): ForecastRowDaily => ({
  target_date: date, model_name: 'sarimax',
  yhat_mean: mean, yhat_lower: lower, yhat_upper: upper, horizon_days: 1
});

describe('resampleByGranularity', () => {
  it('day passthrough — returns input rows unchanged', () => {
    const rows = [sarimaxRow('2026-05-04', 100, 90, 110), sarimaxRow('2026-05-05', 200, 180, 220)];
    expect(resampleByGranularity(rows, 'day')).toEqual(rows);
  });

  it('week bucket — Mon 2026-05-04 + Tue 2026-05-05 collapse to one row keyed 2026-05-04', () => {
    const rows = [sarimaxRow('2026-05-04', 100, 90, 110), sarimaxRow('2026-05-05', 200, 180, 220)];
    const out = resampleByGranularity(rows, 'week');
    expect(out.length).toBe(1);
    expect(out[0].target_date).toBe('2026-05-04');
    expect(out[0].yhat_mean).toBeCloseTo(150, 6);
    expect(out[0].yhat_lower).toBeCloseTo(135, 6);
    expect(out[0].yhat_upper).toBeCloseTo(165, 6);
  });

  it('month bucket — 2026-05-15 + 2026-05-31 + 2026-06-01 yield two rows keyed 2026-05-01 and 2026-06-01', () => {
    const rows = [
      sarimaxRow('2026-05-15', 100, 90, 110),
      sarimaxRow('2026-05-31', 200, 180, 220),
      sarimaxRow('2026-06-01', 300, 270, 330)
    ];
    const out = resampleByGranularity(rows, 'month');
    expect(out.map(r => r.target_date).sort()).toEqual(['2026-05-01', '2026-06-01']);
    const may = out.find(r => r.target_date === '2026-05-01')!;
    const jun = out.find(r => r.target_date === '2026-06-01')!;
    expect(may.yhat_mean).toBeCloseTo(150, 6);
    expect(jun.yhat_mean).toBeCloseTo(300, 6);
  });

  it('preserves model_name during resampling — buckets per (model, period)', () => {
    const rows: ForecastRowDaily[] = [
      sarimaxRow('2026-05-04', 100, 90, 110),
      { target_date: '2026-05-04', model_name: 'prophet', yhat_mean: 80, yhat_lower: 70, yhat_upper: 90, horizon_days: 1 }
    ];
    const out = resampleByGranularity(rows, 'week');
    expect(out.length).toBe(2);
    const models = out.map(r => r.model_name).sort();
    expect(models).toEqual(['prophet', 'sarimax']);
  });

  it('week bucket on a Sunday rolls back to the prior Monday (ISO week start)', () => {
    const rows = [sarimaxRow('2026-05-10', 100, 90, 110)]; // 2026-05-10 is a Sunday
    const out = resampleByGranularity(rows, 'week');
    expect(out[0].target_date).toBe('2026-05-04'); // ISO Monday of 2026-W19
  });

  it('horizon_days on resampled rows is the smallest horizon in the bucket', () => {
    const rows = [
      sarimaxRow('2026-05-04', 100, 90, 110),  // horizon_days: 1
      { ...sarimaxRow('2026-05-05', 200, 180, 220), horizon_days: 2 }
    ];
    const out = resampleByGranularity(rows, 'week');
    expect(out[0].horizon_days).toBe(1);
  });
});
