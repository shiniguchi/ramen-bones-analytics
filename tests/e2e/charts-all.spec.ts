// Phase 10 Plan 01 — Nyquist RED scaffold for 6 new chart cards at 375×667.
// All tests rely on the E2E_FIXTURES=1 + ?__e2e=charts SSR bypass established
// in Phase 04. New fixture data (E2E_CUSTOMER_LTV_ROWS, E2E_ITEM_COUNTS_ROWS)
// lives in src/lib/e2eChartFixtures.ts. Tests MUST fail until plan 10-08 wires
// the fixtures into +page.server.ts and plans 10-05/06/07 ship the components.
import { test, expect } from '@playwright/test';

test.describe('Phase 10 charts at 375px', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?__e2e=charts');
  });

  test('VA-04: calendar revenue card renders with stacked bars', async ({ page }) => {
    const card = page.getByTestId('calendar-revenue-card');
    await expect(card).toBeVisible();
    // ≥5 <rect> elements = at least 5 day/week bars rendered.
    const count = await card.locator('svg rect').count();
    expect(count).toBeGreaterThanOrEqual(5);
  });

  test('VA-04: no horizontal scroll at 375px', async ({ page }) => {
    const scrollW = await page.evaluate(() => document.body.scrollWidth);
    expect(scrollW).toBeLessThanOrEqual(375);
  });

  test('VA-05: calendar counts card renders', async ({ page }) => {
    await expect(page.getByTestId('calendar-counts-card')).toBeVisible();
  });

  test('VA-08: calendar items card renders', async ({ page }) => {
    await expect(page.getByTestId('calendar-items-card')).toBeVisible();
  });

  test('VA-06: cohort retention carries forward (regression)', async ({ page }) => {
    await expect(page.getByTestId('cohort-card')).toBeVisible();
  });

  test('VA-09: cohort total revenue card renders', async ({ page }) => {
    await expect(page.getByTestId('cohort-revenue-card')).toBeVisible();
  });

  test('VA-10: cohort avg LTV card renders', async ({ page }) => {
    await expect(page.getByTestId('cohort-avg-ltv-card')).toBeVisible();
  });

  test('VA-07: LTV histogram card renders', async ({ page }) => {
    await expect(page.getByTestId('ltv-histogram-card')).toBeVisible();
  });

  test('no console errors across all new charts', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.goto('/?__e2e=charts');
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });

  test('tap-reveal tooltip on VA-04', async ({ page }) => {
    const bar = page.getByTestId('calendar-revenue-card').locator('svg rect').first();
    await bar.tap();
    await expect(page.locator('[role="tooltip"], .layerchart-tooltip')).toBeVisible({ timeout: 500 });
  });

  test('card order matches D-10', async ({ page }) => {
    const order = await page.locator('[data-testid$="-card"]').evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-testid'))
    );
    // Expected relative ordering (existing + new):
    // calendar-revenue < cohort-card < ltv-histogram-card
    const revenueIdx = order.indexOf('calendar-revenue-card');
    expect(revenueIdx).toBeGreaterThan(-1);
    expect(order.indexOf('cohort-card')).toBeGreaterThan(revenueIdx);
    expect(order.indexOf('ltv-histogram-card')).toBeGreaterThan(order.indexOf('cohort-card'));
  });

  test('375px viewport: no chart overflows parent container', async ({ page }) => {
    const overflows = await page.locator('[data-testid$="-card"]').evaluateAll((cards) =>
      cards.filter((c) => c.scrollWidth > c.clientWidth).length
    );
    expect(overflows).toBe(0);
  });
});
