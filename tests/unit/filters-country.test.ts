import { describe, it, expect } from 'vitest';
import { parseFilters } from '../../src/lib/filters';

// Phase 7 FLT-05: the filter schema accepts a new `country` CSV field.
// Sentinel meta-values: __de_only__, __non_de_only__, __unknown__.

function urlWith(params: Record<string, string>): URL {
  const u = new URL('http://localhost/');
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u;
}

describe('parseFilters — country (FLT-05)', () => {
  it('accepts single meta-option __de_only__', () => {
    const out = parseFilters(urlWith({ country: '__de_only__' }));
    expect(out.country).toEqual(['__de_only__']);
  });

  it('accepts single meta-option __non_de_only__', () => {
    const out = parseFilters(urlWith({ country: '__non_de_only__' }));
    expect(out.country).toEqual(['__non_de_only__']);
  });

  it('accepts multi-country CSV list', () => {
    const out = parseFilters(urlWith({ country: 'DE,AT,FR' }));
    expect(out.country).toEqual(['DE', 'AT', 'FR']);
  });

  it('accepts __unknown__ mixed with specific codes', () => {
    const out = parseFilters(urlWith({ country: '__unknown__,DE' }));
    expect(out.country).toEqual(['__unknown__', 'DE']);
  });

  it('missing param → country undefined (no filter)', () => {
    const out = parseFilters(urlWith({}));
    expect(out.country).toBeUndefined();
  });

  it('empty string → country undefined (no filter)', () => {
    const out = parseFilters(urlWith({ country: '' }));
    expect(out.country).toBeUndefined();
  });
});
