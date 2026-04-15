---
phase: 01-foundation
plan: 02
subsystem: auth/jwt
tags: [supabase, rls, jwt, auth-hook, multi-tenant]
requires:
  - supabase/migrations/0001_tenancy_schema.sql (public.memberships table)
provides:
  - public.custom_access_token_hook(jsonb) function
  - top-level `restaurant_id` JWT claim for all RLS policies downstream
affects:
  - every future wrapper view using `auth.jwt()->>'restaurant_id'`
tech-stack:
  added: []
  patterns:
    - Supabase Custom Access Token Hook (Pattern 2, RESEARCH.md)
    - Top-level JWT claim injection via jsonb_set (NOT app_metadata nesting)
    - Idempotent hook: zero-membership users pass through unchanged
key-files:
  created:
    - supabase/migrations/0002_auth_hook.sql
    - docs/reference/auth-hook-registration.md
  modified: []
decisions:
  - D-04 honored: restaurant_id injected at top level of claims, not app_metadata (Pitfall B avoided)
  - Hook is idempotent on zero-membership users (D-04 idempotency clause)
  - Registration is manual via Dashboard (Open Question 1 resolution; config.toml documented as experimental fallback)
metrics:
  tasks: 2
  files_created: 2
  files_modified: 0
  commits: 2
  completed: 2026-04-13
---

# Phase 1 Plan 2: Custom Access Token Hook Summary

Shipped the Supabase Custom Access Token Hook that injects a top-level `restaurant_id` claim into every JWT from `public.memberships`, plus the forker-facing Dashboard registration doc.

## What Was Built

**Migration `supabase/migrations/0002_auth_hook.sql`**
- `public.custom_access_token_hook(event jsonb) returns jsonb` — plpgsql, stable
- Reads `restaurant_id` from `public.memberships where user_id = (event->>'user_id')::uuid limit 1`
- Injects via `jsonb_set(new_claims, '{restaurant_id}', to_jsonb(rid::text))` — **top-level, not nested under app_metadata** (Pitfall B guard)
- Idempotent: if `rid is null`, returns `jsonb_build_object('claims', new_claims)` unchanged
- Grants (Pitfall C guard):
  - `grant execute on function ... to supabase_auth_admin`
  - `revoke execute on function ... from public, anon, authenticated`
  - `grant usage on schema public to supabase_auth_admin`
  - `grant select on public.memberships to supabase_auth_admin`

**Doc `docs/reference/auth-hook-registration.md`**
- Dashboard steps: Authentication → Hooks → Custom Access Token Hook → Postgres function → schema `public` → function `custom_access_token_hook`
- Experimental `supabase/config.toml` snippet with fallback to Dashboard
- Symptom section: unregistered hook → wrapper views return zero rows → Plan 06 isolation test fails

## Acceptance Criteria Verification

| Check | Result |
|---|---|
| `grep -q "custom_access_token_hook" 0002_auth_hook.sql` | PASS |
| `grep -q "to supabase_auth_admin" 0002_auth_hook.sql` | PASS |
| `grep -q "from public.memberships" 0002_auth_hook.sql` | PASS |
| `! grep -q "app_metadata" 0002_auth_hook.sql` | PASS (no nesting) |
| `grep -q "jsonb_set" 0002_auth_hook.sql` | PASS |
| `grep -c "supabase_auth_admin"` == 3 | PASS (3 occurrences) |
| `grep -r "app_metadata" supabase/migrations/` empty | PASS |
| `docs/reference/auth-hook-registration.md` exists with Dashboard steps | PASS |

## Commits

- `e469a80` feat(01): add custom_access_token_hook migration
- `8dbff89` feat(01): document Custom Access Token Hook registration for forkers

## Deviations from Plan

None — executed Pattern 2 verbatim from RESEARCH.md. No auto-fixes, no architectural changes, no authentication gates. Migration `0003_transactions_skeleton.sql` already exists in the tree from parallel Wave 2 work (Plan 01-03) and was not touched by this plan.

## Known Stubs

None.

## Self-Check: PASSED

- supabase/migrations/0002_auth_hook.sql — FOUND
- docs/reference/auth-hook-registration.md — FOUND
- commit e469a80 — FOUND
- commit 8dbff89 — FOUND

## EXECUTION COMPLETE
