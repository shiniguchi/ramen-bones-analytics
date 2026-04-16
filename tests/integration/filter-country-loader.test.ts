import { describe, it, expect, vi } from 'vitest';

// Phase 7 FLT-05 SSR: +page.server.ts translates filters.country into the
// correct Supabase query constraint on transactions_filterable_v. Wave 0
// RED scaffold — skipped until 07-04 wires the WHERE-clause composition.
//
// TODO(07-04): unskip when +page.server.ts handles filters.country.

type ChainStub = {
  eq: ReturnType<typeof vi.fn>;
  or: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
};

function makeChain(): ChainStub {
  const chain: any = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.or = vi.fn(() => chain);
  chain.is = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  return chain as ChainStub;
}

// Reference to the not-yet-implemented helper that applies the country filter.
// Named stub — when 07-04 lands a helper like `applyCountryFilter(q, filters)`
// in +page.server.ts (or an extracted util), this import flips to the real one.
async function applyCountryFilter(_q: any, _country: string[] | undefined) {
  const mod: any = await import('../../src/routes/+page.server');
  // Not yet exported — intentional failure until 07-04.
  return mod._applyCountryFilter(_q, _country);
}

describe('filters.country → Supabase WHERE clause (FLT-05)', () => {
  it('country=[__de_only__] → .eq(wl_issuing_country, DE)', async () => {
    const q = makeChain();
    await applyCountryFilter(q, ['__de_only__']);
    expect(q.eq).toHaveBeenCalledWith('wl_issuing_country', 'DE');
  });

  it('country=[__non_de_only__] → .or(null OR neq DE)', async () => {
    const q = makeChain();
    await applyCountryFilter(q, ['__non_de_only__']);
    expect(q.or).toHaveBeenCalledWith(
      'wl_issuing_country.is.null,wl_issuing_country.neq.DE',
    );
  });

  it('country=[__unknown__] → .is(wl_issuing_country, null)', async () => {
    const q = makeChain();
    await applyCountryFilter(q, ['__unknown__']);
    expect(q.is).toHaveBeenCalledWith('wl_issuing_country', null);
  });

  it('country=[DE,AT] → .in(wl_issuing_country, [DE, AT])', async () => {
    const q = makeChain();
    await applyCountryFilter(q, ['DE', 'AT']);
    expect(q.in).toHaveBeenCalledWith('wl_issuing_country', ['DE', 'AT']);
  });

  it('country=[__unknown__,DE] → .or(null OR in.(DE))', async () => {
    const q = makeChain();
    await applyCountryFilter(q, ['__unknown__', 'DE']);
    expect(q.or).toHaveBeenCalledWith(
      'wl_issuing_country.is.null,wl_issuing_country.in.(DE)',
    );
  });

  it('country=undefined → no WHERE clause added', async () => {
    const q = makeChain();
    await applyCountryFilter(q, undefined);
    expect(q.eq).not.toHaveBeenCalled();
    expect(q.or).not.toHaveBeenCalled();
    expect(q.is).not.toHaveBeenCalled();
    expect(q.in).not.toHaveBeenCalled();
  });
});
