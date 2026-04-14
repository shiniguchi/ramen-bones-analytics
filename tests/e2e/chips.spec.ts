import { test, expect } from '@playwright/test';

// UI-09/UI-11. Chip bar: default 7d active, tapping 30d updates ?range=30d.
// Skipped automatically when the root route redirects to /login (no test creds
// provisioned in CI). Auth-gated dashboard verification lives in 04-VALIDATION
// manual steps until 04-05.
test('chip bar: default 7d active, tapping 30d updates ?range=30d', async ({ page }) => {
  const resp = await page.goto('/');
  if (resp && new URL(resp.url()).pathname.startsWith('/login')) {
    test.skip(true, 'No test credentials — dashboard reachable only after login; see 04-VALIDATION');
    return;
  }
  await expect(page.getByRole('button', { name: '7d' })).toHaveAttribute('aria-current', 'true');
  await page.getByRole('button', { name: '30d' }).click();
  await expect(page).toHaveURL(/range=30d/);
});
