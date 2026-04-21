# Phase 11-02 — Deferred Items

Discoveries out-of-scope for 11-02 that were logged and not fixed, per the
executor scope-boundary rule.

---

## D-1 (pre-existing) — CI Guard 1 false-positive on `cohortAgg.ts` comments

- **Where:** `src/lib/cohortAgg.ts` lines 65, 72, 74
- **What:** Lines are COMMENTS referencing materialized view names
  (`cohort_mv`, `customer_ltv_mv`) as documentation of what client-side logic
  mirrors. Guard 1's regex `\b[a-z_]+_mv\b` flags these.
- **Confirmed pre-existing:** `git stash && bash scripts/ci-guards.sh` on the
  pre-11-02 working tree emits the same failure.
- **Not fixed here because:** 11-02's scope is deferring 4 SSR queries. Touching
  unrelated comments in cohortAgg.ts would expand the blast radius. The grep
  also doesn't enforce an actual safety invariant on comments.
- **Suggested future fix:** either strip the `_mv` substring from the comments
  (rewrite to reference the `_v` wrapper), or tighten Guard 1 to match only
  code tokens (not comment lines).

---

## D-2 (pre-existing) — Unrelated unit-test failures

Same set documented in `11-01-SUMMARY.md` line 112-122. Running
`npm test --run` (full suite) shows 9 pre-existing failures unrelated to 11-02:

- `CalendarCards.test.ts` (4 tests) — blocked by the user's uncommitted local
  changes in `CalendarRevenueCard.svelte` / `CalendarCountsCard.svelte` (these
  are plan-protected files per the 11-02 frontmatter).
- `CohortRetentionCard.test.ts` (1 test) — unrelated weekly-clamp hint drift.
- `ci-guards.test.ts` (1 test) — same D-1 as above (root cause).
- `sparseFilter.test.ts` (2 tests) — unrelated `MAX_COHORT_LINES` drift.
- `pageServerLoader.test.ts > does NOT query kpi_daily_v` (1 test) — will be
  RESOLVED by 11-02 Task 3 (this plan removes kpi_daily_v from SSR).

**Not fixed here because:** all of these fail on both sides of the plan
(verified by `git stash` baseline in 11-01). Fixing them is either blocked by
user-uncommitted work (protected files) or would expand 11-02's blast radius.
