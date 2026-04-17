// Client-side rollup helper for VA-08 (D-14).
// Sort rows descending by item_count, keep top N, collapse remainder into "Other".

export function rollupTopNWithOther<T extends { item_name: string; item_count: number }>(
  rows: T[],
  n: number
): Array<{ item_name: string; item_count: number }> {
  const sorted = [...rows].sort((a, b) => b.item_count - a.item_count);
  if (sorted.length <= n) {
    return sorted.map(r => ({ item_name: r.item_name, item_count: r.item_count }));
  }
  const top = sorted.slice(0, n).map(r => ({ item_name: r.item_name, item_count: r.item_count }));
  const otherCount = sorted.slice(n).reduce((sum, r) => sum + r.item_count, 0);
  return [...top, { item_name: 'Other', item_count: otherCount }];
}
