---
phase: 18-weekly-counterfactual-window
plan: "03"
subsystem: api
tags: [api, sveltekit, campaign-uplift, weekly_history, tdd, backwards-compatible]
dependency_graph:
  requires:
    - 18-01 (campaign_uplift_weekly_v wrapper view in Supabase — migration 0069)
    - 18-02 (compute_iso_week_uplift_rows pipeline — iso_week rows writable)
  provides:
    - /api/campaign-uplift JSON payload includes weekly_history[] array
    - WeeklyRow type in +server.ts
  affects:
    - 18-04 (CampaignUpliftCard hero rewrite reads weekly_history[])
    - 18-05 (bar chart reads weekly_history[])
tech_stack:
  added: []
  patterns:
    - Third Promise.all branch pattern (parallel query alongside existing daily/campaigns branches)
    - iso_week_start derived via subDays(parseISO(as_of_date), 6) — date-fns, no zoneinfo
    - Backwards-compatible payload extension (new field added; no existing fields removed)
    - TDD RED/GREEN gate sequence maintained
key_files:
  modified:
    - src/routes/api/campaign-uplift/+server.ts
    - tests/unit/apiEndpoints.test.ts
decisions:
  - "WeeklyRow type mirrors DailyRow — same view shape, different window_kind in backing table"
  - "iso_week_start = subDays(parseISO(as_of_date), 6) — Mon = Sun - 6 days deterministically, no zoneinfo"
  - "Filter weekly rows to headline campaign_id (belt-and-suspenders over RLS-already-filtered result)"
  - "weekly_history placed after daily in JSON response to preserve existing field ordering"
metrics:
  duration: "~5 minutes (implementation pre-committed on feature branch)"
  completed: "2026-05-07"
  tasks_completed: 2
  files_modified: 2
---

# Phase 18 Plan 03: /api/campaign-uplift weekly_history Payload Summary

Extends `/api/campaign-uplift/+server.ts` with a 3rd `Promise.all` branch reading `campaign_uplift_weekly_v` and emitting a `weekly_history` array (sister to `daily`) on the response payload. Backwards-compatible — all existing top-level fields preserved.

## What Was Built

### Task 1 (TDD RED): weekly_history test contract

Commit `14e9550` — added the `describe('weekly_history (Phase 18 UPL-08)')` block to `tests/unit/apiEndpoints.test.ts` with 6 test cases covering:

1. Shape and content when `campaign_uplift_weekly_v` returns sarimax rows for headline campaign
2. Empty array `[]` when view has zero rows
3. Filtering to headline campaign only (other campaigns excluded)
4. Query contract: `.eq('model_name', 'sarimax')` + ascending `as_of_date` order
5. Back-compat: all prior top-level fields still present alongside new `weekly_history`
6. Empty array `[]` when no headline campaign exists (empty `campaign_uplift_v`)

### Task 2 (TDD GREEN): +server.ts implementation + branch push

Commit `250a73a` — added to `src/routes/api/campaign-uplift/+server.ts`:

- `WeeklyRow` type (mirror of `DailyRow`, adds `n_days: number`)
- 3rd fetchAll branch in Promise.all: reads `campaign_uplift_weekly_v`, `.eq('model_name', 'sarimax')`, `.order('as_of_date', { ascending: true })`
- `weekly_history` derivation block: filters by `headlineCampaignId`, maps each row through `parseISO(as_of_date)` → `subDays(sun, 6)` → `format(mon, 'yyyy-MM-dd')` to compute `iso_week_start`
- `weekly_history` field added after `daily` in `json({...})` response literal

## Test Results

```
Test Files  1 passed (1)
      Tests  58 passed (58)
   Start at  10:12:29
   Duration  1.91s
```

All 58 tests pass, including 6 new `weekly_history` tests. No existing test regressed.

## JSON Payload Shape

New top-level field (sister to `daily`):

```json
{
  "weekly_history": [
    {
      "iso_week_start": "2026-04-20",
      "iso_week_end": "2026-04-26",
      "model_name": "sarimax",
      "point_eur": 450,
      "ci_lower_eur": -100,
      "ci_upper_eur": 980,
      "n_days": 7
    }
  ]
}
```

`iso_week_start` is Monday (Sunday − 6 days). `iso_week_end` is the ISO-week's Sunday (`as_of_date` from the view). DEV table currently empty for `window_kind='iso_week'` (per prior-wave state from 18-02); API returns `weekly_history: []` gracefully until pipeline runs.

## DEV Smoke Test

Branch already pushed before this execution. The `/api/campaign-uplift` endpoint:
- Returns HTTP 200 with `weekly_history` field present (empty array until 18-02 pipeline runs on DEV)
- Auth boundary unchanged: null claims → 401 + `Cache-Control: private, no-store`
- No new TypeScript errors in modified files (pre-existing errors in `vite.config.ts`, `hooks.server.ts`, `CalendarRevenueCard.svelte` are out-of-scope pre-existing baseline)

## Deviations from Plan

None — plan executed exactly as written. Implementation was pre-committed on the feature branch prior to this execution agent run. Self-check confirmed both task commits exist and all 58 tests pass.

## TDD Gate Compliance

- RED gate: `test(18-03): RED — weekly_history /api/campaign-uplift contract (UPL-08)` — commit `14e9550`
- GREEN gate: `feat(18-03): /api/campaign-uplift returns weekly_history sister to daily (UPL-08)` — commit `250a73a`

Both gates present in git log. Sequence: RED before GREEN. Compliant.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced by this plan. The existing RLS on `campaign_uplift_weekly_v` (created in Plan 18-01, filtered by `auth.jwt()->>'restaurant_id'`) covers cross-tenant isolation. T-18-06 disposition: mitigated (plan-level RLS + in-process `campaign_id === headlineCampaignId` filter). No new threat flags.

## Self-Check: PASSED

- `src/routes/api/campaign-uplift/+server.ts` — FOUND, contains `campaign_uplift_weekly_v`, `WeeklyRow`, `weekly_history`, `iso_week_start`, `subDays`
- `tests/unit/apiEndpoints.test.ts` — FOUND, contains `campaign_uplift_weekly_v` describe block with 6 test cases
- Commit `14e9550` — FOUND (test(18-03) RED gate)
- Commit `250a73a` — FOUND (feat(18-03) GREEN gate)
- 58/58 tests pass, exit 0
