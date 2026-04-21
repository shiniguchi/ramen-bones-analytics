// @vitest-environment node
// Phase 11-02 Task 1: clientFetch SWR-style in-memory cache helper tests.
// Verifies cache behavior, error surfacing, and invalidation.
import { describe, it, expect, beforeEach, vi, type MockInstance } from 'vitest';
import { clientFetch, invalidateClientCache } from '../../src/lib/clientFetch';

describe('clientFetch', () => {
  let fetchSpy: MockInstance;

  beforeEach(() => {
    // Fresh cache per test — in-memory Map is module-scoped.
    invalidateClientCache();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchSpy = vi.spyOn(globalThis, 'fetch' as any);
    fetchSpy.mockClear();
  });

  it('first call hits network; second call with same URL returns cached data', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ rows: [1, 2, 3] })
    } as unknown as Response);

    const a = await clientFetch<{ rows: number[] }>('/api/foo');
    const b = await clientFetch<{ rows: number[] }>('/api/foo');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ rows: [1, 2, 3] });
    expect(b).toEqual({ rows: [1, 2, 3] });
  });

  it('invalidateClientCache(url) forces next call to re-fetch', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ rows: [1, 2, 3] })
    } as unknown as Response);

    await clientFetch<{ rows: number[] }>('/api/foo');
    await clientFetch<{ rows: number[] }>('/api/foo');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    invalidateClientCache('/api/foo');
    await clientFetch<{ rows: number[] }>('/api/foo');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('returns error with status in message on non-200 response', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ error: 'unauthorized' })
    } as unknown as Response);

    await expect(clientFetch('/api/foo')).rejects.toThrow(/401/);
  });

  it('returns parsed JSON on 200', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ rows: [1, 2, 3] })
    } as unknown as Response);

    const result = await clientFetch<{ rows: number[] }>('/api/foo');
    expect(result).toEqual({ rows: [1, 2, 3] });
  });

  it('typed generic: clientFetch<T>(url) narrows to T at compile time', async () => {
    // Compile-time type check. If this file builds, the generic works.
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => [{ id: 1, name: 'a' }]
    } as unknown as Response);

    type Row = { id: number; name: string };
    const rows = await clientFetch<Row[]>('/api/foo');
    // Narrowed: accessing .id without cast proves T inference.
    expect(rows[0].id).toBe(1);
    expect(rows[0].name).toBe('a');
  });

  it('invalidateClientCache() without argument clears all entries', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ rows: [1] })
    } as unknown as Response);

    await clientFetch('/api/a');
    await clientFetch('/api/b');
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    invalidateClientCache();
    await clientFetch('/api/a');
    await clientFetch('/api/b');
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });
});
