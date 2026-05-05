---
plan: 08
phase: 16
title: /api/campaign-uplift extended payload + /api/forecast events campaign_start source
status: complete
completed_at: 2026-05-03
commits:
  - c60a3f5  # Task 1 — campaign-uplift rewrite
  - c5dbbd8  # Task 2 — forecast events 5th source
  - e651182  # Task 3 — Phase 16 contract tests + T-16-04 leak check
files_modified:
  - src/routes/api/campaign-uplift/+server.ts
  - src/routes/api/forecast/+server.ts
  - tests/unit/apiEndpoints.test.ts
files_created: []
deviations:
  - field: files_created path
    plan_said: src/routes/api/campaign-uplift/+server.test.ts
    landed_at: tests/unit/apiEndpoints.test.ts (10 new test cases inside the existing /api/campaign-uplift describe block, replacing the Phase 15 block)
    why: vite.config.ts include glob is tests/unit/**/*.test.ts; a colocated +server.test.ts file would not be discovered. The four sibling /api/* endpoints (kpi-daily, customer-ltv, retention, repeater-lifetime) all live in tests/unit/apiEndpoints.test.ts — extending the consolidated file matches the established convention.
---

# Plan 08 Summary

Wave 3 entry point. Wired the new SQL surfaces from Plan 07
(`campaign_uplift_v` + `campaign_uplift_daily_v`) into the SvelteKit API
layer and seeded the Phase 16 events array with the 5th source
(`campaign_start` from `campaign_calendar`).

## What changed

### Task 1 — /api/campaign-uplift rewrite (`c60a3f5`)

- Replaced the Phase 15 `forecast_with_actual_v` query with parallel reads from
  `campaign_uplift_v` (per-window aggregates) and `campaign_uplift_daily_v`
  (per-day trajectory powering the D-11 sparkline).
- Removed the `import { CAMPAIGN_START } from '$lib/forecastConfig'` line —
  the constant retires in Plan 09.
- Response now exposes:
  - **Phase 15 back-compat** — `campaign_start`, `cumulative_deviation_eur`,
    `as_of` (sourced from the sarimax × cumulative_since_launch headline row).
  - **Phase 16 extensions** — `model`, `ci_lower_eur`, `ci_upper_eur`,
    `naive_dow_uplift_eur`, `daily[]`, `campaigns[]`.
- `daily[]` filters to headline campaign × sarimax only (D-11 sparkline shows
  the headline trajectory; per-day rows for other campaigns or models do not
  leak into this field).
- `safeGetSession` + `Cache-Control: private, no-store` preserved.

### Task 2 — /api/forecast events 5th source (`c5dbbd8`)

- Added `type CampaignRow = { campaign_id; start_date; name }`.
- Extended `Promise.all` from 6 → 7 parallel queries by adding a
  `fetchAll<CampaignRow>` against `campaign_calendar` filtered to
  `[today − 90d, eventsEnd]`.
- Extended events array from 4 → 5 spreads, mapping `campaignRows` to
  `{type:'campaign_start', date, label}`. `EventMarker.svelte`
  already supports the type (Phase 15 C-09); `clampEvents` priority 5 still
  applies.
- Updated the header comment from "7 parallel Supabase queries" → "8 parallel
  Supabase queries" to reflect Promise.all + the standalone `actualsRows`
  await; well under the CF Pages 50-subrequest cap.

### Task 3 — Phase 16 contract tests + T-16-04 leak check (`e651182`)

Replaced the Phase 15 `/api/campaign-uplift` test block (which queried
`forecast_with_actual_v`) with 10 contract tests covering the new shape:

| # | Test | Purpose |
|---|------|---------|
| 1 | extended payload shape with ci bounds + daily[] + campaigns[] | Plan 08 Task 1 acceptance |
| 2 | back-compat fields preserved (campaign_start, cumulative_deviation_eur, as_of) | C-08 contract |
| 3 | 401 without claims; supabase never touched | auth gate |
| 4 | **NEVER returns raw sample paths (T-16-04)** | structural mitigation — asserts no `yhat_samples`/`paths`/`samples` keys and no 200-element numeric array regex match |
| 5 | campaigns[] groups by campaign_id (2 campaigns × 5 models × 2 windows = 20 rows → 2 blocks of 10) | grouping logic |
| 6 | empty `campaign_uplift_v` handled gracefully — campaigns:[], cumulative_deviation_eur:0, no 500 | empty-state |
| 7 | 200 response carries Cache-Control: private, no-store | header preservation |
| 8 | daily[] filters out non-headline campaigns | D-11 sparkline scope |
| 9 | both views queried in parallel; daily query filters model_name=sarimax | parallelism + scope |
| 10 | supabase error → 500 | failure surface |

All 10 tests GREEN; 21 sibling `/api/forecast` and `/api/forecast-quality`
tests still GREEN after the 6→7 fetchAll change (`campaign_calendar` defaults
to empty array in the test mock — no breaking change).

## Verification

| Check | Command | Result |
|-------|---------|--------|
| TS errors in modified files | `npm run check` | 0 (7 pre-existing errors in vite.config.ts / hooks.server.ts / CalendarRevenueCard — none in 16-08 files) |
| Contract tests | `npm run test:unit -- tests/unit/apiEndpoints.test.ts -t "/api/campaign-uplift"` | 10 / 10 PASS |
| /api/forecast regression | `npm run test:unit -- tests/unit/apiEndpoints.test.ts -t "/api/forecast"` | 21 / 21 PASS |
| Promise.all fetchAll count | `awk … grep -c 'fetchAll<'` | 7 (was 6) ✓ |
| `yhat_samples` mention in endpoint | `grep yhat_samples src/routes/api/campaign-uplift/+server.ts` | 0 matches ✓ |
| `forecastConfig` import in endpoint | `grep "from '\$lib/forecastConfig'" src/routes/api/campaign-uplift/+server.ts` | 0 matches ✓ |

Visual verification: PARTIAL — API-only changes; no UI surface to verify
yet. Full Chrome MCP localhost + DEV QA happens at Plan 09 (CampaignUpliftCard
mounts and consumes the extended payload) and Plan 10 (EventMarker
`campaign_start` smoke test).

## Threats

- **T-16-04** (sample-path leak from `/api/campaign-uplift`) — mitigated.
  Structural: views never expose `yhat_samples`. Test 4 above asserts the
  response body contains no forbidden keys and no 200-element numeric array.

## Requirements

- **UPL-04** — covered (extended payload shape + ci bounds + naive_dow)
- **UPL-05** — covered (back-compat preservation)
- **UPL-06** — partial (events array now feeds `campaign_start`; UI overlay
  closes in Plan 09)

## Next

Plan 09 — `CampaignUpliftCard.svelte` consumer + dashboard slot + retire
`CAMPAIGN_START` constant. Plan 09's localhost + DEV Chrome MCP QA covers
the visual verification deferred from this plan.
