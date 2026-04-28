-- 0039_pipeline_runs_skeleton.sql
-- Phase 12 FND-09 / D-07: minimal `public.pipeline_runs` skeleton, pulled
-- forward from Phase 13 so the FND-09 weekly ITS-validity audit cron has
-- a real write target from week 1.
--
-- Phase 13 alters this table and adds fetch-tracking columns that the
-- external-data cascade needs. The audit cron in Plan 12-02 writes ONE row
-- per run with step_name='its_validity_audit' and survives that future
-- alteration unchanged because the columns it touches (run_id, step_name,
-- started_at, finished_at, status, row_count, error_msg, commit_sha)
-- are stable.
--
-- D-08: RLS is INTENTIONALLY ABSENT in this skeleton. The table holds
-- operational metadata only — no tenant data, no PII, no card_hash, no
-- PAN. Writes are SERVICE-ROLE ONLY; anon and authenticated have ZERO
-- access. The RLS policy and tenant-scoping logic live in a later
-- migration and are added together with multi-tenant columns.
-- Do NOT add RLS to this phase.

create table if not exists public.pipeline_runs (
  run_id              bigserial primary key,
  step_name           text not null,
  started_at          timestamptz not null default now(),
  finished_at         timestamptz,
  status              text,
  row_count           int,
  error_msg           text,
  commit_sha          text
);

-- D-08: skeleton is service-role-only. Browser sessions (anon/authenticated)
-- cannot read or write. The RLS policy lives in a later migration and is
-- added together with the multi-tenant columns.
revoke all on public.pipeline_runs from anon, authenticated;
grant select, insert on public.pipeline_runs to service_role;
