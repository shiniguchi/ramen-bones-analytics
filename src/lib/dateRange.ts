// Chip → date-window helper. One source of truth for "what 7d means".
// All windows expressed as Berlin business dates (YYYY-MM-DD strings).
// Prior window mirrors the current window immediately preceding it (D-08).
import { subDays, format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

export type Range = 'today' | '7d' | '30d' | '90d' | 'all';
export type Grain = 'day' | 'week' | 'month';

const TZ = 'Europe/Berlin';
const iso = (d: Date) => format(d, 'yyyy-MM-dd');

export interface RangeWindow {
  from: string;
  to: string;
  priorFrom: string | null;
  priorTo: string | null;
}

export function chipToRange(range: Range, now: Date = new Date()): RangeWindow {
  // Compute "today" in Berlin by projecting `now` into Berlin wall-clock.
  const today = toZonedTime(now, TZ);
  const todayStr = iso(today);

  if (range === 'all') {
    return { from: '1970-01-01', to: todayStr, priorFrom: null, priorTo: null };
  }

  const days = range === 'today' ? 1 : range === '7d' ? 7 : range === '30d' ? 30 : 90;
  // Inclusive window of `days` days ending today.
  const from = subDays(today, days - 1);
  // Prior window is the `days`-length window ending the day before `from`.
  const priorTo = subDays(from, 1);
  const priorFrom = subDays(priorTo, days - 1);

  return {
    from: iso(from),
    to: todayStr,
    priorFrom: iso(priorFrom),
    priorTo: iso(priorTo)
  };
}

// Phase 6 — user-picked date range. Input is already literal YYYY-MM-DD Berlin
// dates (from a native <input type="date">), so we do UTC-midnight arithmetic
// to mirror the prior window without re-entering toZonedTime.
export interface CustomRangeInput {
  from: string;
  to: string;
}

export function customToRange(input: CustomRangeInput): RangeWindow {
  // Swap if inverted — never throw on bad input (D-17 tolerance).
  const [lo, hi] =
    input.from <= input.to ? [input.from, input.to] : [input.to, input.from];
  const loDate = new Date(lo + 'T00:00:00Z');
  const hiDate = new Date(hi + 'T00:00:00Z');
  const days = Math.round((hiDate.getTime() - loDate.getTime()) / 86400000) + 1;
  const priorHi = new Date(loDate.getTime() - 86400000);
  const priorLo = new Date(priorHi.getTime() - (days - 1) * 86400000);
  const isoUtc = (d: Date) => d.toISOString().slice(0, 10);
  return {
    from: lo,
    to: hi,
    priorFrom: isoUtc(priorLo),
    priorTo: isoUtc(priorHi)
  };
}
