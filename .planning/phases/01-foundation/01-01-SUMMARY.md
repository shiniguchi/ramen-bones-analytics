---
phase: 01-foundation
plan: 01
subsystem: foundation/bootstrap
tags: [bootstrap, vitest, supabase, migrations, rls, tenancy]
requires: []
provides:
  - "Vitest test harness with DEV-safety assert"
  - "restaurants + memberships tables with RLS and membership_role enum"
  - "transactions skeleton table with RLS and timestamptz occurred_at"
  - "pii-columns.txt manifest for CI guard #4"
affects: []
tech_stack_added:
  - "vitest ^1"
  - "typescript ^5"
  - "@types/node"
  - "tsx"
  - "dotenv"
  - "@supabase/supabase-js ^2.103"
  - "@supabase/ssr ^0.5"
patterns: []
files_created:
  - package.json
  - package-lock.json
  - tsconfig.json
  - vitest.config.ts
  - tests/setup.ts
  - tests/helpers/supabase.ts
  - .env.test.example
  - .gitignore
  - pii-columns.txt
  - supabase/config.toml
  - supabase/migrations/0001_tenancy_schema.sql
  - supabase/migrations/0003_transactions_skeleton.sql
files_modified: []
decisions:
  - "Used npm (not pnpm) — no lock-in, matches SvelteKit docs default"
  - "Added passWithNoTests: true to vitest config so Task 1 acceptance passes before any tests exist"
  - "Created supabase/config.toml manually as minimal stub — Supabase CLI not installed on this host; forkers will overwrite via `supabase init`"
  - "tests/setup.ts early-returns when TEST_SUPABASE_URL is unset so unit-only runs proceed; DEV-url safety assert still fires when both vars are set"
metrics:
  completed: 2026-04-13
  tasks: 3
  commits: 3
---

# Phase 1 Plan 01: Bootstrap + Tenancy/Transactions Migrations Summary

Bootstrapped greenfield repo with Vitest harness, Supabase scaffold, and migrations 0001 (tenancy) + 0003 (transactions skeleton). Wave 1 complete; Wave 2 (auth hook 0002, CI guards) and Wave 3 (seed + integration tests) can now proceed.

## What Shipped

### Task 1 — Bootstrap Node + Vitest + Supabase scaffold
- `npm init` with `type: module`, test scripts wired
- Installed devDeps: `vitest@^1`, `typescript@^5`, `@types/node`, `tsx`, `dotenv`
- Installed deps: `@supabase/supabase-js@^2.103`, `@supabase/ssr@^0.5`
- `tsconfig.json` via `tsc --init` (ES2022, bundler resolution, strict)
- `vitest.config.ts` — node env, setup file wired, `passWithNoTests: true`
- `tests/setup.ts` — dotenv load + DEV-url safety assert (Pitfall D / D-16)
- `tests/helpers/supabase.ts` — `adminClient()` + `tenantClient()` factories
- `.env.test.example`, `.gitignore`, `pii-columns.txt` (header-only stub)
- `supabase/config.toml` minimal stub (CLI not installed on host)
- Commit: `a3b764a`

### Task 2 — Tenancy schema migration (0001)
- Verbatim SQL from plan: `restaurants` (`id`, `name`, `timezone text not null`, `created_at`), `membership_role` enum, `memberships` (`user_id` FK to `auth.users`, `restaurant_id` FK, `role`), RLS enabled on both, `restaurants_own` + `memberships_own` SELECT policies, no write policies (deny-by-default per D-10)
- Commit: `bd390c2`

### Task 3 — Transactions skeleton migration (0003)
- `transactions` table with PK `(restaurant_id, source_tx_id)`, `occurred_at timestamptz not null`, nullable `card_hash`, index on `(restaurant_id, occurred_at)`, RLS enabled, `tx_tenant_read` SELECT policy via `auth.jwt()->>'restaurant_id'`. No `generated always` — business_date is derived at query time (D-09).
- Commit: `2008fe0`

## Acceptance Criteria — All Pass

**Task 1**
- package.json contains vitest, @supabase/supabase-js, @supabase/ssr — PASS
- `Refusing to run tests against DEV` in tests/setup.ts — PASS
- adminClient + tenantClient in tests/helpers/supabase.ts — PASS
- supabase/migrations directory exists — PASS
- pii-columns.txt exists — PASS
- `npx vitest run` exits 0 — PASS

**Task 2**
- restaurants + memberships create table present — PASS
- `enable row level security` twice — PASS
- `membership_role as enum ('owner','viewer')` — PASS
- `references auth.users(id)` — PASS
- No insert/update/delete policies — PASS

**Task 3**
- `occurred_at timestamptz not null` — PASS
- `card_hash text` (nullable) — PASS
- `primary key (restaurant_id, source_tx_id)` — PASS
- `enable row level security` — PASS
- `tx_tenant_read` policy with `auth.jwt()->>'restaurant_id'` — PASS
- No `generated always as` — PASS

## Deviations from Plan

1. **[Rule 3 — Blocking]** Plan step says `supabase init`, but Supabase CLI is not installed on this host. Created `supabase/config.toml` manually as minimal stub + `supabase/migrations/` directory. Forkers running `supabase init` will regenerate/overwrite config.toml; migrations are unaffected.
2. **[Rule 2 — Correctness]** Added `passWithNoTests: true` to vitest config. Without it, `npx vitest run` exits 1 when no test files exist, which would fail Task 1 acceptance criterion `"exits 0 (no tests yet = pass)"`. The plan explicitly requires exit 0 with no tests.
3. **[Rule 2 — Correctness]** `tests/setup.ts` early-returns when `TEST_SUPABASE_URL` is unset instead of throwing. The plan's original snippet throws on missing var, but that breaks `npx vitest run` on a fresh clone before `.env.test` is configured — same failure mode as (2). DEV-url equality check still fires whenever both env vars are present, preserving Pitfall D protection.

## Known Stubs

- `supabase/config.toml` is a minimal hand-written stub, not a full Supabase-CLI-generated config. Will be replaced when CLI runs for the first migration push.

## Self-Check: PASSED

Files verified on disk:
- FOUND: package.json, vitest.config.ts, tests/setup.ts, tests/helpers/supabase.ts, .env.test.example, .gitignore, pii-columns.txt
- FOUND: supabase/config.toml, supabase/migrations/0001_tenancy_schema.sql, supabase/migrations/0003_transactions_skeleton.sql

Commits verified in `git log`:
- FOUND: a3b764a (bootstrap)
- FOUND: bd390c2 (tenancy migration)
- FOUND: 2008fe0 (transactions skeleton)

Runtime checks:
- `npx vitest run` — exit 0
- `node -e "require('@supabase/supabase-js'); require('@supabase/ssr')"` — clean
- `grep -q "auth-helpers-sveltekit" package.json` — no match (forbidden dep absent)
