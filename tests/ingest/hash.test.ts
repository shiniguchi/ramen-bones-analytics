import { describe, it, expect } from 'vitest';
// Plan 03 will create scripts/ingest/hash.ts. Until then, this import fails
// with "Cannot find module" — the deterministic RED signal Plan 03 must beat.
import { hashCard } from '../../scripts/ingest/hash';

const RID = '00000000-0000-0000-0000-000000000001';
const RID2 = '00000000-0000-0000-0000-000000000002';

describe('hashCard (ING-04)', () => {
  it('returns null for null wl_card_number (D-08 cash)', () => {
    expect(hashCard(null, RID)).toBeNull();
  });

  it('returns null for empty string wl_card_number', () => {
    expect(hashCard('', RID)).toBeNull();
  });

  it('returns deterministic sha256 hex for a real wl_card_number', () => {
    const h1 = hashCard('482510xxxxxxxxx0001', RID);
    const h2 = hashCard('482510xxxxxxxxx0001', RID);
    expect(h1).toEqual(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('differs across restaurant_ids for the same card (tenant salt)', () => {
    const h1 = hashCard('482510xxxxxxxxx0001', RID);
    const h2 = hashCard('482510xxxxxxxxx0001', RID2);
    expect(h1).not.toEqual(h2);
  });
});
