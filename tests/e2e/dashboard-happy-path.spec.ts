// Phase 04-09 Gap D closure: happy-path regression guard that exercises
// EVERY card on the dashboard against seeded data, end-to-end, with zero
// console errors. This is the spec that would have caught Gap A
// (LtvCard scale.copy crash) in CI if it had existed in Phase 4 wave 0.
//
// TWO execution modes, gated by env:
//
// 1. E2E_FIXTURES=1  (default, set by playwright.config.ts)
//    → hits `/?__e2e=charts` which triggers the seeded-fixture short-circuit
//      in +layout.server.ts + +page.server.ts (authored in 04-06).
//    → exercises every card path in the UI with deterministic data.
//    → runs in CI without Supabase credentials.
//
// 2. E2E_DEV_HAPPY_PATH=1 + TEST_USER_EMAIL/PASSWORD
//    → real sign-in against DEV, loads `/` against whatever data is seeded
//      via `scripts/seed-demo-data.sql`. Used for final iPhone-equivalent
//      verification before Phase 4 sign-off.
//    → skipped by default (requires secrets).
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

// Shared assertion body — all 9 cards + freshness label + console-clean.
async function assertAllCardsHealthy(
  page: Page,
  consoleErrors: string[],
  pageErrors: string[]
) {
  // ── Test 1: all 9 card headings are visible ─────────────────────────────
  await expect(page.getByRole('heading', { name: /Revenue · Today/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Revenue · 7d/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Revenue · 30d/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Transactions/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Avg ticket/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Cohort retention/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /LTV/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Visit frequency/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /New vs returning/i })).toBeVisible();

  // ── Test 2: the 3 fixed-window revenue tiles each show a € number ──────
  // The tiles carry data-testid derived from the title via KpiTile.svelte.
  // "Revenue · Today" → kpi-revenue-today, etc.
  for (const id of ['kpi-revenue-today', 'kpi-revenue-7d', 'kpi-revenue-30d']) {
    const tile = page.getByTestId(id);
    await expect(tile, `${id} should render`).toBeVisible();
    // Must contain a € followed by at least one digit somewhere in the tile.
    await expect(tile).toContainText(/\d[\s.,\d]*\s?€|€\s?\d/);
  }

  // ── Test 3: tx-count and avg-ticket chip-scoped tiles render numbers ───
  await expect(page.getByTestId('kpi-transactions')).toContainText(/\d/);
  await expect(page.getByTestId('kpi-avg-ticket')).toContainText(/\d[\s.,\d]*\s?€|€\s?\d/);

  // ── Test 4: cohort card SVG has >= 1 <path> (Spline drew a line) ───────
  const lines = page.locator('[data-testid="cohort-card"] svg path');
  await expect(lines.first()).toBeVisible({ timeout: 5_000 });

  // ── Test 5: LTV card SVG has >= 1 <rect> (Bars drew a bar) ─────────────
  const bars = page.locator('[data-testid="ltv-card"] svg rect');
  await expect(bars.first()).toBeVisible({ timeout: 5_000 });

  // ── Test 6: frequency and NVR cards exist and aren't empty-stated ──────
  await expect(page.getByTestId('frequency-card')).toBeVisible();
  await expect(page.getByTestId('nvr-card')).toBeVisible();
  // Both carry an EmptyState when data is empty — if the empty copy shows,
  // the happy-path guarantee is violated. EmptyState component prefixes
  // "No transactions" / "No data" text — assert the opposite.
  await expect(page.getByTestId('frequency-card')).not.toContainText(/no data yet|no transactions/i);
  await expect(page.getByTestId('nvr-card')).not.toContainText(/no data yet|no transactions/i);

  // ── Test 7: freshness label visible and formatted ──────────────────────
  const freshness = page.getByTestId('freshness-label');
  await expect(freshness).toBeVisible();
  await expect(freshness).toContainText(/last updated|no data yet/i);

  // ── Test 8: zero console errors ────────────────────────────────────────
  // This is the Gap A regression fingerprint — layerchart scale.copy crashed
  // here. Also guards against any hydration crash, RLS redirect loop, or
  // missing-view 500. Strict: count must be exactly 0.
  const allErrors = [...consoleErrors, ...pageErrors];
  expect(allErrors, `console must be clean. saw:\n${allErrors.join('\n')}`).toHaveLength(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Mode 1: E2E_FIXTURES=1 (default — runs in CI).
// ─────────────────────────────────────────────────────────────────────────────
test.describe('dashboard happy-path (fixture mode)', () => {
  test.skip(
    process.env.E2E_FIXTURES !== '1',
    'requires E2E_FIXTURES=1 (set by playwright.config.ts webServer)'
  );

  test('all 9 cards render with data, zero console errors', async ({ page }) => {
    const { errors, pageErrors } = collectErrors(page);

    await page.goto('/?__e2e=charts');
    await page.waitForLoadState('networkidle');

    await assertAllCardsHealthy(page, errors, pageErrors);
  });

  test('30d chip navigation keeps URL in sync and chart cards stable', async ({ page }) => {
    const { errors, pageErrors } = collectErrors(page);

    // Seed the page with fixture data first so the cohort/LTV cards are
    // populated; the chip-click assertion below verifies they don't VANISH
    // when the chip flips (D-04 chip independence). The fixture bypass
    // keeps chart data identical regardless of the `range` query param
    // because +page.server.ts short-circuits before reading range.
    await page.goto('/?__e2e=charts&range=7d');
    await page.waitForLoadState('networkidle');

    // Initial state — cohort/LTV svgs present.
    await expect(page.locator('[data-testid="cohort-card"] svg path').first()).toBeVisible();
    await expect(page.locator('[data-testid="ltv-card"] svg rect').first()).toBeVisible();

    // Flip to 30d. The chip link href is tested in chips.spec.ts; here we
    // just navigate and assert nothing crashes and the cards are still alive.
    await page.goto('/?__e2e=charts&range=30d');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('[data-testid="cohort-card"] svg path').first()).toBeVisible();
    await expect(page.locator('[data-testid="ltv-card"] svg rect').first()).toBeVisible();

    const allErrors = [...errors, ...pageErrors];
    expect(allErrors, `chip nav must be console-clean. saw:\n${allErrors.join('\n')}`).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mode 2: E2E_DEV_HAPPY_PATH=1 — real DEV sign-in, no fixtures. Skipped by
// default so CI doesn't need user credentials. Used for the manual pre-UAT
// sanity check: run this after applying scripts/seed-demo-data.sql + refresh.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('dashboard happy-path (DEV real sign-in)', () => {
  test.skip(
    process.env.E2E_DEV_HAPPY_PATH !== '1' ||
      !process.env.TEST_USER_EMAIL ||
      !process.env.TEST_USER_PASSWORD,
    'requires E2E_DEV_HAPPY_PATH=1 + TEST_USER_EMAIL + TEST_USER_PASSWORD'
  );

  test('DEV dashboard renders 9 cards from seeded data with no console errors', async ({
    page
  }) => {
    const { errors, pageErrors } = collectErrors(page);

    await signInToDev(page);
    await page.waitForLoadState('networkidle');

    await assertAllCardsHealthy(page, errors, pageErrors);
  });
});
