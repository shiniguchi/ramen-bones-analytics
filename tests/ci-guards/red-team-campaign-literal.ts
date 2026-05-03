// tests/ci-guards/red-team-campaign-literal.ts
// RED-TEAM FIXTURE for Guard 10 (Phase 16 D-12 / Plan 09 retirement).
//
// This file deliberately contains the 2026-04-14 literal — the regression
// Guard 10 is meant to catch. The campaign date must come from
// /api/campaign-uplift (campaign_calendar table is the single source of
// truth); hardcoding it inside src/ breaks forkability and multi-tenant
// generalization.
//
// Guard 10 must FAIL the build when this file is included in the scan path
// (i.e., copied into src/). The fixture lives under tests/ci-guards/ so
// production CI does NOT scan it. The harness `test_guard_10.sh` copies it
// into src/lib/__guard10_redteam.ts temporarily, runs the guard, asserts
// non-zero exit + 'Guard 10 FAILED' in the output, and removes the copy.

export const REGRESSION_DATE = '2026-04-14'; // intentional — Guard 10 must catch
