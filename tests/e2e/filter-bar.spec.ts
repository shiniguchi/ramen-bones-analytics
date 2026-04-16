import { test, expect } from '@playwright/test';

// Phase 9 — FilterBar e2e coverage. Uses E2E_FIXTURES bypass (?__e2e=charts).
// Phase 9 simplification: no FilterSheet, no multi-selects. Sales type + cash/card
// are inline SegmentedToggles. GrainToggle moved from CohortRetentionCard to FilterBar.
// All controls use replaceState (no SSR round-trip).
test.describe('Filter bar (Phase 9)', () => {
  test('FLT-01: date picker popover opens, preset click updates URL', async ({ page }) => {
    await page.goto('/?__e2e=charts');
    await page.waitForLoadState('networkidle');

    const trigger = page.locator('[data-slot="filter-bar"] button').first();
    await expect(trigger).toContainText('7d');
    await trigger.click();

    await expect(page.getByRole('dialog').getByText('Select date range')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: '30d', exact: true }).click();

    await expect(page).toHaveURL(/range=30d/);
  });

  test('FLT-01: custom from/to inputs update ?from=&to=&range=custom', async ({ page }) => {
    await page.goto('/?__e2e=charts');
    await page.waitForLoadState('networkidle');

    await page.locator('[data-slot="filter-bar"] button').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const dateInputs = dialog.locator('input[type="date"]');
    await dateInputs.nth(0).fill('2026-04-01');
    await dateInputs.nth(1).fill('2026-04-10');
    await dialog.getByRole('button', { name: 'Apply range' }).click();

    await expect(page).toHaveURL(/range=custom/);
    await expect(page).toHaveURL(/from=2026-04-01/);
    await expect(page).toHaveURL(/to=2026-04-10/);
  });

  test('FLT-02: grain toggle inline on sticky bar drives ?grain= param', async ({ page }) => {
    await page.goto('/?__e2e=charts');
    await page.waitForLoadState('networkidle');

    await page
      .locator('[data-slot="filter-bar"]')
      .getByRole('radio', { name: 'Month' })
      .click();

    await expect(page).toHaveURL(/grain=month/);
  });

  test('FLT-07: malformed ?range=bogus renders page with defaults (no 400)', async ({ page }) => {
    const resp = await page.goto('/?__e2e=charts&range=bogus');
    expect(resp?.status()).toBe(200);
    await page.waitForLoadState('networkidle');

    const trigger = page.locator('[data-slot="filter-bar"] button').first();
    await expect(trigger).toContainText('7d');
  });

  test('sales type toggle updates ?sales_type= via replaceState', async ({ page }) => {
    await page.goto('/?__e2e=charts');
    await page.waitForLoadState('networkidle');

    // Click 'Inhouse' in the Sales type toggle
    const salesToggle = page.locator('[data-slot="filter-bar"]')
      .getByRole('group', { name: 'Sales type' });
    await salesToggle.getByRole('radio', { name: 'Inhouse' }).click();

    await expect(page).toHaveURL(/sales_type=INHOUSE/);
  });

  test('cash/card toggle updates ?is_cash= via replaceState', async ({ page }) => {
    await page.goto('/?__e2e=charts');
    await page.waitForLoadState('networkidle');

    const cashToggle = page.locator('[data-slot="filter-bar"]')
      .getByRole('group', { name: 'Payment type' });
    await cashToggle.getByRole('radio', { name: 'Card' }).click();

    await expect(page).toHaveURL(/is_cash=card/);
  });
});
