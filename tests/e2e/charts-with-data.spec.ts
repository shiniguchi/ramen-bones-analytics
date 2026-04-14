// Gap A regression guard (Plan 04-06). Exercises the non-empty chart code
// path for LtvCard + CohortRetentionCard under layerchart 2.x. Fixture
// injection strategy: an E2E_FIXTURES=1 env var on the preview server gates
// a ?__e2e=charts query param in +page.server.ts + +layout.server.ts that
// short-circuits both auth and Supabase queries with seeded rows. This
// avoids browser-side fetch interception entirely (SSR load runs server
// side and cannot be routed from Playwright).
import { test, expect } from '@playwright/test';
import { STUB_LTV, STUB_RETENTION } from './fixtures/charts-stub';

test.describe('charts render non-empty data under layerchart 2.x', () => {
  test.skip(
    process.env.E2E_FIXTURES !== '1',
    'set E2E_FIXTURES=1 to exercise chart-fixture bypass'
  );

  test('LtvCard + CohortRetentionCard hydrate without scale.copy crash', async ({ page }) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _fixtures = { STUB_LTV, STUB_RETENTION };

    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(String(err.message ?? err)));

    await page.goto('/?__e2e=charts');
    await page.waitForLoadState('networkidle');

    // Headings present = cards rendered the non-empty branch.
    await expect(page.getByRole('heading', { name: /cohort retention/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /ltv/i })).toBeVisible();

    // LtvCard: at least 1 <rect> inside the card svg = a Bar rendered.
    const bars = page.locator('[data-testid="ltv-card"] svg rect');
    await expect(bars.first()).toBeVisible({ timeout: 5000 });

    // CohortRetentionCard: at least 1 <path> inside the card svg = a Spline line.
    const lines = page.locator('[data-testid="cohort-card"] svg path');
    await expect(lines.first()).toBeVisible({ timeout: 5000 });

    // Direct regression guard for Gap A: layerchart 1.x xScale string preset
    // threw "TypeError: $scale.copy is not a function" on hydration. Must be
    // zero such errors under 2.x + explicit d3 scales.
    const allErrors = [...consoleErrors, ...pageErrors];
    const scaleCopyErrors = allErrors.filter((e) => /scale\.copy is not a function/i.test(e));
    expect(scaleCopyErrors, 'Gap A regression: layerchart scale.copy crash').toHaveLength(0);
  });
});
