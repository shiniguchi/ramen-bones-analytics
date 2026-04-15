import { test, expect } from '@playwright/test';

// Phase 6 — FilterBar e2e coverage. Uses the existing E2E_FIXTURES bypass
// (?__e2e=charts) so the dashboard renders without Supabase credentials.
// The bypass seeds distinctSalesTypes + distinctPaymentMethods so the
// Filters button + sheet are exercisable end-to-end.
//
// URLs are preserved across navigation by goto()'s patch-and-replace, so
// ?__e2e=charts sticks throughout the flow.
test.describe('Filter bar (Phase 6)', () => {
  test('FLT-01: date picker popover opens, preset click updates URL', async ({ page }) => {
    await page.goto('/?__e2e=charts');
    await page.waitForLoadState('networkidle');

    // Trigger button carries the preset label + date line. Default = "7d".
    const trigger = page.locator('[data-slot="filter-bar"] button').first();
    await expect(trigger).toContainText('7d');
    await trigger.click();

    // Popover content is portaled to #popover-root; preset button lives there.
    await expect(page.getByRole('dialog').getByText('Select date range')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: '30d', exact: true }).click();

    await expect(page).toHaveURL(/range=30d/);
    // KPI tiles still render after navigation (fixture bypass keeps data).
    await expect(page.getByTestId('kpi-transactions')).toBeVisible();
  });

  test('FLT-01: custom from/to inputs update ?from=&to=&range=custom', async ({ page }) => {
    await page.goto('/?__e2e=charts');
    await page.waitForLoadState('networkidle');

    await page.locator('[data-slot="filter-bar"] button').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Two native <input type="date"> inside the popover.
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

    // GrainToggle renders three radio buttons inside the sticky bar.
    await page
      .locator('[data-slot="filter-bar"]')
      .getByRole('radio', { name: 'Month' })
      .click();

    await expect(page).toHaveURL(/grain=month/);
  });

  test('FLT-03: sales_type multi-select draft-and-apply via Filters sheet', async ({ page }) => {
    await page.goto('/?__e2e=charts');
    await page.waitForLoadState('networkidle');

    await page
      .locator('[data-slot="filter-bar"]')
      .getByRole('button', { name: 'Filters' })
      .click();

    const sheet = page.getByRole('dialog', { name: 'Filters' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('Sales type')).toBeVisible();

    // Untick TAKEAWAY so only INHOUSE remains — draft stage, no URL change yet.
    // Click the label wrapper (native input is sr-only, span intercepts).
    await sheet.locator('label[data-slot="checkbox"]', { hasText: 'TAKEAWAY' }).click();
    await expect(page).not.toHaveURL(/sales_type=/);

    await sheet.getByRole('button', { name: 'Apply filters' }).click();
    await expect(page).toHaveURL(/sales_type=INHOUSE/);
  });

  test('FLT-04: payment_method dropdown populated, multi-select works', async ({ page }) => {
    await page.goto('/?__e2e=charts');
    await page.waitForLoadState('networkidle');

    await page
      .locator('[data-slot="filter-bar"]')
      .getByRole('button', { name: 'Filters' })
      .click();

    const sheet = page.getByRole('dialog', { name: 'Filters' });
    await expect(sheet.getByText('Payment method')).toBeVisible();

    // Bypass seeds ['Bar', 'Visa']; both checkbox rows must exist.
    await expect(sheet.locator('label[data-slot="checkbox"]', { hasText: 'Bar' })).toBeVisible();
    await expect(sheet.locator('label[data-slot="checkbox"]', { hasText: 'Visa' })).toBeVisible();

    // Untick Bar, apply → ?payment_method=Visa.
    await sheet.locator('label[data-slot="checkbox"]', { hasText: 'Bar' }).click();
    await sheet.getByRole('button', { name: 'Apply filters' }).click();
    await expect(page).toHaveURL(/payment_method=Visa/);
  });

  test('FLT-07: malformed ?range=bogus renders page with defaults (no 400)', async ({ page }) => {
    const resp = await page.goto('/?__e2e=charts&range=bogus');
    expect(resp?.status()).toBe(200);
    await page.waitForLoadState('networkidle');

    // Trigger still shows a sane preset (defaults to 7d per zod .catch()).
    const trigger = page.locator('[data-slot="filter-bar"] button').first();
    await expect(trigger).toContainText('7d');
  });

  test('D-18: back button restores prior filter state via URL', async ({ page }) => {
    await page.goto('/?__e2e=charts&range=7d');
    await page.waitForLoadState('networkidle');

    // Navigate to 30d via popover.
    await page.locator('[data-slot="filter-bar"] button').first().click();
    await page.getByRole('dialog').getByRole('button', { name: '30d', exact: true }).click();
    await expect(page).toHaveURL(/range=30d/);

    // Back should restore range=7d.
    await page.goBack();
    await expect(page).toHaveURL(/range=7d/);
  });

  // D-13 empty-dropdown hide: fixture bypass always seeds both arrays so the
  // Filters button is never hidden in e2e. Unit test in FilterBar.test.ts
  // covers the D-13 "both empty → hide Filters button" branch directly.
  test.fixme('D-13: empty dropdown (no distinct values) hides control entirely', async ({ page }) => {
    // Covered by tests/unit/FilterBar.test.ts "hides the Filters button when
    // both distinct arrays are empty". Deferred in e2e because the fixture
    // bypass is the only credential-free path and it seeds both arrays.
    expect(page).toBeTruthy();
  });
});
