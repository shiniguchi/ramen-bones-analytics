import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Disable CSS processing so Vite does not walk parent directories looking
  // for a PostCSS config (a stray ~/postcss.config.js was breaking test runs).
  css: { postcss: { plugins: [] } },
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    reporters: ['dot'],
    passWithNoTests: true
  }
});
