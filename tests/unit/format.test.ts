// Unit coverage for compact de-DE chart-axis formatters.
// RED→GREEN: written before formatEURShort / formatIntShort existed in src/lib/format.ts.
// Locale guard: de-DE compact output varies across Node/ICU versions — tests must be
// permissive on separators ("," vs ".") and currency suffix wording ("Mio." vs "M").
import { describe, it, expect } from 'vitest';
import { formatEURShort, formatIntShort } from '../../src/lib/format';

describe('formatEURShort', () => {
  it('renders small amounts with € symbol and no compact suffix', () => {
    const out = formatEURShort(500);
    expect(out).toMatch(/€/);
    expect(out).toMatch(/500/);
  });

  it('compacts thousands to K notation', () => {
    // de-DE may emit "€5K", "€5,0K", or "€5.0K" depending on ICU version.
    expect(formatEURShort(5000)).toMatch(/€\s?5[.,]?0?K/i);
  });

  it('compacts millions to Mio./M notation', () => {
    // de-DE compact historically renders millions as "Mio." in currency style;
    // some Node builds emit bare "M". Accept either.
    expect(formatEURShort(1_200_000)).toMatch(/€\s?1[.,]2\s?(Mio\.?|M)/i);
  });
});

describe('formatIntShort', () => {
  it('compacts thousands with decimal separator', () => {
    expect(formatIntShort(1500)).toMatch(/1[.,]5\s?K/i);
  });

  it('compacts whole thousands without trailing decimal', () => {
    expect(formatIntShort(15000)).toMatch(/15\s?K/i);
  });

  it('renders zero as a bare "0"', () => {
    expect(formatIntShort(0)).toMatch(/^0$/);
  });

  it('appends unit suffix when provided', () => {
    expect(formatIntShort(1500, 'txn')).toMatch(/1[.,]5\s?K txn$/i);
    expect(formatIntShort(0, 'cust')).toBe('0 cust');
  });

  it('omits unit when undefined (back-compat)', () => {
    expect(formatIntShort(0)).toBe('0');
  });

  it('rounds fractional tick values to integers', () => {
    // Protects against d3 picking fractional ticks like 0.2 that would
    // otherwise all render as "0 items" after compact formatting.
    expect(formatIntShort(0.2, 'items')).toBe('0 items');
    expect(formatIntShort(0.7, 'items')).toBe('1 items');
    expect(formatIntShort(2.4, 'cust')).toBe('2 cust');
  });
});

describe('integerTicks (trendline helper)', () => {
  it('returns [0, 1] for zero/negative yMax', () => {
    // imported via dynamic import to keep scope of this test file local
    return import('../../src/lib/trendline').then(({ integerTicks }) => {
      expect(integerTicks(0)).toEqual([0, 1]);
      expect(integerTicks(-3)).toEqual([0, 1]);
    });
  });

  it('returns [0..yMax] when yMax ≤ maxCount', () => {
    return import('../../src/lib/trendline').then(({ integerTicks }) => {
      expect(integerTicks(4)).toEqual([0, 1, 2, 3, 4]);
      expect(integerTicks(6)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });
  });

  it('steps evenly and always includes yMax as last tick', () => {
    return import('../../src/lib/trendline').then(({ integerTicks }) => {
      const ticks = integerTicks(25);
      expect(ticks[0]).toBe(0);
      expect(ticks[ticks.length - 1]).toBe(25);
      expect(ticks.every(Number.isInteger)).toBe(true);
    });
  });
});
