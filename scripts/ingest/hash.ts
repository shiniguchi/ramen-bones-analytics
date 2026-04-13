// Phase 02 ING-04 / D-07: card hashing with per-tenant salt.
// Hash is sha256(wl + restaurant_id) so the same physical card produces a
// different hash across restaurants (no cross-tenant correlation).
// Null/empty input returns null (cash rows, D-08).

import { createHash } from 'node:crypto';

export function hashCard(
  wl: string | null | undefined,
  restaurantId: string,
): string | null {
  if (!wl || wl.trim() === '') return null;
  return createHash('sha256').update(wl + restaurantId).digest('hex');
}
