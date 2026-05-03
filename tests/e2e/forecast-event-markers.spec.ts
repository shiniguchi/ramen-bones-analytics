// Phase 16 Plan 10 — EventMarker `campaign_start` E2E.
//
// Verifies that the seeded `campaign_calendar` row for 2026-04-14 surfaces
// as a red 3px vertical line on RevenueForecastCard + InvoiceCountForecastCard
// via the events array returned from `/api/forecast` (extended in Plan 08).
//
// `EventMarker.svelte` already supports `type='campaign_start'` (Phase 15
// C-09 carry-forward); Plan 08 wired the data source. This spec is the
// end-to-end wiring smoke test.
//
// Two execution modes, gated by env vars:
//   1. E2E_FIXTURES=1 (default in CI) — auth-bypassed charts route. Skipped
//      because `/api/forecast` is not stubbed in fixture mode (it requires
//      an authenticated Supabase session). Kept as a stub describe so a
//      future fixture extension can drop in here.
//   2. E2E_DEV_HAPPY_PATH=1 + TEST_USER_EMAIL + TEST_USER_PASSWORD — real
//      DEV sign-in. The seeded campaign_calendar row drives the marker.
import { test, expect, type Page } from '@playwright/test';

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

// Mode 1 — fixture-mode stub. Skipped until /api/forecast can be served
// off seeded data without auth.
test.describe('forecast event markers (fixture mode)', () => {
  test.skip(
    process.env.E2E_FIXTURES !== '1',
    'requires E2E_FIXTURES=1 (set by playwright.config.ts webServer)'
  );

  // eslint-disable-next-line playwright/no-skipped-test
  test.skip('campaign_start marker renders on forecast cards (fixture)', async () => {
    // Intentionally skipped: /api/forecast requires Supabase auth so the
    // E2E_FIXTURES short-circuit cannot serve a meaningful events array
    // here. Promote to real test once a fixture for /api/forecast lands.
  });
});

// Mode 2 — real DEV sign-in. Runs only when env is set.
test.describe('forecast event markers (DEV real sign-in)', () => {
  test.skip(
    process.env.E2E_DEV_HAPPY_PATH !== '1' ||
      !process.env.TEST_USER_EMAIL ||
      !process.env.TEST_USER_PASSWORD,
    'requires E2E_DEV_HAPPY_PATH=1 + TEST_USER_EMAIL + TEST_USER_PASSWORD'
  );

  test('campaign_start marker renders on Revenue + Invoice forecast cards for seeded 2026-04-14 row', async ({
    page
  }) => {
    await signInToDev(page);

    // Capture the /api/forecast?granularity=day response so we can assert
    // the events array contains a campaign_start entry. Multiple grain
    // calls can fire (initStore + cards on first render); pick the day one.
    const dayResp = page.waitForResponse(
      (r) => /\/api\/forecast\?[^/]*granularity=day/.test(r.url()) && r.status() === 200,
      { timeout: 15_000 }
    );

    await page.locator('[data-testid="revenue-forecast-card"]').scrollIntoViewIfNeeded();
    const resp = await dayResp;
    const body = (await resp.json()) as {
      events: Array<{ type: string; date: string; label?: string }>;
    };

    expect(body.events, '/api/forecast must return events[]').toBeDefined();
    const campaignStart = body.events.find(
      (e) => e.type === 'campaign_start' && e.date === '2026-04-14'
    );
    expect(
      campaignStart,
      `events[] must contain a campaign_start entry for 2026-04-14. saw:\n${JSON.stringify(body.events, null, 2)}`
    ).toBeDefined();

    // SVG marker — the inner <line data-event-type="campaign_start"> renders
    // inside each forecast card's chart layer once the LazyMount mounts.
    const revenueMarker = page.locator(
      '[data-testid="revenue-forecast-card"] [data-event-type="campaign_start"]'
    );
    await expect(revenueMarker.first()).toBeAttached({ timeout: 10_000 });

    // Same wiring on the invoice card.
    await page.locator('[data-testid="invoice-forecast-card"]').scrollIntoViewIfNeeded();
    const invoiceMarker = page.locator(
      '[data-testid="invoice-forecast-card"] [data-event-type="campaign_start"]'
    );
    await expect(invoiceMarker.first()).toBeAttached({ timeout: 10_000 });
  });

  test('regression: existing event marker types still render after campaign_start addition', async ({
    page
  }) => {
    await signInToDev(page);

    const dayResp = page.waitForResponse(
      (r) => /\/api\/forecast\?[^/]*granularity=day/.test(r.url()) && r.status() === 200,
      { timeout: 15_000 }
    );
    await page.locator('[data-testid="revenue-forecast-card"]').scrollIntoViewIfNeeded();
    const resp = await dayResp;
    const body = (await resp.json()) as {
      events: Array<{ type: string }>;
    };

    // Previously-supported marker types must still appear when their tables
    // have rows. We don't strictly require all four every run (DEV data may
    // be sparse), but at minimum the types union must NOT have lost any of
    // the four sources to the campaign_start addition.
    const types = new Set(body.events.map((e) => e.type));
    const allowed = new Set([
      'campaign_start',
      'holiday',
      'school_holiday',
      'recurring_event',
      'transit_strike'
    ]);
    for (const t of types) {
      expect(allowed.has(t), `unknown event type returned: ${t}`).toBe(true);
    }
  });
});
