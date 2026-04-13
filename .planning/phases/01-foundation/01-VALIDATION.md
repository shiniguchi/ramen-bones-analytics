---
phase: 1
slug: foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-13
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Authoritative source: `01-RESEARCH.md` §Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.x (SvelteKit default) + Supabase CLI for DB fixtures |
| **Config file** | `vitest.config.ts` (Wave 0 installs) |
| **Quick run command** | `pnpm vitest run --reporter=dot` |
| **Full suite command** | `pnpm vitest run && pnpm test:guards` |
| **Estimated runtime** | ~30 seconds (8 integration tests + 4 bash guards) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run --reporter=dot` (affected specs only via `--changed`)
- **After every plan wave:** Run `pnpm vitest run && pnpm test:guards`
- **Before `/gsd:verify-work`:** Full suite must be green against a live test Supabase project
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 0 | FND-01/02 | unit (migration compile) | `supabase db reset --local` | ❌ W0 | ⬜ pending |
| 1-01-02 | 01 | 1 | FND-01/02 | integration (RLS) | `vitest run tests/rls/tenancy.test.ts` | ❌ W0 | ⬜ pending |
| 1-02-01 | 02 | 1 | FND-03 | integration (JWT hook) | `vitest run tests/auth/jwt-hook.test.ts` | ❌ W0 | ⬜ pending |
| 1-02-02 | 02 | 1 | FND-03 | integration (session refresh) | `vitest run tests/auth/session.test.ts` | ❌ W0 | ⬜ pending |
| 1-03-01 | 03 | 1 | FND-04 | integration (wrapper-view) | `vitest run tests/views/wrapper.test.ts` | ❌ W0 | ⬜ pending |
| 1-03-02 | 03 | 1 | FND-04 | integration (REVOKE check) | `vitest run tests/views/revoke.test.ts` | ❌ W0 | ⬜ pending |
| 1-04-01 | 04 | 1 | FND-05 | integration (business_date 23:45 Berlin) | `vitest run tests/time/business-date.test.ts` | ❌ W0 | ⬜ pending |
| 1-05-01 | 05 | 1 | FND-06 | integration (two-tenant cross-read) | `vitest run tests/rls/two-tenant.test.ts` | ❌ W0 | ⬜ pending |
| 1-06-01 | 06 | 1 | FND-07 | e2e (login + refresh) | `vitest run tests/e2e/login.test.ts` | ❌ W0 | ⬜ pending |
| 1-07-01 | 07 | 1 | FND-08 | bash (CI grep guards) | `pnpm test:guards` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Canonical task IDs will be assigned by the planner — this table is the coverage contract, not the final task list.*

---

## Wave 0 Requirements

- [ ] `package.json` + `pnpm-lock.yaml` — SvelteKit 2 + Svelte 5 + Vitest 2 + @supabase/supabase-js + @supabase/ssr
- [ ] `vitest.config.ts` — node environment, setup file, 30s timeout for DB tests
- [ ] `tests/setup.ts` — loads `.env.test`, seeds two tenants via service_role, teardown hook
- [ ] `tests/helpers/supabase.ts` — sign-in helpers for tenant A and tenant B, authed client factory
- [ ] `tests/rls/tenancy.test.ts` — stubs for FND-01, FND-02
- [ ] `tests/auth/jwt-hook.test.ts` + `tests/auth/session.test.ts` — stubs for FND-03
- [ ] `tests/views/wrapper.test.ts` + `tests/views/revoke.test.ts` — stubs for FND-04
- [ ] `tests/time/business-date.test.ts` — stub for FND-05 (23:45 Berlin fixture)
- [ ] `tests/rls/two-tenant.test.ts` — stub for FND-06 (load-bearing isolation test)
- [ ] `tests/e2e/login.test.ts` — stub for FND-07 (session survives refresh via `@supabase/ssr`)
- [ ] `scripts/guards.sh` + `pnpm test:guards` script — FND-08 (4 grep guards from RESEARCH.md Pattern 7)
- [ ] `.github/workflows/guards.yml` — runs `pnpm test:guards` on every PR
- [ ] `.github/workflows/test.yml` — runs `pnpm vitest run` against the test Supabase project
- [ ] `supabase/` directory (Supabase CLI init) + `supabase/migrations/` skeleton
- [ ] `.env.test.example` — documents `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TEST_TENANT_A_EMAIL`, `TEST_TENANT_B_EMAIL`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Custom Access Token Hook registered in Supabase Dashboard | FND-03 | `config.toml` syntax for hook registration unverified (RESEARCH Open Question 1); Dashboard is the authoritative path | Project → Authentication → Hooks → Custom Access Token → select `public.custom_access_token_hook` → Save. Screenshot. |
| Test Supabase project provisioned + service_role key in GHA secrets | FND-06 | One-time infra setup; cannot be scripted in repo | Create second Supabase project "rba-test", copy URL + anon + service_role keys into GHA repo secrets `TEST_SUPABASE_*`. |
| DEV Supabase project linked and `supabase db push` succeeds | FND-01..05 | Requires interactive `supabase link` with access token | Run `supabase login` → `supabase link --project-ref <dev-ref>` → `supabase db push`. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter after planner sign-off

**Approval:** pending
