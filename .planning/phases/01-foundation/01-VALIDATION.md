---
phase: 1
slug: foundation
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-13
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Authoritative source: `01-RESEARCH.md` §Validation Architecture. Requirement IDs match `REQUIREMENTS.md` (FND-05 = two-tenant isolation, FND-06 = session persistence, FND-08 = business_date timezone derivation).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.x (SvelteKit default) + Supabase CLI for DB fixtures |
| **Config file** | `vitest.config.ts` (Plan 01-01 Wave 0 installs) |
| **Quick run command** | `npx vitest run --reporter=dot` |
| **Full suite command** | `npx vitest run && bash scripts/ci-guards.sh` |
| **Estimated runtime** | ~30 seconds (7 integration tests + bash guards) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=dot` (affected specs)
- **After every plan wave:** Run `npx vitest run && bash scripts/ci-guards.sh`
- **Before `/gsd:verify-work`:** Full suite must be green against the TEST Supabase project
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

Task IDs below use the `{phase}-{plan}-{task}` convention matching the six plans `01-01` through `01-06`.

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 01-01-1 | 01-01 | 1 | FND-01, FND-08 | migration + vitest harness | `test -f supabase/migrations/0001_tenancy_schema.sql && test -f vitest.config.ts` | ⬜ pending |
| 01-02-1 | 01-02 | 1 | FND-02 | migration (custom access token hook) | `grep -q custom_access_token_hook supabase/migrations/0002_*.sql` | ⬜ pending |
| 01-03-1 | 01-03 | 1 | FND-04 | migration (kpi_daily_mv wrapper template) | `grep -q "refresh materialized view concurrently" supabase/migrations/0004_*.sql` | ⬜ pending |
| 01-04-1 | 01-04 | 1 | FND-07 | docs/reference skeletons + .env.test.example | `test -f docs/reference/hooks.server.ts.example` | ⬜ pending |
| 01-05-1 | 01-05 | 2 | FND-03 (guards), D-13/D-14 | bash (CI grep guards) | `bash scripts/ci-guards.sh` | ⬜ pending |
| 01-06-0 | 01-06 | 3 | FND-03, FND-05, FND-06, FND-08 | migration (test helpers RPC) | `grep -q refresh_kpi_daily_mv supabase/migrations/0006_test_helpers.sql` | ⬜ pending |
| 01-06-1 | 01-06 | 3 | FND-01 | integration (schema RLS via `test_rls_enabled` RPC) | `npx vitest run tests/integration/schema.test.ts` | ⬜ pending |
| 01-06-1 | 01-06 | 3 | FND-02 | integration (JWT top-level claim) | `npx vitest run tests/integration/jwt-claim.test.ts` | ⬜ pending |
| 01-06-1 | 01-06 | 3 | FND-03 | integration (RLS policies, per-table) | `npx vitest run tests/integration/rls-policies.test.ts` | ⬜ pending |
| 01-06-1 | 01-06 | 3 | FND-04 | integration (MV wrapper privileges) | `npx vitest run tests/integration/mv-wrapper-template.test.ts` | ⬜ pending |
| 01-06-1 | 01-06 | 3 | **FND-05** | integration (**two-tenant isolation**, load-bearing) | `npx vitest run tests/integration/tenant-isolation.test.ts` | ⬜ pending |
| 01-06-2 | 01-06 | 3 | **FND-06** | integration (**session persistence** via `setSession` proxy) | `npx vitest run tests/integration/session-persistence.test.ts` | ⬜ pending |
| 01-06-2 | 01-06 | 3 | **FND-08** | integration (**business_date** 23:45 + 00:30 Berlin) | `npx vitest run tests/integration/business-date-fixture.test.ts` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Requirement coverage:** FND-01 (01-06-1 schema), FND-02 (01-06-1 jwt-claim), FND-03 (01-05-1 guards + 01-06-1 rls-policies), FND-04 (01-06-1 mv-wrapper), FND-05 (01-06-1 tenant-isolation), FND-06 (01-06-2 session-persistence, Phase 1 proxy only), FND-07 (01-04-1 reference skeletons), FND-08 (01-06-2 business-date-fixture + 01-01-1 schema column type).

**FND-06 scope note:** Phase 1 validates session persistence at the supabase-js `setSession` layer. Phase 4 will copy `docs/reference/*.example` files into `src/` and re-validate FND-06 end-to-end through `@supabase/ssr` cookie hydration via actual browser refresh.

---

## Wave 0 Requirements (owned by Plan 01-01 unless noted)

- [ ] `package.json` + lockfile — SvelteKit 2 + Svelte 5 + Vitest 2 + @supabase/supabase-js + @supabase/ssr
- [ ] `vitest.config.ts` — node environment, setup file, 30s timeout for DB tests
- [ ] `tests/setup.ts` — loads `.env.test`, DEV-url safety assert, service-role client factory
- [ ] `tests/helpers/supabase.ts` — `adminClient()` and `tenantClient()` factories
- [ ] `.env.test.example` — `TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY`, `TEST_SUPABASE_SERVICE_ROLE_KEY`
- [ ] `supabase/config.toml` + `supabase/migrations/` skeleton
- [ ] `supabase/migrations/0001_tenancy_schema.sql` — restaurants + memberships + transactions skeleton with RLS
- [ ] `supabase/migrations/0002_custom_access_token_hook.sql` — JWT hook (Plan 01-02)
- [ ] `supabase/migrations/0003_transactions_skeleton.sql` — or folded into 0001
- [ ] `supabase/migrations/0004_kpi_daily_mv_template.sql` — MV + wrapper view + REVOKE + unique index (Plan 01-03)
- [ ] `supabase/migrations/0006_test_helpers.sql` — `refresh_kpi_daily_mv`, `test_rls_enabled`, `test_table_privileges`, `test_business_date` (Plan 01-06 Task 0)
- [ ] `docs/reference/hooks.server.ts.example` + `.env.test.example` + `auth-hook-registration.md` (Plan 01-04)
- [ ] `scripts/ci-guards.sh` — four grep guards from RESEARCH Pattern 7 (Plan 01-05)
- [ ] `.github/workflows/guards.yml` + `.github/workflows/tests.yml` + `.github/workflows/db-migrations.yml`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Custom Access Token Hook registered in Supabase Dashboard | FND-02 | `config.toml` syntax for hook registration unverified (RESEARCH Open Question 1); Dashboard is the authoritative path | Project → Authentication → Hooks → Custom Access Token → select `public.custom_access_token_hook` → Save. Screenshot. |
| TEST Supabase project provisioned + service_role key in GHA secrets | FND-05 | One-time infra setup; cannot be scripted in repo | Create second Supabase project "rba-test", copy URL + anon + service_role keys into GHA secrets `TEST_SUPABASE_*`. |
| DEV Supabase project linked and `supabase db push` succeeds | FND-01..FND-04 | Requires interactive `supabase link` with access token | `supabase login` → `supabase link --project-ref <dev-ref>` → `supabase db push`. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter after planner sign-off

**Approval:** approved for execution
