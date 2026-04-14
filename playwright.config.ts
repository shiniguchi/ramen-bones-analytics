import { defineConfig, devices } from '@playwright/test';

// Gap-closure 04-06 / 04-09: enable fixture bypass by default so the
// happy-path + charts-with-data specs run in CI without Supabase creds.
// Individual specs can still opt out by checking env.
if (!process.env.E2E_FIXTURES) {
  process.env.E2E_FIXTURES = '1';
}

export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:4173',
    viewport: { width: 375, height: 667 }
  },
  projects: [
    // Chromium-based mobile emulation at the 375×667 baseline. iPhone SE uses
    // webkit; swapping to Pixel 5 viewport keeps the 375-ish baseline but only
    // needs the chromium browser installed in CI / local runs.
    {
      name: 'mobile-chrome',
      use: {
        browserName: 'chromium',
        viewport: { width: 375, height: 667 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        userAgent:
          'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
      }
    }
  ],
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
    // Gap-closure 04-06: E2E_FIXTURES=1 enables the ?__e2e=charts bypass
    // in +layout.server.ts + +page.server.ts so the charts-with-data spec
    // can exercise the non-empty chart path without touching Supabase.
    // Dead code when the env var is absent.
    env: { E2E_FIXTURES: '1' }
  }
});
