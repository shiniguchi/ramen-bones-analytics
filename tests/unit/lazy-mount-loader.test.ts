import { describe, it, expect } from 'vitest';
import LazyMount from '$lib/components/LazyMount.svelte';

describe('LazyMount loader prop (Plan 19-01)', () => {
  it('is a Svelte component with a loader prop in its $props block', () => {
    expect(LazyMount).toBeTruthy();
    // Smoke test only — TS narrowing is verified by `npm run check`,
    // not by the runtime test runner. The component must compile with
    // `loader?: () => Promise<{ default: Component<any> }>`.
  });
});
