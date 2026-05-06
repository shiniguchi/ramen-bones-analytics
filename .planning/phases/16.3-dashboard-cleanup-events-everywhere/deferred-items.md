# Phase 16.3 — Deferred Items

Surface for out-of-scope discoveries during plan execution.

---

## From Plan 16.3-01 (2026-05-06)

### tests/e2e/forecast-event-markers.spec.ts — verifies deleted forecast cards

**Found during:** 16.3-01 Task 3 grep cross-check.
**Status:** Out of scope for 16.3-01.
**Why deferred:** The spec is gated behind `E2E_DEV_HAPPY_PATH=1 + TEST_USER_EMAIL + TEST_USER_PASSWORD` env vars and is `test.skip()`-d when those aren't set (default in CI and local). It compiles fine because it only mentions `RevenueForecastCard` / `InvoiceCountForecastCard` in comments — no imports of the deleted Svelte modules. So it does NOT block `npm run check` or `npm run build`.
**Recommended action (Wave 3 plan):** Delete or rewrite this spec when Plan 16.3-08 (Wave 3 mobile QA) consolidates persona-acceptance E2E tests. The campaign-marker visual is being replaced by the new `EventBadgeStrip` overlay across all date-axis charts (Wave 2).

### Pre-existing svelte-check errors

**Found during:** `npm run check` after deletions.
**Status:** Out of scope.
**Errors NOT introduced by this plan:**
- `vite.config.ts:7:3` — `'test' does not exist in type 'UserConfigExport'` (vitest type union shadowing)
- `src/hooks.server.ts:23,24,38` — implicit-any cookies parameters + JwtPayload `claims` access
- `src/lib/components/CalendarRevenueCard.svelte:195:28` — `'w' is possibly 'undefined'`
**Recommended action:** Address in a future maintenance plan; they pre-date 16.3 (file mtimes confirm — most are May 1 / May 6 from earlier phases).

## From Plan 16.3-05 (2026-05-06)

### tests/unit/sparseFilter.test.ts — stale expectation against MAX_COHORT_LINES

**Found during:** 16.3-05 Task 1 full-suite regression run after `+server.ts` edit.
**Status:** Out of scope for 16.3-05 (pre-existing; unrelated to /api/forecast).
**Symptom:** 2 failing assertions in `tests/unit/sparseFilter.test.ts`:
- `expected 100 to be 12` — `MAX_COHORT_LINES === 12` constant test
- `expected 20 to be 100` — `pickVisibleCohorts respects MAX_COHORT_LINES` slice test
**Why pre-existing:** `src/lib/sparseFilter.ts:13` was raised to `MAX_COHORT_LINES = 100` in commit `36b2232` ("fix(quick-260418-ret): unlimit retention cohort lines"). The unit-test file still encodes the old `12` value. Verified by stashing my edit and re-running — same 2 failures.
**Recommended action:** A docs-only / test-only sweep plan to update `tests/unit/sparseFilter.test.ts` to match the current `MAX_COHORT_LINES = 100` value (or to assert the constant matches the source by import). Could fold into 16.3-08 (Wave 3 QA) or a separate quick fix.

### Comment-only references in 6 source files

**Found during:** `grep -rln` cross-check.
**Status:** Out of scope.
**Files with comment-only mentions of `RevenueForecastCard` / `InvoiceCountForecastCard` / `ForecastHoverPopup`:**
- `src/lib/chartPalettes.ts:42` (Phase 15 D-10 doc)
- `src/lib/components/EventMarker.svelte:5` (Phase 15-08 host pattern note — file is itself slated for deletion in 16.3-07)
- `src/lib/components/CampaignUpliftCard.svelte:9` (placement narrative)
- `src/lib/components/ForecastLegend.svelte:15` (host pattern note)
- `src/routes/api/campaign-uplift/+server.ts:7` (back-compat note)
- `src/routes/api/forecast-quality/+server.ts:3` (deferred-endpoint header)
**Recommended action:** Drop these comment references in 16.3-07 (palette migration) and a final docs-only sweep plan if they still drift after Wave 2 lands. Out of scope for the deletion-only Wave 1.
