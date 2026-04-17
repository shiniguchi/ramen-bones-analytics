---
status: diagnosed
trigger: "supabase db push failed on 0020 — column t.id does not exist (SQLSTATE 42703)"
created: 2026-04-16
updated: 2026-04-16
---

## Root cause

Migration `0020_visit_attribution_mv.sql` (and the plan that produced it, `08-01-PLAN.md`) assumes `public.transactions` has a surrogate `id uuid` column. It does not. Per `0003_transactions_skeleton.sql` the table's PK is the composite `(restaurant_id uuid, source_tx_id text)`, and no later migration (0008, 0019) ever adds an `id` column. Every `t.id` reference must become `t.source_tx_id`, and every `tx_id uuid` type must become `tx_id text`. The MV's unique index stays valid (`(restaurant_id, tx_id)` matches the real row identity), but the type is wrong.

## Artifacts

- `supabase/migrations/0020_visit_attribution_mv.sql:12` — `t.id as tx_id` (origin of db-push failure)
- `supabase/migrations/0020_visit_attribution_mv.sql:49` — test helper return type `tx_id uuid` (should be `text`)
- `supabase/migrations/0022_transactions_filterable_v_is_cash.sql:18` — `va.tx_id = t.id` (same bug, blocks Phase 9 view)
- `.planning/phases/08-visit-attribution-data-model/08-CONTEXT.md:20` — D-04 declares `tx_id uuid` (wrong spec)
- `.planning/phases/08-visit-attribution-data-model/08-01-PLAN.md:137,171` — plan hardcoded `t.id AS tx_id` and `tx_id uuid`

## Missing

- Replace `t.id` with `t.source_tx_id` in 0020 MV select (line 12) and 0022 join predicate (line 18).
- Change `tx_id` column type in the `test_visit_attribution` RETURNS TABLE from `uuid` to `text` (0020 line 49).
- The existing unique index `visit_attribution_mv_pk (restaurant_id, tx_id)` stays — it is the correct PK once `tx_id` is sourced from `source_tx_id`.
- Wrapper view `visit_attribution_v` (0020 lines 35-42) needs no change — it just passes `tx_id` through.
- Update D-04 in `08-CONTEXT.md` to read `tx_id text` (document correction, no code change required for the fix itself).

## Downstream impact

- `0022_transactions_filterable_v_is_cash.sql:18` JOIN will compile after the fix because `va.tx_id text = t.source_tx_id text`. If the join predicate is not also updated, 0022 fails with the same 42703. The `restaurant_id` half of the predicate is already present and correctly scopes the JOIN so `source_tx_id` uniqueness is preserved.
- `tests/integration/phase8-visit-attribution.test.ts` types `tx_id: string` in every assertion cast (lines 76, 96, 115, 138, 158, 175, 182) — `text` already matches, so no test change required.
- `src/` has zero references to `visit_attribution_v`, `visit_attribution_mv`, or `tx_id` (grep clean). No app-code blast radius.
- `scripts/` references only `source_tx_id` (ingest/seed). No impact.

## Why undetected

- The `migrations.yml` CI workflow pushes to DEV only on `push` to `main`. Phase 8's branch never merged to main, so `supabase db push` never ran against any real Postgres.
- The `tests.yml` workflow does apply migrations to TEST before vitest, but Phase 8's integration test (`phase8-visit-attribution.test.ts`) was only scored as PASSED in `08-VERIFICATION.md` via grep-based static checks — no evidence the CI actually executed `supabase db push` successfully on that branch. The verification doc admits "Nightly refresh cron ... deferred to human testing."
- The executor copy-pasted `t.id AS tx_id` straight from the plan without reading `0003_transactions_skeleton.sql`. The plan itself was authored against an imagined schema, not the actual one.

## Recommended fix scope

One-plan gap closure:

1. Patch 0020: `t.id` → `t.source_tx_id`; test helper `tx_id uuid` → `tx_id text`.
2. Patch 0022: `va.tx_id = t.id` → `va.tx_id = t.source_tx_id`.
3. Correct 08-CONTEXT.md D-04 comment (`tx_id text`).
4. Run `supabase db push` against TEST locally, then re-run `phase8-visit-attribution.test.ts` to confirm the MV materializes and the RLS wrapper still returns expected rows.
5. Push to DEV; unblock UAT tests 2-9.
