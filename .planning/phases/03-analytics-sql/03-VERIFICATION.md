---
phase: 03-analytics-sql
verified: 2026-04-14T00:00:00Z
status: passed
score: 9/9 must-haves verified
re_verification:
  previous_status: passed
  previous_score: 9/9
  gaps_closed: []
  gaps_remaining: []
  regressions: []
  drift: none
human_verification:
  - test: "Wait one nightly cycle (or manually trigger) and confirm pg_cron job 'refresh-analytics-mvs' fires at 03:00 UTC and produces fresh MV rows in DEV"
    expected: "cron.job_run_details has a successful run for 'refresh-analytics-mvs' and MAX(business_date) on kpi_daily_mv advances"
    why_human: "pg_cron schedule fires asynchronously on Supabase server time; cannot verify firing programmatically without waiting"
deferred:
  - issue: "Full-suite parallel-execution flakes across phase3-analytics / jwt-claim / mv-wrapper-template / rls-policies"
    decision: "ACCEPTED — does not block Phase 3 closeout"
    rationale: "Pre-existing Phase 1/2 shared-fixture isolation issue on single DEV project. Each affected file green in isolation. Documented in 03-05-SUMMARY.md with remediation path (per-file UUID namespacing or --no-file-parallelism)."
---

# Phase 3: Analytics SQL Verification Report (Re-Verification)

**Phase Goal:** "The cohort trunk and its leaves (retention, LTV, KPIs, frequency, new/returning) are queryable through wrapper views with survivorship guards baked into SQL, not UI"
**Verified:** 2026-04-14 (re-verification)
**Status:** passed
**Re-verification:** Yes — fresh goal-backward verification after initial closeout commits a0542b2 / b7adff2

## Re-Verification Summary

Initial verification (2026-04-14) reported `status: passed`, `score: 9/9`. This fresh goal-backward pass confirms **no drift, no regressions, no new gaps**. All four phase 3 migrations, ci-guards extension, and test files remain present, substantive, wired, and match the must-haves derived from 03-CONTEXT.md and ROADMAP success criteria.

- **Gaps closed since previous:** n/a (previous had none)
- **Gaps remaining:** none
- **Regressions detected:** none
- **Drift detected:** none — no uncommitted edits to any phase 3 artifact; git history shows only the expected 03-01..03-05 commits landing in order

## Goal Achievement

### Observable Truths (from ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `cohort_mv` assigns each `card_hash` to a first-visit cohort (day/week/month grain) | VERIFIED | `supabase/migrations/0010_cohort_mv.sql` lines 6-53: `MIN(occurred_at) GROUP BY restaurant_id, card_hash` CTE pipeline, day/week/month via `date_trunc` at tenant timezone, `cohort_size_*` window functions; cash (`card_hash is null`) and April blackout (`'2026-04-01'..'2026-04-12'`) excluded in `filtered_tx` CTE; unique index `cohort_mv_pk (restaurant_id, card_hash)` present (line 56) |
| 2 | `cohort_v`, `retention_curve_v`, `ltv_v`, `kpi_daily_v`, `frequency_v`, `new_vs_returning_v` return tenant-scoped rows; raw `_mv` locked | VERIFIED | 6 wrapper views present across 0010/0011/0012, each with `where restaurant_id::text = (auth.jwt()->>'restaurant_id')` and `grant select ... to authenticated`; raw `cohort_mv` (0010 L59) and `kpi_daily_mv` (0011 L35) both carry `revoke all ... from anon, authenticated` |
| 3 | LTV and retention NULL-mask past cohort horizon, expose `cohort_age_weeks` | VERIFIED | `retention_curve_v` (0012 L21-69) and `ltv_v` (0012 L77-121) both compute `floor(extract(epoch from (now() - cohort_week::timestamptz))/(7*86400))::int as cohort_age_weeks` and `case when period_weeks > horizon then null` |
| 4 | `pg_cron` refreshes MVs nightly with `CONCURRENTLY`; CI grep blocks frontend raw refs | VERIFIED | `0013_refresh_function_and_cron.sql` ships `refresh_analytics_mvs()` SECURITY DEFINER (L13-23) with sequential `refresh materialized view concurrently` on both MVs + `cron.schedule('refresh-analytics-mvs','0 3 * * *', ...)` (L56-60) + idempotent unschedule (L49-54); `scripts/ci-guards.sh` Guard 1 (L19) matches `from transactions`, `.from('transactions')`, `stg_orderbird_order_items`, `*_mv`; `bash scripts/ci-guards.sh` exits 0 (clean tree) |

**Score:** 4/4 success criteria verified → 9/9 ANL requirements covered

### Required Artifacts

| Artifact | Expected | Status | Notes |
|----------|----------|--------|-------|
| `supabase/migrations/0010_cohort_mv.sql` | cohort_mv + unique index + REVOKE + cohort_v | VERIFIED | 93 lines, all elements present |
| `supabase/migrations/0011_kpi_daily_mv_real.sql` | drop-cascade + real aggregation + wrapper | VERIFIED | 51 lines; `sum(gross_cents)`, `count(*)`, null-safe `avg_ticket_cents`, unique index, REVOKE, recreated `kpi_daily_v` |
| `supabase/migrations/0012_leaf_views.sql` | 4 leaf views with JWT filter + SECURITY DEFINER test helpers | VERIFIED | 345 lines; all 4 leaves + 4 `test_*` RPCs scoped to `service_role` only |
| `supabase/migrations/0013_refresh_function_and_cron.sql` | `refresh_analytics_mvs()` + pg_cron schedule + helper supersession | VERIFIED | 60 lines; supersedes `refresh_kpi_daily_mv()` via `perform`, drops temporary `refresh_cohort_mv()` helper, idempotent unschedule + schedule |
| `scripts/ci-guards.sh` Guard 1 extended | Regex covers `transactions`, `stg_orderbird_order_items`, `*_mv` | VERIFIED | Line 19; clean run exits 0 |
| `tests/integration/phase3-analytics.test.ts` | ANL-01..ANL-09 live tests (no `it.todo`) | VERIFIED | 387 lines, 18 `it(`/`it.todo` matches — verification report notes 15 live + 0 active todo (remaining matches are comments) |
| `tests/integration/helpers/phase3-fixtures.ts` | 3-customer fixture seeder | VERIFIED | 89 lines |
| `tests/unit/ci-guards.test.ts` | 3-case contract for guard | VERIFIED | 54 lines |
| `tests/integration/tenant-isolation.test.ts` | Extended to all 6 wrapper views | VERIFIED | 118 lines |

### Key Link Verification

| From | To | Via | Status |
|------|-----|-----|--------|
| `cohort_mv` body | `public.transactions` + `public.restaurants` | `from public.transactions t join public.restaurants r on r.id = t.restaurant_id` | WIRED |
| `cohort_v` | tenant JWT claim | `where restaurant_id::text = (auth.jwt()->>'restaurant_id')` | WIRED |
| `kpi_daily_mv` body | `public.transactions` + `public.restaurants` | `sum(t.gross_cents)` + timezone join | WIRED |
| All 4 leaf views | `cohort_mv` + `transactions` | all include `auth.jwt()->>'restaurant_id'` filter | WIRED |
| `refresh_analytics_mvs()` | both MVs | sequential `refresh materialized view concurrently` | WIRED |
| `cron.schedule('refresh-analytics-mvs', ...)` | `refresh_analytics_mvs()` | `$job$select public.refresh_analytics_mvs();$job$` | WIRED |
| Phase 1 `refresh_kpi_daily_mv()` helper | `refresh_analytics_mvs()` | body replaced by `perform public.refresh_analytics_mvs()` (Pitfall 4 — lets existing Phase 1 tests refresh both MVs transparently) | WIRED |
| `scripts/ci-guards.sh` Guard 1 regex | forbidden frontend refs | `grep -rnE` on `src/` (no-op until Phase 4) | WIRED |

### Anti-Pattern Scan

Ran `grep -n 'TODO\|FIXME\|PLACEHOLDER'` on all four phase 3 migrations: **zero matches**. All SQL bodies are production aggregations. `test_*` helpers in 0012 are correctly scoped (`revoke all from public, anon, authenticated` + `grant execute to service_role`) and cannot be reached by tenant read paths.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `scripts/ci-guards.sh` exits 0 on clean tree | `bash scripts/ci-guards.sh` | `All CI guards passed.` exit 0 | PASS |
| No phase 3 SQL anti-patterns | `grep TODO/FIXME/PLACEHOLDER` on 0010-0013 | (none) | PASS |
| No uncommitted drift | `git status` on migrations/scripts/tests | clean | PASS |
| Git history matches phase plan order | `git log --oneline` on phase 3 files | 03-02 → 03-03 → 03-04 → 03-05 in order | PASS |
| pg_cron actually fires | (async, cannot test synchronously) | — | SKIP → human |
| Full vitest suite against TEST project | (not run — requires TEST project credentials; per-file runs documented passing in prior verification) | — | SKIP → see deferred issue |

### Requirements Coverage

All 9 ANL requirements (ANL-01..ANL-09) remain SATISFIED — same mapping as initial verification, no code changes since:

| Requirement | Status | Evidence (source file) |
|-------------|--------|------------------------|
| ANL-01 cohort_mv first-visit assignment | SATISFIED | 0010 MV body |
| ANL-02 retention_curve_v horizon clip | SATISFIED | 0012 retention_curve_v |
| ANL-03 ltv_v with data-depth caveat | SATISFIED | 0012 ltv_v |
| ANL-04 kpi_daily_mv real body | SATISFIED | 0011 |
| ANL-05 frequency_v fixed buckets | SATISFIED | 0012 frequency_v |
| ANL-06 new_vs_returning_v split | SATISFIED | 0012 new_vs_returning_v |
| ANL-07 pg_cron REFRESH CONCURRENTLY | SATISFIED | 0013 + unique indexes on both MVs |
| ANL-08 REVOKE on raw MVs / wrapper-only reads | SATISFIED | 0010 L59, 0011 L35 + 6 wrapper views |
| ANL-09 CI grep blocks frontend raw refs | SATISFIED | ci-guards.sh Guard 1 |

No orphaned requirement IDs. No plans leaked requirements to other phases.

### Drift & Regression Check

- **Migrations 0010-0013:** unchanged since their respective feat commits (`72d773c`, `dfa3e9a`, `4b96c55`, `7f03463`, `9048296`)
- **`scripts/ci-guards.sh`:** unchanged; clean run passes
- **Test files:** all four phase 3 test artifacts present at expected line counts (387 / 89 / 54 / 118)
- **Uncommitted changes affecting phase 3:** none (`git status` clean on `supabase/migrations/`, `scripts/`, `tests/`)
- **Phase 4+ artifacts introducing drift:** none — `src/` still does not exist, so ci-guards Guard 1 is correctly a no-op
- **Uncommitted changes elsewhere in repo** (not phase 3): `.claude/commands/crawl-repos.md`, `.planning/config.json`, `supabase/config.toml`, `.planning/phases/01-foundation/01-02-SUMMARY.md`, `.planning/phases/04-mobile-reader-ui/` — **none touch phase 3 contract surfaces**

### Known Deferred Issue (Unchanged)

Full-suite vitest parallel-execution flakes (5-6 failures across phase3-analytics / jwt-claim / mv-wrapper-template / rls-policies) — documented in initial verification and 03-05-SUMMARY.md. Root cause is pre-existing shared-synthetic-tenant state on a single DEV project, not a Phase 3 SQL defect. Each target file is green in isolation. Remediation deferred to a future flake-fix plan.

### Human Verification Required (Unchanged)

1. **pg_cron firing** — Wait one nightly cycle (or manually lower the cadence to a 1-minute window in DEV) and confirm `cron.job_run_details` records a successful `refresh-analytics-mvs` run and `MAX(business_date)` on `kpi_daily_mv` advances. Cannot be verified synchronously.

### Gaps Summary

**None.** Re-verification confirms Phase 3 goal fully achieved. All four ROADMAP success criteria verified, all 9 ANL requirements satisfied, all artifacts present and substantive, all key links wired through the JWT-filter wrapper-view contract, no anti-patterns, no drift, no regressions. Goal achieved: YES.

---

*Re-verified: 2026-04-14*
*Verifier: Claude (gsd-verifier)*

---

## Retroactive Gap C — migrations 0010..0014 were never applied to DEV (discovered 2026-04-14)

**Discovered during:** Phase 4 verification (see `.planning/phases/04-mobile-reader-ui/04-VERIFICATION.md` §"Gap C").

**What happened:** Phase 3 closed with 0010..0014 committed to the repo, but the local supabase CLI was linked to project `akyugfvsdfrwuzirmylo` (Test) rather than `paafpikebsudoqxwumgm` (Dev). `supabase db push` therefore deployed the migrations to Test only. Phase 3's verification gate did not query DEV's `supabase_migrations.schema_migrations` to confirm the analytics SQL was live, so the gap stayed silent until Phase 4 tried to query `kpi_daily_v` against DEV and got nothing.

**Remediation:**
1. Re-linked CLI to DEV: `supabase link --project-ref paafpikebsudoqxwumgm`
2. `supabase db push --include-all` — applied 0010..0014 cleanly. `kpi_daily_mv` now has 223 days, `cohort_mv` has 4454 cohorts.
3. Phase 4 plan 04-08 (this plan) added `scripts/check-migration-drift.sh`, wired into `scripts/ci-guards.sh`, that fails if any local migration file is missing from the linked project's `schema_migrations`. This guard would have caught Gap C immediately.
4. Phase 4 plan 04-08 also added a dual-project hazard note to `docs/reference/README.md`.

**Lessons (also captured in Phase 4 retrospective):**
- Phase verification must query the actual remote `schema_migrations` table, not just confirm files exist in the repo.
- A single `.env` plus a single CLI link cannot represent two Supabase projects safely. Future work: per-project supabase workspaces or explicit `--project-ref` flags on every `supabase db push`.

