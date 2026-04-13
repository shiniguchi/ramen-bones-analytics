---
phase: 01-foundation
plan: 05
subsystem: ci-enforcement
tags: [ci, guards, github-actions, supabase]
requires:
  - supabase/migrations/0004_kpi_daily_mv_template.sql (Plan 01-03)
  - docs/reference/hooks.server.ts.example (Plan 01-04)
  - pii-columns.txt (Plan 01-01)
provides:
  - scripts/ci-guards.sh (5 grep guards, exits 0 on clean repo)
  - .github/workflows/guards.yml (CI enforcement on every PR)
  - .github/workflows/tests.yml (vitest against TEST Supabase project)
  - .github/workflows/migrations.yml (supabase db push to DEV on main)
affects:
  - Every future phase (guards block forbidden patterns)
tech-stack:
  added: [GitHub Actions, supabase/setup-cli, bash]
  patterns: [CI grep guards, GHA secrets, TEST-project isolation]
key-files:
  created:
    - scripts/ci-guards.sh
    - .github/workflows/guards.yml
    - .github/workflows/tests.yml
    - .github/workflows/migrations.yml
  modified: []
decisions:
  - "Guard 2 scope covers docs/reference/*.example so Phase 4 copy targets are validated pre-move"
  - "Guard 3 uses two-pass grep (no -P) for runner portability"
  - "Guard 4 skips comment lines in pii-columns.txt so empty manifest is a no-op"
  - "tests.yml applies migrations to TEST project BEFORE vitest (order matters for tenant-isolation test)"
  - "migrations.yml triggers only on push to main (PRs must not touch DEV)"
metrics:
  tasks: 2
  files_created: 4
  files_modified: 0
  duration: ~5 min
  completed: 2026-04-13
---

# Phase 01 Plan 05: CI grep guards + GHA workflows Summary

Shipped the CI enforcement layer: a single `scripts/ci-guards.sh` implementing all five forbidden-pattern guards (D-14 × 4 plus D-08 Guard 3b), plus three GitHub Actions workflows that run the guards, vitest suite, and DEV migrations.

## What Shipped

### scripts/ci-guards.sh

| Guard | Rule | Scope |
| ----- | ---- | ----- |
| 1 | No `*_mv` refs from `src/` — use `*_v` wrapper views | `src/` only (skipped until Phase 4 creates it) |
| 2 | `getSession(` on server files requires `getClaims/getUser` in same file | `src/**` + `docs/reference/*.example` (Phase 4 copy targets) |
| 3 | `REFRESH MATERIALIZED VIEW` must be `CONCURRENTLY` | `supabase/migrations/**/*.sql` |
| 3b | `CREATE MATERIALIZED VIEW` requires `CREATE UNIQUE INDEX` in same file | `supabase/migrations/**/*.sql` |
| 4 | `card_hash` must not be joined to any column in `pii-columns.txt` | `supabase/migrations/` + `src/` |

Self-test: `bash scripts/ci-guards.sh` → `All CI guards passed.` exit 0.

### GHA workflows

- **guards.yml** — Runs `bash scripts/ci-guards.sh` on every PR and push to main. No secrets.
- **tests.yml** — On PR + push to main. Installs Node 20 + supabase CLI, `npm ci`, applies migrations to the TEST Supabase project, then `npx vitest run`. Uses `TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY`, `TEST_SUPABASE_SERVICE_ROLE_KEY`, `TEST_SUPABASE_PROJECT_REF`, `TEST_SUPABASE_DB_PASSWORD`, `DEV_SUPABASE_URL`.
- **migrations.yml** — Push to main only. Runs `supabase db push --project-ref ${{ secrets.DEV_SUPABASE_PROJECT_REF }}` against DEV.

## Manual GHA Secrets (founder action required)

Plan 01-05 cannot create GHA secrets — the founder must add them via the GitHub repo settings before the `tests.yml` and `migrations.yml` workflows will pass:

- `TEST_SUPABASE_URL`
- `TEST_SUPABASE_ANON_KEY`
- `TEST_SUPABASE_SERVICE_ROLE_KEY`
- `TEST_SUPABASE_PROJECT_REF`
- `TEST_SUPABASE_DB_PASSWORD`
- `DEV_SUPABASE_URL`
- `DEV_SUPABASE_PROJECT_REF`
- `DEV_SUPABASE_DB_PASSWORD`

`guards.yml` has no secret dependency and will pass on first PR.

## Deviations from Plan

None — plan executed verbatim from Pattern 7 in 01-RESEARCH.md with the three adjustments the plan itself called out (Guard 2 also scans `docs/reference`, Guard 3 two-pass without `-P`, Guard 4 skips `#`-prefixed comments). Guard 4 comment-skip uses `case "$col" in '#'*) continue ;; esac` for safer quoting.

The bonus `@supabase/auth-helpers-sveltekit` guard was NOT added — plan 01-05 does not specify it, and the only occurrence lives in `docs/reference/README.md` as a forbidden-packages doc note. Leaving this for a future phase if desired.

## Self-Check: PASSED

- scripts/ci-guards.sh: FOUND, executable, exits 0
- .github/workflows/guards.yml: FOUND, contains `ci-guards.sh`
- .github/workflows/tests.yml: FOUND, contains `TEST_SUPABASE_URL` and `vitest run`
- .github/workflows/migrations.yml: FOUND, contains `supabase db push`
- All three YAML files parse via `yaml.safe_load`
- Commits: 5056814 (ci-guards.sh), a1e7faf (workflows)

## EXECUTION COMPLETE
