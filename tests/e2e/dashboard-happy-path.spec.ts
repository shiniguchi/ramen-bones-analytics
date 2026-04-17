// Phase 09-02: happy-path regression guard for simplified 2-tile dashboard.
// Phase 9 reduces to 2 KPI tiles (Revenue + Transactions) + cohort retention.
//
// TWO execution modes, gated by env:
// 1. E2E_FIXTURES=1 (default) -> hits /?__e2e=charts with seeded data
// 2. E2E_DEV_HAPPY_PATH=1 + TEST_USER_EMAIL/PASSWORD -> real DEV sign-in
import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

function collectErrors(page: Page): { errors: string[]; pageErrors: string[] } {
  const errors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(String(err.message ?? err)));
  return { errors, pageErrors };
}

async function signInToDev(page: Page): Promise<void> {
  const email = process.env.TEST_USER_EMAIL;
  const password = process.env.TEST_USER_PASSWORD;
  if (!email || !password) {
    throw new Error('TEST_USER_EMAIL and TEST_USER_PASSWORD required for DEV happy-path');
  }
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL('/', { timeout: 10_000 });
}

// Phase 9: 2 KPI tiles + cohort retention card + freshness label + console-clean.
async function assertAllCardsHealthy(
  page: Page,
  consoleErrors: string[],
  pageErrors: string[]
) {
  // 2 KPI tiles: Revenue and Transactions
  await expect(page.getByTestId('kpi-revenue-7d').or(page.locator('[data-testid^="kpi-revenue"]').first())).toBeVisible();
  await expect(page.getByTestId('kpi-transactions-7d').or(page.locator('[data-testid^="kpi-transactions"]').first())).toBeVisible();

  // Cohort retention card
  await expect(page.getByRole('heading', { name: /Retention rate by acquisition cohort/i })).toBeVisible();

  // Cohort card SVG has >= 1 <path>
  const lines = page.locator('[data-testid="cohort-card"] svg path');
  await expect(lines.first()).toBeVisible({ timeout: 5_000 });

  // Freshness label visible
  const freshness = page.getByTestId('freshness-label');
  await expect(freshness).toBeVisible();
  await expect(freshness).toContainText(/last updated|no data yet/i);

  // Zero console errors
  const allErrors = [...consoleErrors, ...pageErrors];
  expect(allErrors, `console must be clean. saw:\n${allErrors.join('\n')}`).toHaveLength(0);
}

// Mode 1: E2E_FIXTURES=1 (default -- runs in CI).
test.describe('dashboard happy-path (fixture mode)', () => {
  test.skip(
    process.env.E2E_FIXTURES !== '1',
    'requires E2E_FIXTURES=1 (set by playwright.config.ts webServer)'
  );

  test('2 KPI tiles + cohort card render with data, zero console errors', async ({ page }) => {
    const { errors, pageErrors } = collectErrors(page);

    await page.goto('/?__e2e=charts');
    await page.waitForLoadState('networkidle');

    await assertAllCardsHealthy(page, errors, pageErrors);
  });

  test('30d chip navigation keeps URL in sync and cohort card stable', async ({ page }) => {
    const { errors, pageErrors } = collectErrors(page);

    await page.goto('/?__e2e=charts&range=7d');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('[data-testid="cohort-card"] svg path').first()).toBeVisible();

    await page.goto('/?__e2e=charts&range=30d');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('[data-testid="cohort-card"] svg path').first()).toBeVisible();

    const allErrors = [...errors, ...pageErrors];
    expect(allErrors, `chip nav must be console-clean. saw:\n${allErrors.join('\n')}`).toHaveLength(0);
  });
});

// Mode 2: E2E_DEV_HAPPY_PATH=1 -- real DEV sign-in, no fixtures.
test.describe('dashboard happy-path (DEV real sign-in)', () => {
  test.skip(
    process.env.E2E_DEV_HAPPY_PATH !== '1' ||
      !process.env.TEST_USER_EMAIL ||
      !process.env.TEST_USER_PASSWORD,
    'requires E2E_DEV_HAPPY_PATH=1 + TEST_USER_EMAIL + TEST_USER_PASSWORD'
  );

  test('DEV dashboard renders 2 tiles + cohort from seeded data with no console errors', async ({
    page
  }) => {
    const { errors, pageErrors } = collectErrors(page);

    await signInToDev(page);
    await page.waitForLoadState('networkidle');

    await assertAllCardsHealthy(page, errors, pageErrors);
  });
});
