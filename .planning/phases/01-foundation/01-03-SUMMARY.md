---
phase: 01-foundation
plan: 03
subsystem: database/migrations
tags: [supabase, rls, materialized-view, wrapper-view, seed, multi-tenant]
requires:
  - supabase/migrations/0001_tenancy_schema.sql (public.restaurants)
provides:
  - public.kpi_daily_mv (canonical placeholder MV)
  - public.kpi_daily_v (tenant-facing wrapper view template)
  - v1 seed restaurant row (Europe/Berlin)
affects:
  - Every future Phase 3 MV (copies this exact shape)
  - CI guard 3b (Plan 05) — real target now exists
  - Wrapper view isolation test (Plan 06) — real target now exists
tech-stack:
  added: []
  patterns:
    - "MV + unique index + REVOKE + owner-privileged wrapper view (D-06/D-07/D-08)"
    - "Tenancy via auth.jwt()->>'restaurant_id' WHERE clause on plain SQL view"
    - "Idempotent seed via 'where not exists' (no hardcoded UUID)"
key-files:
  created:
    - supabase/migrations/0004_kpi_daily_mv_template.sql
    - supabase/migrations/0005_seed_tenant.sql
  modified: []
decisions:
  - "Wrapper view left at default security mode (invoker=off) — load-bearing per Pitfall A"
  - "Placeholder MV body (restaurant_id, current_date, 0::numeric) — Phase 3 replaces"
  - "Seed uses 'where not exists' + gen_random_uuid() default; no UUID literal"
metrics:
  tasks_completed: 2
  duration: "~3 minutes"
  completed: 2026-04-13
---

# Phase 01 Plan 03: kpi_daily_mv Canonical Wrapper View Template Summary

One-liner: Ships the load-bearing MV + unique-index + REVOKE + plain-SQL wrapper view template on `kpi_daily_mv` that every Phase 3 materialized view will copy verbatim, plus an idempotent v1 seed for the single Europe/Berlin tenant.

## What Was Built

### Task 1 — `supabase/migrations/0004_kpi_daily_mv_template.sql`
Commit `f6eaaad`. Four statements in one file (order matters):
1. `create materialized view public.kpi_daily_mv` selecting `restaurant_id, current_date, 0::numeric as revenue_cents` from `public.restaurants` (placeholder per D-08a).
2. `create unique index kpi_daily_mv_pk on public.kpi_daily_mv (restaurant_id, business_date)` — mandatory for `REFRESH ... CONCURRENTLY` in Phase 3 and enforced by CI guard 3b in the same migration file.
3. `revoke all on public.kpi_daily_mv from anon, authenticated` — raw MV is never tenant-facing (D-07).
4. `create view public.kpi_daily_v as ... where restaurant_id::text = (auth.jwt()->>'restaurant_id')` + `grant select on public.kpi_daily_v to authenticated` — the sole tenant-facing read path (D-06).

Explicitly NOT present: any override of the default invoker mode. Default (owner-privileged execution) is load-bearing per Pitfall A — the view runs as `postgres`, which still has SELECT on the REVOKE'd MV, while `authenticated` can only reach it through the wrapper's WHERE clause.

### Task 2 — `supabase/migrations/0005_seed_tenant.sql`
Commit `ceb173b`. Single idempotent insert:
```sql
insert into public.restaurants (name, timezone)
select 'Ramen Shop (v1 tenant)', 'Europe/Berlin'
where not exists (select 1 from public.restaurants);
```
No hardcoded UUID (defers to `gen_random_uuid()` default from 0001). No membership row — the founder creates the friend's user in the Supabase Dashboard and the custom access token hook (0002) injects `restaurant_id` on first login per D-10.

## Verification

All plan acceptance criteria pass:

| Check | Result |
| --- | --- |
| `create materialized view public.kpi_daily_mv` in 0004 | PASS |
| `create unique index kpi_daily_mv_pk` in same file | PASS |
| `revoke all on public.kpi_daily_mv from anon, authenticated` | PASS |
| `create view public.kpi_daily_v` with `auth.jwt()->>'restaurant_id'` filter | PASS |
| `grant select on public.kpi_daily_v to authenticated` | PASS |
| `! grep security_invoker` in 0004 | PASS |
| `! grep "grant.*kpi_daily_mv.*authenticated"` across all migrations | PASS |
| `'Europe/Berlin'` literal in 0005 | PASS |
| `where not exists` idempotency clause in 0005 | PASS |
| No hardcoded UUID literal in 0005 | PASS |
| No `memberships` insert in 0005 | PASS |

## Deviations from Plan

None — both migrations ship verbatim against the plan's `<action>` blocks. Plan was authoritative where the upstream task message differed (UUID-based seed vs `where not exists` idempotent seed); plan's explicit "No hardcoded UUID literal" acceptance criterion settled it.

## Known Stubs

The `kpi_daily_mv` body is an intentional placeholder per D-08a — it returns one zero-revenue row per restaurant for today. This is tracked in the plan itself; Phase 3 replaces the select body with the real daily aggregation against `public.transactions`. The template shape (MV + unique index + REVOKE + wrapper view + JWT filter) is permanent and will be preserved.

## Commits

- `f6eaaad` feat(01-03): add kpi_daily_mv canonical wrapper view template
- `ceb173b` feat(01-03): seed v1 tenant restaurant with Europe/Berlin timezone

## Self-Check: PASSED

- FOUND: /Users/shiniguchi/development/ramen-bones-analytics/supabase/migrations/0004_kpi_daily_mv_template.sql
- FOUND: /Users/shiniguchi/development/ramen-bones-analytics/supabase/migrations/0005_seed_tenant.sql
- FOUND commit: f6eaaad
- FOUND commit: ceb173b

## EXECUTION COMPLETE
