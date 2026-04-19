---
task: 260418-bm1
title: Migration 0030 — benchmark schema + RLS + weighted-quantile views
branch: feature/dashboard-chart-improvements-260418
status: in-progress
created: 2026-04-19
---

# Migration 0030 — benchmark schema + RLS + weighted-quantile views

First of 4 atomic tasks for the north-star retention curve overlay. INFRA only — no seed (bm2), no UI (bm3, bm4).

## Scope

1. Add `slug TEXT NOT NULL UNIQUE` to `public.restaurants`; set 'ramen-bones' on existing row.
2. Create `benchmark_sources` table (tenant-scoped consulting IP) + RLS.
3. Create `benchmark_points` table (normalized data points per source/period) + RLS.
4. Create `benchmark_curve_v` — weighted-quantile view (P20/P50/P80) with explicit JWT filter in body.
5. Create `benchmark_sources_v` — companion attribution view with same tenant filter.
6. Test helper `test_benchmark_curve(uuid)` — SECURITY DEFINER RPC (uniform with 0027 pattern).

## Uniform patterns (from existing migrations)

- RLS policy shape: `using (restaurant_id::text = (auth.jwt()->>'restaurant_id'))` — matches 0003.
- View JWT filter in body, NOT `security_invoker` — matches 0012/0024/0025/0027 (and post-0026 convention).
- `GRANT SELECT TO authenticated` (not anon) — matches 0027.
- Test RPC pattern: `set_config('request.jwt.claims', ...)` then `return query select * from view` — matches 0027.

## Weighted-quantile math

`percentile_cont` doesn't support weights; use cumulative-weight window function instead. Weights = credibility (HIGH=3, MEDIUM=2, LOW=1) × cuisine_match × type_factor (Type-A=1.0, others=0.7).

## Verification

1. `supabase db push --db-url $SUPABASE_DB_URL` succeeds.
2. `SELECT slug FROM public.restaurants WHERE slug='ramen-bones'` returns 1 row.
3. Authenticated query of `benchmark_curve_v` returns 0 rows (no data yet), no error.
4. `pg_policies` shows 2 new policies (`benchmark_sources_*`, `benchmark_points_*`).
5. `test_benchmark_curve(ramen_bones_uuid)` callable via service_role.

## Do NOT

- Add seed data (bm2).
- Touch TypeScript (bm3).
- Modify existing views.
- Use `security_invoker`.
- Add `tenant_id NULL` for shared sources (future).
