// src/lib/forecastResampling.ts
// Phase 14 C-05 / D-04: server-side resampling of daily forecast rows
// into week or month grains. Aggregation is mean(yhat_mean), mean(yhat_lower),
// mean(yhat_upper) per (model_name, bucket_start_date). horizon_days collapses
// to the smallest horizon in the bucket (the earliest-target-date row drives it).
//
// Why mean and not sum: yhat is already a per-day expected value. Summing
// would imply "weekly total" which is a different KPI; mean preserves the
// "expected daily value" semantic so the y-axis stays consistent across grains.
//
// ISO week start = Monday. date-fns startOfWeek({ weekStartsOn: 1 }).
import { startOfWeek, startOfMonth, format } from 'date-fns';
import type { Granularity } from './forecastValidation';

export type ForecastRowDaily = {
  target_date: string;       // YYYY-MM-DD
  model_name: string;
  yhat_mean: number;
  yhat_lower: number;
  yhat_upper: number;
  horizon_days: number;
};

export type ForecastRowOut = ForecastRowDaily;

export function resampleByGranularity(
  rows: readonly ForecastRowDaily[],
  granularity: Granularity
): ForecastRowOut[] {
  if (granularity === 'day') return rows.slice();

  const bucketKey = (dateStr: string): string => {
    const d = new Date(dateStr + 'T00:00:00Z');
    const start = granularity === 'week'
      ? startOfWeek(d, { weekStartsOn: 1 })
      : startOfMonth(d);
    return format(start, 'yyyy-MM-dd');
  };

  type Acc = { sumMean: number; sumLower: number; sumUpper: number; n: number; minHorizon: number };
  const buckets = new Map<string, Acc>();   // key = `${model_name}|${bucket_date}`

  for (const r of rows) {
    const key = `${r.model_name}|${bucketKey(r.target_date)}`;
    const cur = buckets.get(key);
    if (cur) {
      cur.sumMean += r.yhat_mean;
      cur.sumLower += r.yhat_lower;
      cur.sumUpper += r.yhat_upper;
      cur.n += 1;
      if (r.horizon_days < cur.minHorizon) cur.minHorizon = r.horizon_days;
    } else {
      buckets.set(key, {
        sumMean: r.yhat_mean,
        sumLower: r.yhat_lower,
        sumUpper: r.yhat_upper,
        n: 1,
        minHorizon: r.horizon_days
      });
    }
  }

  const out: ForecastRowOut[] = [];
  for (const [key, acc] of buckets) {
    const [model_name, target_date] = key.split('|');
    out.push({
      target_date,
      model_name,
      yhat_mean:  acc.sumMean  / acc.n,
      yhat_lower: acc.sumLower / acc.n,
      yhat_upper: acc.sumUpper / acc.n,
      horizon_days: acc.minHorizon
    });
  }
  return out;
}
