// @vitest-environment jsdom
// Phase 9 Plan 05 — mergeSearchParams helper tests.
// Fix UAT Test 9: sequential filter clicks must compose URL params, not replace.
// Root cause: `page.url` from $app/state does NOT update after replaceState.
// mergeSearchParams reads live browser URL (window.location.href) so composition works.
import { describe, it, expect, beforeEach } from 'vitest';
import { mergeSearchParams } from '../../src/lib/urlState';

describe('mergeSearchParams', () => {
  beforeEach(() => {
    // Reset URL to a known baseline before each test.
    window.history.replaceState({}, '', '/');
  });

  it('U1: sets a new param on an empty URL', () => {
    const url = mergeSearchParams({ sales_type: 'INHOUSE' });
    expect(url.searchParams.get('sales_type')).toBe('INHOUSE');
  });

  it('U2: composes with existing params (UAT Test 9 repro)', () => {
    window.history.replaceState({}, '', '/?sales_type=INHOUSE');
    const url = mergeSearchParams({ is_cash: 'cash' });
    expect(url.searchParams.get('sales_type')).toBe('INHOUSE');
    expect(url.searchParams.get('is_cash')).toBe('cash');
  });

  it('U3: set + delete mix preserves unrelated params', () => {
    window.history.replaceState({}, '', '/?range=7d&from=2026-03-01&to=2026-04-01&sales_type=INHOUSE');
    const url = mergeSearchParams({ range: '30d', from: null, to: null });
    expect(url.searchParams.get('range')).toBe('30d');
    expect(url.searchParams.has('from')).toBe(false);
    expect(url.searchParams.has('to')).toBe(false);
    expect(url.searchParams.get('sales_type')).toBe('INHOUSE');
  });

  it('U4: composition with custom range', () => {
    window.history.replaceState({}, '', '/?sales_type=INHOUSE');
    const url = mergeSearchParams({ range: 'custom', from: '2026-03-01', to: '2026-03-15' });
    expect(url.searchParams.get('range')).toBe('custom');
    expect(url.searchParams.get('from')).toBe('2026-03-01');
    expect(url.searchParams.get('to')).toBe('2026-03-15');
    expect(url.searchParams.get('sales_type')).toBe('INHOUSE');
  });

  it('U5: overwrite same key, no duplicates', () => {
    const u1 = mergeSearchParams({ sales_type: 'INHOUSE' });
    window.history.replaceState({}, '', u1.toString());
    const u2 = mergeSearchParams({ sales_type: 'TAKEAWAY' });
    expect(u2.searchParams.get('sales_type')).toBe('TAKEAWAY');
    expect(u2.searchParams.getAll('sales_type')).toHaveLength(1);
  });

  it('U6: empty updates returns current URL unchanged', () => {
    window.history.replaceState({}, '', '/?range=30d&sales_type=INHOUSE');
    const url = mergeSearchParams({});
    expect(url.searchParams.get('range')).toBe('30d');
    expect(url.searchParams.get('sales_type')).toBe('INHOUSE');
  });
});
