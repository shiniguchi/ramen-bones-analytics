---
status: partial
phase: 16-its-uplift-attribution
source: [16-VERIFICATION.md]
started: "2026-05-04T07:30:00.000Z"
updated: "2026-05-04T07:30:00.000Z"
---

## Current Test

[awaiting human testing on DEV preview after PR push]

## Tests

### 1. CampaignUpliftCard renders at 375×667 on DEV preview
expected: Hero shows "Cumulative uplift: −€1,008" OR "CI overlaps zero — no detectable lift" (95% CI straddles zero per cutoff_sensitivity.md, expect the latter); 280×100 sparkline + low-opacity CI band visible; tap-to-pin tooltip shows day-N + CI range; 11px anticipation-buffer note at the bottom; no console errors.
result: [pending]
why_human: Localhost-first IntersectionObserver under Chrome MCP headless tab is unreliable — Plan 09 documented all 6 LazyMount slots stay in skeleton state. Real Supabase auth + a real interactive browser are required to drive the IO callback that mounts the card. Documented post-push gate per Plan 09 SUMMARY 'Visual verification — PARTIAL' and Plan 10 'visual: PARTIAL' notes.

### 2. EventMarker red 3px campaign-start line overlays RevenueForecastCard + InvoiceCountForecastCard at 2026-04-14 on DEV
expected: Red vertical line at the 2026-04-14 x-coordinate visible on both forecast cards' chart layers; clamped to overlap rules from forecastEventClamp.ts (campaign_start has priority 5, top of stack).
result: [pending]
why_human: Same Chrome-MCP IntersectionObserver gate as Plan 09; Plan 10 explicitly defers final visual smoke to DEV preview. The Playwright spec at tests/e2e/forecast-event-markers.spec.ts is in place but ran under DEV happy-path mode.

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
