import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseFilters,
  FILTER_DEFAULTS,
  filtersSchema,
  IS_CASH_VALUES,
  SALES_TYPE_FILTER_VALUES,
  FROM_FLOOR,
  TO_CEILING_DAYS_AHEAD
} from '../../src/lib/filters';

// Phase 9 Plan 01 — updated filter schema contract.
// is_cash replaces payment_method; sales_type is now a 3-state enum (not CSV).
// D-01: is_cash 3-state toggle (all / cash / card)
// D-03: sales_type 3-state toggle (all / INHOUSE / TAKEAWAY)

const mk = (qs = '') => new URL('http://x/' + qs);

describe('parseFilters — defaults + round-trip', () => {
  it('empty URL → defaults (range=7d, grain=week, sales_type=all, is_cash=all)', () => {
    const f = parseFilters(mk(''));
    expect(f.range).toBe('7d');
    expect(f.grain).toBe('week');
    expect(f.sales_type).toBe('all');
    expect(f.is_cash).toBe('all');
    expect(f.from).toBeUndefined();
    expect(f.to).toBeUndefined();
  });

  it('custom range with from/to passes through', () => {
    const f = parseFilters(mk('?from=2026-04-01&to=2026-04-15&range=custom'));
    expect(f.range).toBe('custom');
    expect(f.from).toBe('2026-04-01');
    expect(f.to).toBe('2026-04-15');
  });
});

describe('parseFilters — is_cash 3-state', () => {
  it('is_cash=cash returns { is_cash: "cash" }', () => {
    const f = parseFilters(mk('?is_cash=cash'));
    expect(f.is_cash).toBe('cash');
  });

  it('is_cash=card returns { is_cash: "card" }', () => {
    const f = parseFilters(mk('?is_cash=card'));
    expect(f.is_cash).toBe('card');
  });

  it('no is_cash param returns { is_cash: "all" }', () => {
    const f = parseFilters(mk(''));
    expect(f.is_cash).toBe('all');
  });

  it('invalid is_cash returns { is_cash: "all" }', () => {
    const f = parseFilters(mk('?is_cash=bogus'));
    expect(f.is_cash).toBe('all');
  });
});

describe('parseFilters — sales_type is now single enum', () => {
  it('sales_type=INHOUSE returns "INHOUSE" (not array)', () => {
    const f = parseFilters(mk('?sales_type=INHOUSE'));
    expect(f.sales_type).toBe('INHOUSE');
  });

  it('sales_type=TAKEAWAY returns "TAKEAWAY"', () => {
    const f = parseFilters(mk('?sales_type=TAKEAWAY'));
    expect(f.sales_type).toBe('TAKEAWAY');
  });

  it('sales_type=all returns "all"', () => {
    const f = parseFilters(mk('?sales_type=all'));
    expect(f.sales_type).toBe('all');
  });

  it('invalid sales_type coerces to "all"', () => {
    const f = parseFilters(mk('?sales_type=DRIVETHRU'));
    expect(f.sales_type).toBe('all');
  });
});

describe('parseFilters — payment_method removed', () => {
  it('payment_method param is ignored (field removed from schema)', () => {
    const f = parseFilters(mk('?payment_method=visa'));
    expect(f).not.toHaveProperty('payment_method');
  });
});

describe('parseFilters — D-17 coercion (malformed → default)', () => {
  it('range=bogus coerces to default 7d — never throws', () => {
    const f = parseFilters(mk('?range=bogus'));
    expect(f.range).toBe('7d');
  });

  it('grain=lightyear coerces to default week', () => {
    const f = parseFilters(mk('?grain=lightyear'));
    expect(f.grain).toBe('week');
  });

  it('from=not-a-date coerces to undefined', () => {
    const f = parseFilters(mk('?from=not-a-date'));
    expect(f.from).toBeUndefined();
  });

  it('unknown param foo=bar is ignored, no throw', () => {
    expect(() => parseFilters(mk('?foo=bar'))).not.toThrow();
    const f = parseFilters(mk('?foo=bar'));
    expect(f.range).toBe('7d');
  });

  it('SQL-injection attempt in sales_type coerces to "all"', () => {
    const f = parseFilters(mk("?sales_type=INHOUSE');DROP TABLE--"));
    expect(f.sales_type).toBe('all');
  });
});

describe('FILTER_DEFAULTS', () => {
  it('is frozen and exposes { range: 7d, grain: week, sales_type: all, is_cash: all }', () => {
    expect(FILTER_DEFAULTS.range).toBe('7d');
    expect(FILTER_DEFAULTS.grain).toBe('week');
    expect(FILTER_DEFAULTS.sales_type).toBe('all');
    expect(FILTER_DEFAULTS.is_cash).toBe('all');
    expect(Object.isFrozen(FILTER_DEFAULTS)).toBe(true);
  });

  it('filtersSchema is exported and parses empty object to defaults', () => {
    const f = filtersSchema.parse({});
    expect(f.range).toBe('7d');
    expect(f.grain).toBe('week');
    expect(f.sales_type).toBe('all');
    expect(f.is_cash).toBe('all');
  });
});

describe('exported constants', () => {
  it('IS_CASH_VALUES = [all, cash, card]', () => {
    expect(IS_CASH_VALUES).toEqual(['all', 'cash', 'card']);
  });

  it('SALES_TYPE_FILTER_VALUES = [all, INHOUSE, TAKEAWAY]', () => {
    expect(SALES_TYPE_FILTER_VALUES).toEqual(['all', 'INHOUSE', 'TAKEAWAY']);
  });

  it('FROM_FLOOR exported as "2024-01-01"', () => {
    expect(FROM_FLOOR).toBe('2024-01-01');
  });

  it('TO_CEILING_DAYS_AHEAD exported as 365', () => {
    expect(TO_CEILING_DAYS_AHEAD).toBe(365);
  });
});

// Phase 11-01 D-02: parseFilters soft-clamps pathological URL params so any
// bookmark linking to from=1970-01-01 (or a far-future to) still parses without
// blowing the SSR subrequest budget. Never rejects — only clamps + warns.
describe('parseFilters — D-02 soft-clamp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Anchor "today" to 2026-04-21 so the ceiling is 2027-04-21.
    vi.setSystemTime(new Date('2026-04-21T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('soft-clamps from<2024-01-01 to 2024-01-01', () => {
    const f = parseFilters(new URL('http://x/?range=custom&from=1970-01-01&to=2026-04-21'));
    expect(f.from).toBe('2024-01-01');
    expect(f.to).toBe('2026-04-21');
    expect(f.range).toBe('custom');
  });

  it('emits console.warn when from is clamped', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    parseFilters(new URL('http://x/?range=custom&from=1970-01-01&to=2026-04-21'));
    expect(warn).toHaveBeenCalled();
    const matched = warn.mock.calls.some((c) => /clamp/i.test(String(c[0])));
    expect(matched).toBe(true);
  });

  it('soft-clamps to>today+1year to today+1year', () => {
    const f = parseFilters(new URL('http://x/?range=custom&from=2026-01-01&to=2099-12-31'));
    expect(f.to).toBe('2027-04-21');
  });

  it('from and to both in-range pass through unchanged without warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = parseFilters(new URL('http://x/?range=custom&from=2024-06-01&to=2024-09-01'));
    expect(f.from).toBe('2024-06-01');
    expect(f.to).toBe('2024-09-01');
    expect(warn).not.toHaveBeenCalled();
  });

  it('malformed/non-ISO from passes through to zod .catch default (undefined) — do NOT clamp', () => {
    const f = parseFilters(new URL('http://x/?range=custom&from=notadate'));
    expect(f.from).toBeUndefined();
  });
});
