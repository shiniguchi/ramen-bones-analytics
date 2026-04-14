#!/usr/bin/env node
// verify-viewport.mjs — manual Playwright screenshot at 375px.
//
// Usage: node scripts/verify-viewport.mjs
// Env:   PLAYWRIGHT_BASE_URL (default: http://localhost:4173)
//
// Takes docs/screenshots/375-dashboard.png and exits non-zero if
// document.documentElement.scrollWidth > 375 (horizontal overflow detected).

import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:4173';
const SCREENSHOT_DIR = resolve(__dirname, '../docs/screenshots');
const SCREENSHOT_PATH = resolve(SCREENSHOT_DIR, '375-dashboard.png');

const VIEWPORT = { width: 375, height: 667 };

async function main() {
  console.log(`Launching Chromium at ${VIEWPORT.width}x${VIEWPORT.height}...`);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();

  console.log(`Navigating to ${BASE_URL} ...`);
  await page.goto(BASE_URL);
  await page.waitForLoadState('domcontentloaded');

  // Check horizontal overflow before screenshot
  const scrollWidth = await page.evaluate(
    () => document.documentElement.scrollWidth
  );

  // Ensure output directory exists
  await mkdir(SCREENSHOT_DIR, { recursive: true });

  await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });
  console.log(`Screenshot saved to ${SCREENSHOT_PATH}`);

  await browser.close();

  if (scrollWidth > VIEWPORT.width) {
    console.error(
      `FAIL: horizontal overflow detected — scrollWidth=${scrollWidth}px > ${VIEWPORT.width}px`
    );
    process.exit(1);
  }

  console.log(
    `PASS: no horizontal overflow (scrollWidth=${scrollWidth}px <= ${VIEWPORT.width}px)`
  );
}

main().catch(err => {
  console.error('verify-viewport failed:', err);
  process.exit(1);
});
