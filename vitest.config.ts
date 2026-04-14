import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  // Disable CSS processing so Vite does not walk parent directories looking
  // for a PostCSS config (a stray ~/postcss.config.js was breaking test runs).
  css: { postcss: { plugins: [] } },
  plugins: [svelte()],
  resolve: {
    // Match the `$lib` alias SvelteKit exposes so component imports work inside
    // vitest without pulling in the full SvelteKit plugin.
    alias: { $lib: new URL('./src/lib', import.meta.url).pathname },
    // Testing-library/svelte needs the browser entrypoint, not server SSR.
    conditions: ['browser']
  },
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    reporters: ['dot'],
    passWithNoTests: true
  }
});
