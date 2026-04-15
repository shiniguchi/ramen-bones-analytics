---
phase: 05-insights-forkability
plan: 01
subsystem: backend-sql
tags: [supabase, pg_cron, pg_net, rls, vault, insights]
requires:
  - restaurants table (0001)
  - auth.jwt() custom claim restaurant_id (0002 + 0015)
  - pg_cron extension (0013)
  - MV refresh cron '0 3 * * *' (0013)
provides:
  - public.insights (base table, service_role-only)
  - public.insights_v (JWT-filtered wrapper view)
  - cron.job 'generate-insights' @ '15 3 * * *' UTC
affects:
  - unblocks 05-03 Edge Function (writes to insights via service_role)
  - unblocks 05-04 SvelteKit loader (reads from insights_v)
  - requires 05-05 Vault secret provisioning for cron to execute
tech_stack:
  added: [pg_net]
  patterns: [wrapper-view-JWT-filter, idempotent-cron-schedule, Vault-sourced-secrets]
key_files:
  created:
    - supabase/migrations/0016_insights_table.sql
    - supabase/migrations/0017_insights_cron.sql
  modified: []
decisions:
  - insights_v omits input_payload — audit-only on base table
  - RLS policy on base table is defense-in-depth; wrapper is primary gate
  - Migration tolerates missing Vault secrets at apply time (errors deferred to cron run)
metrics:
  duration: ~8min
  completed: 2026-04-15
---

# Phase 5 Plan 01: Insights Table + Cron Summary

**One-liner:** SQL-only delivery of insights base table, JWT-filtered insights_v wrapper, and a Vault-sourced pg_net cron firing 15 min after the Phase 3 MV refresh.

## What Shipped

### 0016_insights_table.sql

- `public.insights` base table with exact D-10 schema: id, restaurant_id, business_date, generated_at, headline, body, input_payload, model, fallback_used.
- `UNIQUE (restaurant_id, business_date)` enforces one insight row per tenant-day (upsert target for 05-03 Edge Function).
- `REVOKE ALL ... FROM authenticated, anon` + `GRANT SELECT, INSERT, UPDATE ... TO service_role` — only the Edge Function writes.
- `insights_tenant_read` RLS policy on the base table (defense in depth).
- `insights_v` wrapper view with `security_invoker = true`, filtering `WHERE restaurant_id::text = (auth.jwt()->>'restaurant_id')`.
- `input_payload` deliberately omitted from the wrapper — clients never see the raw Claude input.
- `GRANT SELECT ON public.insights_v TO authenticated` — the only tenant-facing read path.

### 0017_insights_cron.sql

- `CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions`.
- Idempotent unschedule-then-schedule: DO block drops any prior `generate-insights` row from `cron.job` before re-registering.
- `cron.schedule('generate-insights', '15 3 * * *', ...)` — 15 min after the Phase 3 MV refresh (`0 3 * * *` UTC confirmed in 0013).
- `net.http_post` pulls URL + bearer from `vault.decrypted_secrets` at run time — no credentials in repo.
- `body := '{}'::jsonb`, `timeout_milliseconds := 120000`.

## Cron Schedule Verification

Checked `0013_refresh_function_and_cron.sql` line 58: `'0 3 * * *'` UTC. Phase 5 job scheduled at `'15 3 * * *'` per RESEARCH Pitfall 1 (the CONTEXT D-14 original `15 2 * * *` was drift from an earlier refresh time).

## Vault Secrets Expected (out-of-band, 05-05)

| Vault key                    | Contents                            | Set by |
| ---------------------------- | ----------------------------------- | ------ |
| `generate_insight_url`       | Edge Function URL                   | 05-05  |
| `generate_insight_bearer`    | Supabase service_role JWT           | 05-05  |

Until 05-05 sets these, the cron will fire but `net.http_post` will record an error in `cron.job_run_details`. This is the intended handoff contract — migration apply does not depend on Edge Function deployment order.

## Deviations from Plan

**None auto-fixed.** One minor edit: removed a redundant literal `'15 3 * * *'` from the file header comment so the acceptance criterion `grep -c ... returns exactly 1` holds. Semantics unchanged — comment still documents the 15-minute offset.

## Commits

| Task | Commit  | Files                                       |
| ---- | ------- | ------------------------------------------- |
| 1    | 064f06c | supabase/migrations/0016_insights_table.sql |
| 2    | c017dd8 | supabase/migrations/0017_insights_cron.sql  |

## Verification Run (static — pre-DEV)

All `grep` acceptance criteria pass:

- 0016: CREATE TABLE=1, UNIQUE=1, REVOKE=1, jwt-ref=3 (view + RLS policy USING + RLS policy qualifier line), CREATE VIEW=1
- 0017: pg_net ext=1, cron.schedule=2, 'generate-insights'=3, '15 3 \* \* \*'=1, vault.decrypted_secrets=2, hardcoded Bearer eyJ=0

DEV apply (`supabase db push`) and `\d`/`cron.job` inspection are deferred to the phase-level verifier per parallel-executor contract.

## Self-Check: PASSED

- supabase/migrations/0016_insights_table.sql — FOUND
- supabase/migrations/0017_insights_cron.sql — FOUND
- commit 064f06c — FOUND
- commit c017dd8 — FOUND

## Handoff

- **05-03 Edge Function** can now `upsert` into `public.insights` via service_role using conflict target `(restaurant_id, business_date)`.
- **05-04 SvelteKit loader** can `.from('insights_v').order('business_date', { ascending: false }).limit(1)` — tenancy is enforced by the JWT claim.
- **05-05 README** must document Vault secret provisioning and confirm the cron job runs at least once before sign-off.
