// Stub for $app/navigation used in vitest (no SvelteKit runtime).
import { vi } from 'vitest';

export const goto = vi.fn((_url: string, _opts?: Record<string, unknown>) => Promise.resolve());
export const invalidate = vi.fn();
export const preloadData = vi.fn();
export const preloadCode = vi.fn();
export const pushState = vi.fn();
export const replaceState = vi.fn();
export const afterNavigate = vi.fn();
export const beforeNavigate = vi.fn();
export const onNavigate = vi.fn();
