import 'dotenv/config';
import { beforeAll } from 'vitest';

// LayerChart / @layerstack imports window.matchMedia at module init time.
// JSDOM doesn't provide it; mock it early so jsdom-environment tests don't throw.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false
    })
  });
}

// LayerCake (layerchart dependency) uses ResizeObserver.
// JSDOM doesn't provide it; stub it so component renders don't crash.
if (typeof globalThis !== 'undefined' && typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Pitfall D (CONTEXT D-16): never run the test suite against the DEV Supabase
// project. If TEST_SUPABASE_URL is missing or matches DEV_SUPABASE_URL, abort.
beforeAll(() => {
  const testUrl = process.env.TEST_SUPABASE_URL;
  const devUrl = process.env.DEV_SUPABASE_URL;
  if (!testUrl) {
    // Tests that actually hit Supabase will fail on client construction;
    // unit-only runs can proceed without env vars.
    return;
  }
  if (devUrl && testUrl === devUrl) {
    throw new Error('Refusing to run tests against DEV project');
  }
});
