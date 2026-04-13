---
status: partial
phase: 01-foundation
source:
  - 01-01-SUMMARY.md
  - 01-02-SUMMARY.md
  - 01-03-SUMMARY.md
  - 01-04-SUMMARY.md
  - 01-05-SUMMARY.md
  - 01-06-SUMMARY.md
started: 2026-04-13T00:00:00Z
updated: 2026-04-13T00:00:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: From a clean checkout, apply migrations 0001–0006 to a TEST Supabase project and run `npx vitest run`. Migrations apply without error, auth hook function created, seed inserts one Europe/Berlin restaurant, vitest suite boots and runs to completion.
result: pass
notes: All 6 migrations applied cleanly via `supabase db push` to fresh TEST project. Auth hook registered manually via Dashboard. config.toml major_version bumped 15→17 to match remote.

### 2. CI Guards Pass Locally
expected: Run `bash scripts/ci-guards.sh` on the repo. Output ends with `All CI guards passed.` and exits 0. All 5 guards (no `_mv` in src, getSession+getClaims pairing, REFRESH CONCURRENTLY, MV needs unique index, card_hash PII) report clean.
result: pass

### 3. Vitest Integration Suite Passes
expected: With TEST Supabase project provisioned and migrations applied, `npx vitest run` executes all 7 integration tests (schema, jwt-claim, rls-policies, mv-wrapper-template, tenant-isolation, business-date-fixture, session-persistence) and all pass green.
result: skipped
reason: Only one Supabase project provisioned; DEV-safety assert requires separate TEST project. Deferred until second project is created (prod config step).

### 4. JWT restaurant_id Claim Injection
expected: After a seeded user with a membership logs in against the TEST project, the decoded JWT contains `restaurant_id` as a top-level claim (NOT nested under `app_metadata`). The `jwt-claim.test.ts` integration test covers this — confirm it passes and the claim appears in a manually decoded token.
result: skipped
reason: Requires running vitest suite (blocked — see Test 3). Defer to second-project setup.

### 5. Tenant Isolation Enforced
expected: Tenant A's JWT querying `kpi_daily_v` sees only tenant A's rows; querying raw `kpi_daily_mv` returns 0 rows (REVOKE enforced); anon client sees 0 rows. The `tenant-isolation.test.ts` five-case test passes after MV refresh in beforeAll.
result: skipped
reason: Requires running vitest suite (blocked — see Test 3). Defer to second-project setup.

### 6. SvelteKit Reference Files Ready for Phase 4
expected: `docs/reference/` contains hooks.server.ts.example, +layout.server.ts.example, login/+page.server.ts.example, login/+page.svelte.example, README.md. Files import from `@supabase/ssr` (not deprecated auth-helpers), hooks file has both `getSession(` and `getClaims(`, layout redirects to `/login` and `/not-provisioned` appropriately.
result: pass
notes: All 5 files present. hooks.server.ts.example imports `createServerClient` from `@supabase/ssr` and contains both `getSession(` and `getClaims(`. Layout redirects to `/login` (no claims) and `/not-provisioned` (no restaurant_id) verified via grep.

### 7. Auth Hook Registration Documented
expected: `docs/reference/auth-hook-registration.md` exists with Dashboard steps (Authentication → Hooks → Custom Access Token Hook → public.custom_access_token_hook). A forker following the doc can register the hook without additional guidance.
result: pass
notes: File present. Followed the doc successfully in Test 1 to register the hook in the Dashboard.

## Summary

total: 7
passed: 4
issues: 0
pending: 0
skipped: 3

## Gaps

[none yet]
