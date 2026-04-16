---
phase: 09-filter-simplification-performance
plan: 03
subsystem: database
tags: [supabase, migrations, materialized-view, postgres, visit-attribution, gap-closure]

# Dependency graph
requires:
  - phase: 08-visit-attribution-data-model
    provides: visit_attribution_mv skeleton and Phase 8 D-04 column spec
  - phase: 09-filter-simplification-performance
    provides: transactions_filterable_v is_cash wiring (0022), Phase 9 UAT scaffold
provides:
  - Migration 0020 references transactions.source_tx_id (text) as tx_id — matches real composite PK
  - Migration 0022 JOIN predicate uses source_tx_id — is_cash correctly wired
  - Migration 0021 rewritten to DROP + CREATE VIEW (Postgres forbids column removal via CREATE OR REPLACE VIEW)
  - Phase 8 D-04 decision doc corrected to tx_id text with composite-PK rationale
  - Phase 9 UAT Test 1 (cold-start smoke) passes on DEV — Tests 2-9 unblocked
affects: [10-charts, phase-9-uat-remaining-tests]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Unpushed migrations edited in place (history stays clean) rather than superseded — valid when zero environments have applied them"
    - "Postgres view column removal requires DROP VIEW IF EXISTS + CREATE VIEW (SQLSTATE 42P16 on CREATE OR REPLACE)"

key-files:
  created:
    - .planning/phases/09-filter-simplification-performance/09-03-SUMMARY.md
  modified:
    - supabase/migrations/0020_visit_attribution_mv.sql
    - supabase/migrations/0021_visit_attribution_v_drop_payment_method.sql
    - supabase/migrations/0022_transactions_filterable_v_is_cash.sql
    - .planning/phases/08-visit-attribution-data-model/08-CONTEXT.md
    - .planning/phases/09-filter-simplification-performance/09-UAT.md

key-decisions:
  - "Fix in place instead of superseding — 0020/0021/0022 never applied anywhere, so edit preserves migration history cleanness"
  - "0021 rewritten as DROP + CREATE VIEW (not CREATE OR REPLACE) because Postgres forbids removing columns from a view via CREATE OR REPLACE"
  - "tx_id is text (sourced from transactions.source_tx_id), not uuid — public.transactions has no surrogate id column; PK is composite (restaurant_id, source_tx_id text)"

patterns-established:
  - "CREATE OR REPLACE VIEW column-shape invariant: use DROP VIEW IF EXISTS + CREATE VIEW when changing or removing columns"
  - "Gap-closure plans unblock UAT by fixing prior-phase migrations — track via UAT result field, not phase re-open"

requirements-completed: [VA-01, VA-02, VA-11, VA-12, VA-13]

# Metrics
duration: ~45 min (multi-session, includes debug + TEST iteration + DEV push + UAT)
completed: 2026-04-16
---

# Phase 9 Plan 3: Migration PK-Type Gap Closure Summary

**Fixed composite-PK type mismatch in migrations 0020/0022 (t.id → t.source_tx_id, uuid → text) and corrected Phase 8 D-04 doc — unblocks Phase 9 UAT against DEV**

## Performance

- **Duration:** ~45 min
- **Completed:** 2026-04-16
- **Tasks:** 5 (4 auto + 1 human-verify checkpoint)
- **Files modified:** 5
- **Deviations:** 1 (Rule 3 — migration 0021 rewrite to unblock DEV push)

## Accomplishments

- Migration 0020 `visit_attribution_mv` now sources `tx_id` from `t.source_tx_id` (text) — compiles against the real `transactions` schema
- Migration 0022 `transactions_filterable_v` JOINs `va.tx_id = t.source_tx_id` — `is_cash` column resolves, dashboard reads cash/card
- Migration 0021 rewritten as DROP + CREATE VIEW so the MV column-shape change actually lands on DEV
- Phase 8 D-04 decision doc now documents `tx_id text` with composite-PK rationale — future readers won't repeat the mistake
- `supabase db push` applies 0020/0021/0022 cleanly against DEV — `visit_attribution_mv` materialized with 6896 rows
- Dashboard cold-start verified on DEV: 2 KPI tiles render, no `t.id` / `is_cash` / `42703` / view-reference errors in browser or server logs
- Phase 8 integration test `phase8-visit-attribution.test.ts` all 8/8 green against TEST after edits
- UAT Test 1 (cold-start smoke) transitioned from `result: issue` → `result: passed`

## Task Commits

1. **Task 1: Fix migration 0020 — t.id → source_tx_id, uuid → text** — `fd5e4f2` (fix)
2. **Task 2: Fix migration 0022 — JOIN predicate to source_tx_id** — `068ed0a` (fix)
3. **Task 3: Correct Phase 8 D-04 — tx_id text** — `bb0d018` (docs)
4. **Task 3.5 (Rule 3 deviation): Rewrite migration 0021 — DROP + CREATE VIEW** — `2a624ce` (fix)
5. **Task 4: TEST verification — db push clean + 8/8 integration green** — no commit (verification only)
6. **Task 5: DEV push + human-verify checkpoint — UAT Test 1 passed** — metadata commit below

## Exact Edits Applied

### `supabase/migrations/0020_visit_attribution_mv.sql`
- **Line 12:** `t.id as tx_id,` → `t.source_tx_id as tx_id,`
- **Line 49:** `tx_id uuid,` → `tx_id text,` (test_visit_attribution RETURNS TABLE column type)

### `supabase/migrations/0022_transactions_filterable_v_is_cash.sql`
- **Line 18:** `ON va.restaurant_id = t.restaurant_id AND va.tx_id = t.id` → `ON va.restaurant_id = t.restaurant_id AND va.tx_id = t.source_tx_id`

### `supabase/migrations/0021_visit_attribution_v_drop_payment_method.sql` (Rule 3 deviation)
- Rewritten from `CREATE OR REPLACE VIEW` → `DROP VIEW IF EXISTS` + `CREATE VIEW`. Postgres 42P16 forbids removing columns from a view via CREATE OR REPLACE — the migration's stated goal (drop `payment_method` column from `visit_attribution_v`) was architecturally impossible with the original SQL.

### `.planning/phases/08-visit-attribution-data-model/08-CONTEXT.md`
- **Line 20 (D-04):** `tx_id uuid` → `tx_id text` with parenthetical: "sourced from `transactions.source_tx_id` — `transactions` has no surrogate `id`; PK is composite `(restaurant_id, source_tx_id)`"

### `.planning/phases/09-filter-simplification-performance/09-UAT.md`
- Test 1 `result: issue` → `result: passed`, removed `reported:` block
- Summary counts: `passed: 0 → 1`, `issues: 1 → 0`

## Files Created/Modified

- `supabase/migrations/0020_visit_attribution_mv.sql` — MV now reads real PK column
- `supabase/migrations/0021_visit_attribution_v_drop_payment_method.sql` — DROP + CREATE pattern (Rule 3)
- `supabase/migrations/0022_transactions_filterable_v_is_cash.sql` — JOIN predicate fixed
- `.planning/phases/08-visit-attribution-data-model/08-CONTEXT.md` — D-04 corrected
- `.planning/phases/09-filter-simplification-performance/09-UAT.md` — Test 1 flipped to passed

## Decisions Made

1. **Fix in place, don't supersede.** Migrations 0020/0021/0022 had never been applied to any environment (TEST or DEV). Editing existing files keeps the migration history clean — superseding with 0023/0024/0025 would have been cosmetic noise.
2. **DROP + CREATE VIEW for column-shape changes.** Postgres `CREATE OR REPLACE VIEW` can change column types but cannot remove columns (SQLSTATE 42P16). Discovered during TEST verification — captured as a pattern for future view evolution.
3. **tx_id is text, not uuid, everywhere.** `transactions` has no surrogate `id`; PK is composite `(restaurant_id, source_tx_id text)` per migration 0003. `visit_attribution_mv.tx_id` must be text, consumers must cast as string. Phase 8 D-04 now reflects this.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Migration 0021 rewritten as DROP + CREATE VIEW**
- **Found during:** Task 4 (TEST verification — `supabase db push`)
- **Issue:** Migration 0021 used `CREATE OR REPLACE VIEW visit_attribution_v` to drop the `payment_method` column. Postgres rejected with SQLSTATE 42P16: "cannot drop columns from view". Tasks 1-3 edits applied cleanly but the push failed at 0021, blocking the entire migration chain from reaching DEV.
- **Fix:** Rewrote 0021 as `DROP VIEW IF EXISTS public.visit_attribution_v; CREATE VIEW public.visit_attribution_v AS ...`. This is outside the original plan scope (plan only mentioned editing 0020/0022) but was required to unblock DEV verification — any fix to 0020 is useless if 0021 prevents 0020 from landing.
- **Files modified:** `supabase/migrations/0021_visit_attribution_v_drop_payment_method.sql`
- **Verification:** TEST `supabase db push` → clean apply of 0020/0021/0022. DEV `supabase db push` → clean apply. `visit_attribution_mv` materialized with 6896 rows. Dashboard 2 KPI tiles render on DEV.
- **Committed in:** `2a624ce`

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Deviation was scope-adjacent, not scope-creep — 0021 lives in the same migration batch as 0020/0022 and its failure blocked the plan's stated goal. Fix was mechanical (Postgres idiom change), not architectural. No user decision needed.

## Issues Encountered

- **Migration 0021 column-drop blocked DEV push.** Surfaced during Task 4 TEST verification, not in the plan's static analysis. Fixed via Rule 3 deviation (see above). Root cause: plan authors assumed `CREATE OR REPLACE VIEW` was shape-flexible; Postgres is stricter.

## Authentication Gates

None — DEV/TEST Supabase credentials were already exported in the session from prior Phase 9 work.

## User Setup Required

None — no external service configuration needed.

## UAT Status

**Unblocked by this plan:**
- Test 1 (Cold Start Smoke) — `result: passed` on DEV
- Tests 2-9 — were `blocked_by: prior-phase`; now that 0020/0021/0022 have landed on DEV, the prior-phase blocker is resolved. They remain at `result: blocked` on disk because this plan did not re-run them; the standard UAT workflow will re-execute Tests 2-9 against the now-green DEV dashboard.

**DEV verification evidence (UAT Test 1):**
1. `supabase db push` against DEV → clean apply of 0020/0021/0022 (no 42703, no 42P16)
2. `SELECT COUNT(*) FROM public.visit_attribution_mv` on DEV → 6896 rows
3. Dashboard cold-start on DEV → 2 KPI tiles render (Revenue `0 €`, Transactions `0`). The `0 €` / `0` are real computed values for the tenant's 7-day window, not an error state — the plan's `>0 MV rows` sanity check independently confirmed the MV is populated.
4. Payment type filter (Cash/Card) renders — proves `is_cash` column resolves through the view
5. No console or server errors referencing `t.id`, `is_cash`, `42703`, `transactions_filterable_v`, or `visit_attribution_mv`
6. TEST integration test `phase8-visit-attribution.test.ts` 8/8 green

## Next Phase Readiness

- Phase 9 UAT can resume Tests 2-9 on DEV immediately — no blockers remain.
- Phase 10 (Charts) — not blocked by this plan. `visit_attribution_mv` + `transactions_filterable_v` are both live on DEV with the correct column shapes.
- `tx_id text` convention now doc'd in Phase 8 D-04; chart MVs built on top of `visit_attribution_v` should treat `tx_id` as text.

---
*Phase: 09-filter-simplification-performance*
*Completed: 2026-04-16*

## Self-Check: PASSED

- [x] 09-03-SUMMARY.md exists at `.planning/phases/09-filter-simplification-performance/09-03-SUMMARY.md`
- [x] Task commits present: fd5e4f2, 068ed0a, bb0d018, 2a624ce
- [x] Metadata commit present: b0a3ccb (single clean commit, no Co-authored-by)
- [x] UAT.md Test 1 result=passed, summary passed=1 issues=0
- [x] STATE.md progress recalculated, 2 decisions added, session recorded
- [x] ROADMAP.md Phase 9 row shows 3/3 Complete 2026-04-16
- [x] REQUIREMENTS.md Evidence column added, 09-03 traced to VA-01, VA-02, VA-11, VA-12, VA-13
