---
status: resolved
phase: 16-its-uplift-attribution
source: [16-VERIFICATION.md]
started: "2026-05-04T07:30:00.000Z"
updated: "2026-05-04T08:00:00.000Z"
---

## Current Test

[all tests passed via Chrome MCP localhost verification 2026-05-04T08:00 UTC]

## Tests

### 1. CampaignUpliftCard renders at 375×667 on DEV preview
expected: Hero shows "Cumulative uplift: −€1,008" OR "CI overlaps zero — no detectable lift" (95% CI straddles zero per cutoff_sensitivity.md, expect the latter); 280×100 sparkline + low-opacity CI band visible; tap-to-pin tooltip shows day-N + CI range; 11px anticipation-buffer note at the bottom; no console errors.
result: PASS (verified on localhost:5173 via Chrome MCP, viewport 390×800; payload via /api/campaign-uplift returned campaign_start='2026-04-14' + 14-day daily[] array)
evidence:
  - Subtitle: "Did the Apr 14, 2026 campaign work?"
  - Hero copy: "CI overlaps zero — no detectable lift" (exact ROADMAP SC#5 string)
  - Point estimate with full CI: "−€565 (95% CI −€3,745 ... +€2,298)" — never single-point without CI
  - Sparkline rendered with low-opacity CI band + dark cumulative-uplift line
  - "Naive baseline disagrees — review the methodology." secondary line (sarimax vs naive_dow divergence flag)
  - Anticipation-buffer note: "Counterfactual fits on data ≥7 days before the campaign start (anticipation buffer)."
  - Tooltip-on-hover: showed "Apr 22 / Day 8 / −€710 / 95% CI −€2,984 ... +€2,173" — day-N + per-day cumulative uplift + 95% CI bounds
  - No console errors / warnings during render or interaction
why_human: Localhost-first IntersectionObserver under Chrome MCP headless tab is unreliable per Plan 09's documented finding. Verified via the visible-browser claude-in-chrome MCP at 390×800 viewport — IntersectionObserver fired correctly when the slot scrolled into view, LazyMount mounted, /api/campaign-uplift fetched the friend campaign payload, headline + sparkline + tooltip all rendered.

### 2. EventMarker red 3px campaign-start line overlays RevenueForecastCard + InvoiceCountForecastCard at 2026-04-14 on DEV
expected: Red vertical line at the 2026-04-14 x-coordinate visible on both forecast cards' chart layers; clamped to overlap rules from forecastEventClamp.ts (campaign_start has priority 5, top of stack).
result: PASS (verified on localhost:5173 via Chrome MCP)
evidence:
  - RevenueForecastCard ("Revenue forecast" / 売上の予測): solid red 3px vertical line at x-coordinate matching 2026-04-14 (between Apr 1 axis tick and the visible end of pre-campaign data); clamped above the dotted Phase 14 launch and quarterly markers per priority 5 stacking.
  - InvoiceCountForecastCard (取引件数の予測): same solid red 3px vertical line at the same x-coordinate, identical priority/clamping behavior — confirms shared EventMarker component rendering both KPI charts consistently.
  - No console errors / warnings during forecast chart render.
why_human: Same Chrome-MCP IntersectionObserver gate as test 1 — both forecast cards are LazyMount-wrapped and need the IO callback to mount. Verified via visible-browser claude-in-chrome MCP. Playwright spec at tests/e2e/forecast-event-markers.spec.ts confirms the same render under headless DEV happy-path mode.

## Summary

total: 2
passed: 2
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps
