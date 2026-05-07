---
phase: 18-weekly-counterfactual-window
plan: "01"
subsystem: database-schema
tags: [supabase, migrations, postgres, rls, campaign_uplift, iso_week, wrapper-view, atomic-schema-sync]
status: complete
dependency_graph:
  requires:
    - phase: 16-its-uplift-attribution
      provides: "campaign_uplift table + campaign_uplift_v + campaign_uplift_daily_v (template for sister view)"
  provides:
    - "supabase/migrations/0069_campaign_uplift_iso_week.sql — extends window_kind CHECK + creates campaign_uplift_weekly_v wrapper view"
    - "campaign_uplift.window_kind allow-list now includes 'iso_week'"
    - "public.campaign_uplift_weekly_v — tenant-scoped wrapper for per-ISO-week cumulative uplift trajectory"
  affects:
    - "Plan 18-02 (pipeline writer compute_iso_week_uplift_rows) — unblocked: can now upsert window_kind='iso_week' rows without CHECK violation"
    - "Plan 18-03 (/api/campaign-uplift weekly_history) — unblocked: can SELECT FROM campaign_uplift_weekly_v"
tech_stack:
  added: []
  patterns:
    - "DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT — additive CHECK extension pattern (matches 0064:29-32 precedent)"
    - "CREATE OR REPLACE VIEW with INNER JOIN campaign_calendar + inline auth.jwt() filter — belt-and-suspenders RLS pattern from 0064:120-143"
    - "No DISTINCT ON for iso_week rows — per-week rows unique by (campaign, model, as_of_date=Sunday) by construction"
key_files:
  created:
    - supabase/migrations/0069_campaign_uplift_iso_week.sql
    - .planning/phases/18-weekly-counterfactual-window/18-01-SUMMARY.md
  modified: []
key_decisions:
  - "Followed 0064:29-32 DROP+ADD CHECK pattern verbatim — additive allow-list extension, no data migration"
  - "campaign_uplift_weekly_v mirrors campaign_uplift_daily_v exactly except for WHERE u.window_kind = 'iso_week' — all other columns/joins/grants/auth filter preserved"
  - "Single atomic migration file (one logical unit per file) per 0064 codebase convention"
  - "COMMENT ON VIEW documents 'no DISTINCT ON' rationale to prevent future maintainers from adding it 'defensively'"
patterns_established:
  - "Sister wrapper views for campaign_uplift discriminator values: campaign_uplift_v (cumulative_since_launch) | campaign_uplift_daily_v (per_day) | campaign_uplift_weekly_v (iso_week) — same shape, swap WHERE filter only"
requirements_completed:
  - UPL-08
metrics:
  duration: "~15 min (migration write + dual push + DEV verification)"
  completed_date: "2026-05-07"
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 0
---

# Phase 18 Plan 01: Migration 0069 — campaign_uplift iso_week schema sync Summary

**Migration 0069 atomically extends `campaign_uplift.window_kind` CHECK to include `'iso_week'` and creates `public.campaign_uplift_weekly_v` (tenant-scoped sister view to `campaign_uplift_daily_v`); applied to both LOCAL and DEV Postgres before downstream Phase 18 plans run.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-07T07:30:00Z (approx)
- **Completed:** 2026-05-07T07:45:00Z (approx)
- **Tasks:** 2/2 (Task 1 = write migration, Task 2 = blocking schema-push checkpoint)
- **Files created:** 1 (migration SQL)

## Accomplishments

- Migration 0069 SQL written matching plan body verbatim modulo header-comment polish — DROP+ADD CHECK constraint section + CREATE OR REPLACE VIEW section, separated by `─────` rules
- LOCAL Supabase migration applied via `supabase db push --linked --yes` (DEV-linked project paafpikebsudoqxwumgm) — output ended `Finished supabase db push.`
- DEV Supabase migration applied via `gh workflow run migrations.yml --ref feature/phase-18-weekly-counterfactual-window` (run 25483158267 conclusion=success, 11s)
- Three DEV verification queries confirmed schema is live: CHECK constraint allow-list extended; `campaign_uplift_weekly_v` view body filters `u.window_kind = 'iso_week'`; `authenticated` role has SELECT privilege

## Task Commits

1. **Task 1: Write migration 0069** — `09d9430` (feat) — single commit covered both pre-flight verification and the SQL body
2. **Task 2: Blocking schema-push checkpoint** — no new code commit; verified by external pushes (LOCAL `supabase db push --linked` + GHA run 25483158267)

**Plan metadata commit:** _this commit_ (`docs(phase-18-01): complete plan`)

## Files Created/Modified

- `supabase/migrations/0069_campaign_uplift_iso_week.sql` — single atomic migration: DROP+ADD `campaign_uplift_window_kind_check` to include `'iso_week'` + CREATE OR REPLACE VIEW `public.campaign_uplift_weekly_v` mirroring `campaign_uplift_daily_v` shape with WHERE filter swapped to `iso_week` + GRANT SELECT TO authenticated + COMMENT ON COLUMN/VIEW

## Migration 0069 Final SQL

Two atomic sections in `supabase/migrations/0069_campaign_uplift_iso_week.sql`:

**Section 1 — CHECK constraint extension:**

```sql
ALTER TABLE public.campaign_uplift
  DROP CONSTRAINT IF EXISTS campaign_uplift_window_kind_check;
ALTER TABLE public.campaign_uplift
  ADD CONSTRAINT campaign_uplift_window_kind_check
  CHECK (window_kind IN ('campaign_window', 'cumulative_since_launch', 'per_day', 'iso_week'));
```

Plus `COMMENT ON COLUMN public.campaign_uplift.window_kind` documenting Phase 16 vs Phase 18 values and the bootstrap-CI re-fit-on-7-day-slice contract.

**Section 2 — wrapper view:**

```sql
CREATE OR REPLACE VIEW public.campaign_uplift_weekly_v AS
SELECT
  u.restaurant_id, u.campaign_id,
  cc.start_date AS campaign_start, cc.end_date AS campaign_end,
  cc.name AS campaign_name, cc.channel AS campaign_channel,
  u.model_name, u.cumulative_uplift_eur, u.ci_lower_eur, u.ci_upper_eur,
  u.n_days, u.as_of_date, u.computed_at
FROM public.campaign_uplift u
INNER JOIN public.campaign_calendar cc
  ON cc.restaurant_id = u.restaurant_id
  AND cc.campaign_id = u.campaign_id
WHERE u.window_kind = 'iso_week'
  AND u.restaurant_id = (auth.jwt()->>'restaurant_id')::uuid;

GRANT SELECT ON public.campaign_uplift_weekly_v TO authenticated;
```

Plus `COMMENT ON VIEW` documenting "no DISTINCT ON because iso_week rows are unique by (campaign, model, as_of_date=Sunday) by construction."

## Schema-Push Results

### LOCAL Supabase (`supabase db push --linked --yes`)

Output ended with `Finished supabase db push.` Migration 0069 applied to the linked DEV project (paafpikebsudoqxwumgm) — no errors, no rollback. Equivalent to running on local + DEV simultaneously since this project's "linked" target IS DEV.

### DEV Supabase (GHA `migrations.yml`)

```bash
gh workflow run migrations.yml --ref feature/phase-18-weekly-counterfactual-window
```

Run **25483158267** completed `success` in 11s on the feature branch. This is the canonical DEV-migration path per `.claude/memory/feedback_migrations_workflow_dispatch.md` ("DEV /api/* 500 right after migration phase = migration not on DEV"). Run from feature ref before downstream plans is what eliminates that trap.

## DEV Verification (3 SQL queries via supabase-dev)

1. **CHECK constraint extended:**
   ```sql
   SELECT pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conname = 'campaign_uplift_window_kind_check';
   ```
   Result:
   ```
   CHECK ((window_kind = ANY (ARRAY['campaign_window'::text,
                                    'cumulative_since_launch'::text,
                                    'per_day'::text,
                                    'iso_week'::text])))
   ```
   PASS — `'iso_week'` present in allow-list, prior 3 values preserved.

2. **View body filters `iso_week`:**
   ```sql
   SELECT pg_get_viewdef('public.campaign_uplift_weekly_v'::regclass);
   ```
   Result: `SELECT u.restaurant_id, u.campaign_id, cc.start_date AS campaign_start, ... FROM campaign_uplift u JOIN campaign_calendar cc ON ((cc.restaurant_id = u.restaurant_id) AND (cc.campaign_id = u.campaign_id)) WHERE ((u.window_kind = 'iso_week') AND (u.restaurant_id = ((auth.jwt() ->> 'restaurant_id'::text))::uuid));` PASS.

3. **Tenant-scoped GRANT:**
   ```sql
   SELECT has_table_privilege('authenticated', 'public.campaign_uplift_weekly_v', 'SELECT');
   ```
   Result: `t`. PASS.

## Pre-flight Drift Check

- Slot collision check: `0068_*` exists (Phase 17 backtest schema gap); `0070_*` does not — next free slot was 0069 as expected.
- Constraint name verified via `grep` of 0064 — `campaign_uplift_window_kind_check` follows the `<table>_<column>_check` PostgreSQL convention so the DROP CONSTRAINT statement targets the correct system-generated identifier.
- No drift discovered between research and execution.

## Decisions Made

None beyond plan — followed plan body verbatim. The 4 decisions captured in frontmatter were already locked in 18-RESEARCH.md and 18-PATTERNS.md before this plan ran.

## Deviations from Plan

None — plan executed exactly as written. Both tasks landed without auto-fix triggers, blocking issues, or architectural questions.

## Issues Encountered

None.

## Threat Surface Scan

No new threat surface introduced beyond what was already anticipated in the plan's `<threat_model>`:

- T-18-01 (RLS bypass on `campaign_uplift_weekly_v`) — mitigated as planned via inline `WHERE u.restaurant_id = (auth.jwt()->>'restaurant_id')::uuid` matching 0064 precedent. Verified live on DEV via `has_table_privilege`.
- T-18-02 (CHECK constraint bypass) — mitigated as planned: extension is additive, no existing writer broken, `'iso_week'` literal will be hardcoded in Plan 02 pipeline writer (no user-controlled flow into `window_kind`).
- T-18-03 (COMMENT text disclosure) — accepted as planned: static metadata only.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Plan 18-02 (pipeline writer)** — UNBLOCKED. `campaign_uplift` table now accepts `window_kind = 'iso_week'` upserts on DEV without CHECK violation.
- **Plan 18-03 (`/api/campaign-uplift` weekly_history)** — UNBLOCKED. `campaign_uplift_weekly_v` is queryable from authenticated SvelteKit `+page.server.ts` load functions.
- **Back-compat preserved** — Existing `campaign_uplift_v` (cumulative_since_launch) and `campaign_uplift_daily_v` (per_day) wrapper views are unaffected; the CHECK extension is purely additive and the new view does not replace either of them.
- **No blockers** for Plan 18-02 to start.

## Self-Check: PASSED

Verification of all claims in this SUMMARY:

- [x] `supabase/migrations/0069_campaign_uplift_iso_week.sql` exists on disk: YES (71 lines, committed in 09d9430)
- [x] File contains `ALTER TABLE public.campaign_uplift DROP CONSTRAINT IF EXISTS campaign_uplift_window_kind_check`: YES
- [x] File contains `ADD CONSTRAINT campaign_uplift_window_kind_check CHECK (window_kind IN ('campaign_window', 'cumulative_since_launch', 'per_day', 'iso_week'))`: YES
- [x] File contains `CREATE OR REPLACE VIEW public.campaign_uplift_weekly_v`: YES
- [x] File contains `WHERE u.window_kind = 'iso_week'`: YES
- [x] File contains `GRANT SELECT ON public.campaign_uplift_weekly_v TO authenticated`: YES
- [x] Commit 09d9430 exists in git log: YES
- [x] DEV CHECK constraint contains `'iso_week'`: YES (verified via supabase-dev `pg_get_constraintdef`)
- [x] DEV view body contains `window_kind = 'iso_week'`: YES (verified via `pg_get_viewdef`)
- [x] DEV `has_table_privilege('authenticated', ..., 'SELECT')` returns true: YES
- [x] GHA run 25483158267 completed success: YES
- [x] LOCAL `supabase db push --linked` ended `Finished supabase db push.`: YES

---
*Phase: 18-weekly-counterfactual-window*
*Plan: 01*
*Completed: 2026-05-07*
