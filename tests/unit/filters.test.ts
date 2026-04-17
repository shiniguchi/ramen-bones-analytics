import { describe, it, expect } from 'vitest';
import { parseFilters, FILTER_DEFAULTS, filtersSchema, IS_CASH_VALUES, SALES_TYPE_FILTER_VALUES } from '../../src/lib/filters';

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
});
