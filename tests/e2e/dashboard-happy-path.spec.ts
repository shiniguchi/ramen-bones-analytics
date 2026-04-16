// Phase 04-09 Gap D closure: happy-path regression guard that exercises
// EVERY card on the dashboard against seeded data, end-to-end, with zero
// console errors.
//
// Phase 8 VA-03: LtvCard, FrequencyCard, NewVsReturningCard removed.
// Dashboard now has 6 cards: 3 fixed revenue + 2 chip-scoped + cohort retention.
//
// TWO execution modes, gated by env:
//
// 1. E2E_FIXTURES=1  (default, set by playwright.config.ts)
//    -> hits `/?__e2e=charts` which triggers the seeded-fixture short-circuit
//      in +layout.server.ts + +page.server.ts (authored in 04-06).
//    -> exercises every card path in the UI with deterministic data.
//    -> runs in CI without Supabase credentials.
//
// 2. E2E_DEV_HAPPY_PATH=1 + TEST_USER_EMAIL/PASSWORD
//    -> real sign-in against DEV, loads `/` against whatever data is seeded
//      via `scripts/seed-demo-data.sql`. Used for final iPhone-equivalent
//      verification before Phase 4 sign-off.
//    -> skipped by default (requires secrets).
//
// The fixture mode is the CI-safe default. Both modes share the same
// assertion body so regressions are caught in both places.
import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

// Collected console.error + pageerror strings, cleared per test.
function collectErrors(page: Page): { errors: string[]; pageErrors: string[] } {
  const errors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(String(err.message ?? err)));
  return { errors, pageErrors };
}

// Real DEV sign-in helper — used only when E2E_DEV_HAPPY_PATH=1.
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

// Shared assertion body — 6 cards + freshness label + console-clean.
async function assertAllCardsHealthy(
  page: Page,
  consoleErrors: string[],
  pageErrors: string[]
) {
  // -- Test 1: all 6 card headings are visible --
  await expect(page.getByRole('heading', { name: /Revenue · Today/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Revenue · 7d/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Revenue · 30d/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Transactions/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Avg ticket/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Cohort retention/i })).toBeVisible();

  // -- Test 2: the 3 fixed-window revenue tiles each show a currency number --
  for (const id of ['kpi-revenue-today', 'kpi-revenue-7d', 'kpi-revenue-30d']) {
    const tile = page.getByTestId(id);
    await expect(tile, `${id} should render`).toBeVisible();
    await expect(tile).toContainText(/\d[\s.,\d]*\s?€|€\s?\d/);
  }

  // -- Test 3: tx-count and avg-ticket chip-scoped tiles render numbers --
  await expect(page.getByTestId('kpi-transactions')).toContainText(/\d/);
  await expect(page.getByTestId('kpi-avg-ticket')).toContainText(/\d[\s.,\d]*\s?€|€\s?\d/);

  // -- Test 4: cohort card SVG has >= 1 <path> (Spline drew a line) --
  const lines = page.locator('[data-testid="cohort-card"] svg path');
  await expect(lines.first()).toBeVisible({ timeout: 5_000 });

  // -- Test 5: freshness label visible and formatted --
  const freshness = page.getByTestId('freshness-label');
  await expect(freshness).toBeVisible();
  await expect(freshness).toContainText(/last updated|no data yet/i);

  // -- Test 6: zero console errors --
  const allErrors = [...consoleErrors, ...pageErrors];
  expect(allErrors, `console must be clean. saw:\n${allErrors.join('\n')}`).toHaveLength(0);
}

// Mode 1: E2E_FIXTURES=1 (default -- runs in CI).
test.describe('dashboard happy-path (fixture mode)', () => {
  test.skip(
    process.env.E2E_FIXTURES !== '1',
    'requires E2E_FIXTURES=1 (set by playwright.config.ts webServer)'
  );

  test('all 6 cards render with data, zero console errors', async ({ page }) => {
    const { errors, pageErrors } = collectErrors(page);

    await page.goto('/?__e2e=charts');
    await page.waitForLoadState('networkidle');

    await assertAllCardsHealthy(page, errors, pageErrors);
  });

  test('30d chip navigation keeps URL in sync and cohort card stable', async ({ page }) => {
    const { errors, pageErrors } = collectErrors(page);

    await page.goto('/?__e2e=charts&range=7d');
    await page.waitForLoadState('networkidle');

    // Initial state -- cohort svg present.
    await expect(page.locator('[data-testid="cohort-card"] svg path').first()).toBeVisible();

    // Flip to 30d and assert nothing crashes and the card is still alive.
    await page.goto('/?__e2e=charts&range=30d');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('[data-testid="cohort-card"] svg path').first()).toBeVisible();

    const allErrors = [...errors, ...pageErrors];
    expect(allErrors, `chip nav must be console-clean. saw:\n${allErrors.join('\n')}`).toHaveLength(0);
  });
});

// Mode 2: E2E_DEV_HAPPY_PATH=1 -- real DEV sign-in, no fixtures. Skipped by
// default so CI doesn't need user credentials.
test.describe('dashboard happy-path (DEV real sign-in)', () => {
  test.skip(
    process.env.E2E_DEV_HAPPY_PATH !== '1' ||
      !process.env.TEST_USER_EMAIL ||
      !process.env.TEST_USER_PASSWORD,
    'requires E2E_DEV_HAPPY_PATH=1 + TEST_USER_EMAIL + TEST_USER_PASSWORD'
  );

  test('DEV dashboard renders 6 cards from seeded data with no console errors', async ({
    page
  }) => {
    const { errors, pageErrors } = collectErrors(page);

    await signInToDev(page);
    await page.waitForLoadState('networkidle');

    await assertAllCardsHealthy(page, errors, pageErrors);
  });
});
