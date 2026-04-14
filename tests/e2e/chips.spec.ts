import { test, expect } from '@playwright/test';

// RED stub — UI-09/UI-11. Flip to test() when chip bar lands in 04-02.
test.skip('chip bar: default 7d active, tapping 30d updates ?range=30d', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '7d' })).toHaveAttribute('aria-current', 'true');
  await page.getByRole('button', { name: '30d' }).click();
  await expect(page).toHaveURL(/range=30d/);
});
