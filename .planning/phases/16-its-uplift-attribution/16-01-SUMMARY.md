---
phase: 16
plan: 01
title: campaign_calendar migration + 2026-04-14 seed
subsystem: data-layer (supabase migrations + tenant-isolation tests)
tags: [migration, rls, tenant-isolation, campaign_calendar, upl-01]
wave: 1
depends_on: []
requires: []
provides:
  - "public.campaign_calendar table (campaign_id PK + RLS + seed)"
  - "campaign_calendar RLS test cases in tenant-isolation harness"
affects:
  - "Drives EventMarker, baseline_items_v, counterfactual_fit, cumulative_uplift downstream (Plans 02-08)"
tech_stack:
  added: []
  patterns:
    - "Migration analog: supabase/migrations/0050_forecast_daily.sql (CREATE TABLE + RLS + REVOKE + JWT filter)"
    - "Wrapper-view RLS template: supabase/migrations/0010_cohort_mv.sql (auth.jwt()->>'restaurant_id' uuid cast)"
    - "Idempotent seed via subquery: supabase/migrations/0047_shop_calendar.sql (no hardcoded UUID)"
    - "Tenant-isolation test pattern: 26 wrapper-view + 7 hybrid-RLS table cases already in tests/integration/tenant-isolation.test.ts"
key_files:
  created:
    - supabase/migrations/0058_campaign_calendar.sql
  modified:
    - tests/integration/tenant-isolation.test.ts
decisions:
  - "Seed resolves restaurant_id via subquery (Phase 13 0047 pattern) — avoids hardcoded UUID literal"
  - "ON DELETE CASCADE on FK — tenant deletion cleans up campaign rows automatically (consistent with shop_calendar)"
  - "GRANT SELECT, INSERT, UPDATE, DELETE TO service_role added explicitly (mirrors 0047) so Studio writes work without bypassrls relying on default ownership"
  - "Test #1 (anon) uses tenantClient() without sign-in, matching the existing harness's anonymous-client pattern at line 102-106"
  - "Test seed uses 2099-04-14 (not 2026-04-14) to avoid colliding with the migration-seeded friend-owner row"
metrics:
  duration_minutes: 12
  completed_date: 2026-05-01
  tasks_completed: 2
  commits: 2
---

# Phase 16 Plan 01: campaign_calendar migration + 2026-04-14 seed — Summary

JWT-scoped `campaign_calendar` table created with the 2026-04-14 friend-owner Instagram campaign seeded; tenant-isolation test harness extended with 3 RLS cases proving anon-blocked / cross-tenant-blocked / own-tenant-allowed semantics.

## Tasks Completed

| # | Task | Commit | Status |
|---|------|--------|--------|
| 1 | Create migration 0058 — campaign_calendar table + RLS + seed | `03dff35` | done |
| 2 | Extend tenant-isolation integration test for campaign_calendar | `de15008` | done (Wave 0 stub-pending until DEV push) |

## Acceptance Criteria

### Task 1 — Migration

- [x] `supabase/migrations/0058_campaign_calendar.sql` exists
- [x] Contains `CREATE TABLE public.campaign_calendar`
- [x] Contains `restaurant_id uuid NOT NULL REFERENCES public.restaurants(id)` (with `ON DELETE CASCADE`)
- [x] Contains `auth.jwt()->>'restaurant_id'` (Guard 7 clean — no `tenant_id` JWT reference)
- [x] Contains `REVOKE INSERT, UPDATE, DELETE ON public.campaign_calendar FROM authenticated, anon`
- [x] Contains `GRANT SELECT ON public.campaign_calendar TO authenticated`
- [x] Contains the literal `friend-owner-2026-04-14` for the seed
- [x] Contains the literal `2026-04-14` (single allowed location per Guard 10 contract)
- [x] Contains `CHECK (end_date >= start_date)`
- [x] Contains `CREATE INDEX campaign_calendar_restaurant_start_idx`
- [x] `bash scripts/ci-guards.sh` Guards 1-4, 6-8 pass; Guard 7 clean (no `auth.jwt()->>'tenant_id'` regression)

### Task 2 — Test

- [x] `tests/integration/tenant-isolation.test.ts` contains `describe('campaign_calendar RLS'`
- [x] Exactly 3 new `it(...)` cases tagged "campaign_calendar"
- [x] Assertion queries use `tenantClient` (auth'd JWT); `service_role` (admin client) used only inside `beforeAll`/`afterAll` (count = 0 inside the new describe block)
- [x] Test #1 (anon) currently passes; tests #2-#3 are stub-pending (`PGRST205 schema cache miss`) until migration 0058 is pushed to DEV per Plan 04 finalizer — explicitly accepted per the plan's Wave 0 acceptance criteria

## Files Touched

| File | Change | Why |
|------|--------|-----|
| `supabase/migrations/0058_campaign_calendar.sql` | **NEW** | Phase 16 D-01 schema; mechanical port of 12-PROPOSAL §7 lines 867-880 with C-01 rename |
| `tests/integration/tenant-isolation.test.ts` | MODIFIED | Append `describe('campaign_calendar RLS')` block with 3 cases between `pipeline_runs lockdown` and `FCT-08 forecast` blocks (alphabetical) |

## Deviations from Plan

None — plan executed exactly as written.

One observation worth recording for downstream agents: the plan's `<verify>` for Task 2 uses `npm run test:unit -- --run tests/integration/tenant-isolation.test.ts`, but `package.json:test:unit` is hardcoded to `tests/unit` (vitest filter). The path argument is still passed through, so the command works as intended; future plans should prefer `npx vitest run tests/integration/...` directly or `npm run test:integration`.

## Verification Evidence

```
$ grep -q "auth.jwt()->>'restaurant_id'" supabase/migrations/0058_campaign_calendar.sql
$ grep -q "campaign_id text PRIMARY KEY" supabase/migrations/0058_campaign_calendar.sql
$ grep -q "REVOKE INSERT, UPDATE, DELETE ON public.campaign_calendar FROM authenticated, anon" supabase/migrations/0058_campaign_calendar.sql
$ grep -q "friend-owner-2026-04-14" supabase/migrations/0058_campaign_calendar.sql
ALL GREP CHECKS PASSED

$ bash scripts/ci-guards.sh
Guard 6 (no-dynamic-sql): clean
Guard 8 (cron-schedule): clean (7 cron entries scanned)
# Guard 5 (migration drift) reports local=0058 vs remote=0057 — expected for a
# locally-added migration; resolved when Plan 04 finalizer runs `supabase db push`.
# Guard 7 (tenant_id JWT regression) — clean, no matches.

$ npx vitest run tests/integration/tenant-isolation.test.ts -t "campaign_calendar"
✓ campaign_calendar: anon JWT returns 0 rows
✗ campaign_calendar: tenant A cannot SELECT tenant B  (PGRST205 — table not on DEV yet)
✗ campaign_calendar: tenant A SELECT only own rows    (PGRST205 — table not on DEV yet)
# Stub-pending until Plan 04 finalizer pushes 0058 to DEV — accepted per plan.
```

## Self-Check: PASSED

- [x] `supabase/migrations/0058_campaign_calendar.sql` exists on disk and is tracked by git (`03dff35`)
- [x] `tests/integration/tenant-isolation.test.ts` modification tracked by git (`de15008`)
- [x] Both commits found via `git log --oneline -5`:
  - `de15008 test(16-01): extend tenant-isolation harness with campaign_calendar RLS cases`
  - `03dff35 feat(16-01): add campaign_calendar table with RLS + 2026-04-14 seed`
- [x] No `Co-authored-by: Claude` line in either commit (project rule honored)

## Threat Mitigation

T-16-01 (RLS bypass on campaign_calendar) — **mitigated**:
- Schema-level: `restaurant_id uuid NOT NULL` + RLS policy `restaurant_id = (auth.jwt()->>'restaurant_id')::uuid`
- Role-level: `REVOKE INSERT, UPDATE, DELETE FROM authenticated, anon` (writes service_role only)
- Test-level: 3 auth'd-JWT integration tests (anon-blocked / cross-tenant-blocked / own-tenant-allowed) — full assertion runs green once 0058 is on DEV (Plan 04)

## Next

Plan 16-02 picks up baseline_items_v (depends on campaign_calendar existing). Migration 0058 lands on DEV via Plan 04 finalizer; once applied, all 3 tenant-isolation tests for campaign_calendar flip green automatically with no test changes.
