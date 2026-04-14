import { test, expect } from '@playwright/test';

// RED stub — UI-01/UI-02. Flip to test() when dashboard lands in 04-02.
test.skip('dashboard renders at 375px with no horizontal scroll', async ({ page }) => {
  await page.goto('/');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > 375);
  expect(overflow).toBe(false);
});
