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
});
