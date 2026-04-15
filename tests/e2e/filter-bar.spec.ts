import { test, expect } from '@playwright/test';

// Phase 6 — filter bar RED stubs. Every test is test.fixme() so the suite is
// "green-but-tracked". Plans 03 and 04 flip these to live `test(...)` as each
// FLT requirement ships.
test.describe('Filter bar (Phase 6)', () => {
  test.fixme('FLT-01: date picker popover opens, preset click updates URL + KPI tiles', async ({ page }) => {
    // Plan 03/04 implementation.
    expect(page).toBeTruthy();
  });

  test.fixme('FLT-01: custom from/to inputs update ?from=&to=&range=custom in URL', async ({ page }) => {
    expect(page).toBeTruthy();
  });

  test.fixme('FLT-02: grain toggle inline on sticky bar drives ?grain= param', async ({ page }) => {
    expect(page).toBeTruthy();
  });

  test.fixme('FLT-03: sales_type multi-select draft-and-apply via Filters sheet', async ({ page }) => {
    expect(page).toBeTruthy();
  });

  test.fixme('FLT-04: payment_method dropdown populated from SELECT DISTINCT, multi-select', async ({ page }) => {
    expect(page).toBeTruthy();
  });

  test.fixme('FLT-07: malformed ?range=bogus renders page with defaults (no 400)', async ({ page }) => {
    expect(page).toBeTruthy();
  });

  test.fixme('D-13: empty dropdown (no distinct values) hides control entirely', async ({ page }) => {
    expect(page).toBeTruthy();
  });

  test.fixme('D-18: back button restores prior filter state via URL', async ({ page }) => {
    expect(page).toBeTruthy();
  });
});
