// Stub for $app/forms used in vitest (no SvelteKit runtime).
// `enhance` is a Svelte use:action — a no-op in the unit test environment
// since tests don't submit the form. Kept as a typed shim so TS + runtime
// both accept the import.
import { vi } from 'vitest';

type EnhanceCallback = (opts: unknown) => unknown | Promise<unknown>;

export const enhance = vi.fn(
  (_form: HTMLFormElement, _submit?: EnhanceCallback) => ({ destroy() {} })
);

export const applyAction = vi.fn();
export const deserialize = vi.fn();
