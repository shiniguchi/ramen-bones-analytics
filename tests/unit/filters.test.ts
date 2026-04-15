import { describe, it, expect } from 'vitest';
import { parseFilters, FILTER_DEFAULTS, filtersSchema } from '../../src/lib/filters';

// Phase 6 Plan 01 — zod filter schema contract (D-07, D-11, D-12, D-17, D-19, D-20).
// parseFilters(url) is the ONE place URL → FiltersState conversion lives.

const mk = (qs = '') => new URL('http://x/' + qs);

describe('parseFilters — defaults + round-trip', () => {
  it('empty URL → defaults (range=7d, grain=week), all other fields undefined', () => {
    const f = parseFilters(mk(''));
    expect(f.range).toBe('7d');
    expect(f.grain).toBe('week');
    expect(f.sales_type).toBeUndefined();
    expect(f.payment_method).toBeUndefined();
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

  it('SQL-injection attempt in sales_type collapses to undefined', () => {
    const f = parseFilters(mk("?sales_type=INHOUSE');DROP TABLE--"));
    expect(f.sales_type).toBeUndefined();
  });
});

describe('parseFilters — D-11 CSV multi-select', () => {
  it('sales_type=INHOUSE,TAKEAWAY → string[]', () => {
    const f = parseFilters(mk('?sales_type=INHOUSE,TAKEAWAY'));
    expect(f.sales_type).toEqual(['INHOUSE', 'TAKEAWAY']);
  });

  it('payment_method=visa → single-value string[]', () => {
    const f = parseFilters(mk('?payment_method=visa'));
    expect(f.payment_method).toEqual(['visa']);
  });
});

describe('FILTER_DEFAULTS', () => {
  it('is frozen and exposes { range: 7d, grain: week }', () => {
    expect(FILTER_DEFAULTS.range).toBe('7d');
    expect(FILTER_DEFAULTS.grain).toBe('week');
    expect(Object.isFrozen(FILTER_DEFAULTS)).toBe(true);
  });

  it('filtersSchema is exported and parses empty object to defaults', () => {
    const f = filtersSchema.parse({});
    expect(f.range).toBe('7d');
    expect(f.grain).toBe('week');
  });
});
