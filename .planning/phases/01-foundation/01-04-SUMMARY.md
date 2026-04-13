---
phase: 01-foundation
plan: 04
subsystem: sveltekit-reference
tags: [supabase-ssr, auth, reference-files, ci-guard-baseline]
requires: [01-01]
provides:
  - "docs/reference/hooks.server.ts.example (Phase 4 copy target)"
  - "docs/reference/+layout.server.ts.example (protected-route pattern)"
  - "docs/reference/login/ (copy-ready login page)"
  - "CI guard #2 positive-case baseline file"
affects:
  - "Phase 4 SvelteKit bootstrap (copy .example files into src/)"
  - "Plan 01-05 CI guard #2 (scans docs/reference/ + src/)"
tech-stack:
  added: []
  patterns:
    - "@supabase/ssr createServerClient with getAll/setAll cookie adapter"
    - "safeGetSession helper validating JWT via getClaims()"
    - "SvelteKit form actions for auth (no client-only signInWithPassword)"
key-files:
  created:
    - docs/reference/hooks.server.ts.example
    - docs/reference/+layout.server.ts.example
    - docs/reference/README.md
    - docs/reference/login/+page.server.ts.example
    - docs/reference/login/+page.svelte.example
  modified: []
decisions:
  - "Followed PLAN.md verbatim code over task-prompt skeleton (PLAN is authoritative): PUBLIC_SUPABASE_PUBLISHABLE_KEY, getClaims-only (no getUser fallback branch), /not-provisioned redirect for missing restaurant_id claim"
metrics:
  duration: ~3m
  completed: 2026-04-13
---

# Phase 1 Plan 04: SvelteKit Reference Files Summary

Ships copy-ready `.example` reference files under `docs/reference/` so Phase 4 has a verbatim bootstrap target and Plan 01-05's CI guard #2 has a real positive-case file to scan.

## What Was Built

Five reference files under `docs/reference/`:

1. **`hooks.server.ts.example`** — `@supabase/ssr` `createServerClient` wired through SvelteKit `event.cookies` with the `getAll`/`setAll` adapter. Exposes `event.locals.safeGetSession` which calls `supabase.auth.getSession()` then validates the JWT via `supabase.auth.getClaims()` before returning. Sets `filterSerializedResponseHeaders` for `content-range` and `x-supabase-api-version`.
2. **`+layout.server.ts.example`** — Calls `locals.safeGetSession()`, `throw redirect(303, '/login')` when no claims, `throw redirect(303, '/not-provisioned')` when the JWT lacks `restaurant_id`, otherwise returns `{ restaurantId }`.
3. **`login/+page.server.ts.example`** — Default form action reads email+password from `formData`, calls `locals.supabase.auth.signInWithPassword`, returns `fail(400, ...)` on error, `throw redirect(303, '/')` on success.
4. **`login/+page.svelte.example`** — Minimal Svelte 5 (`$props()`) email+password form with `role="alert"` error surface. No signup link (D-10), no reset link (D-11).
5. **`README.md`** — Documents `.example` suffix rationale, Phase 4 wire-up steps, required env vars (`PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_PUBLISHABLE_KEY`), and forbidden packages (`@supabase/auth-helpers-sveltekit`).

## Commits

- `7c1a1e2` feat(01-04): add hooks.server and layout reference with safeGetSession
- `970ac9c` feat(01-04): add login page reference (email+password, no signup/reset)

## Decisions Made

- **Plan over task-prompt on env var name:** Task prompt suggested `PUBLIC_SUPABASE_ANON_KEY`; PLAN.md Task 1 specified `PUBLIC_SUPABASE_PUBLISHABLE_KEY` verbatim from RESEARCH.md Pattern 5. Followed PLAN (authoritative per execution rules). Phase 4 must set this env var under that exact name.
- **Plan over task-prompt on safeGetSession fallback:** Task prompt suggested a `getClaims`/`getUser` fallback branch with `@ts-expect-error` suppressions. PLAN.md Task 1 specified `getClaims()`-only (no fallback) because RESEARCH.md Pattern 5 mandates that path and `@supabase/supabase-js` 2.103+ exposes `getClaims` natively. Followed PLAN.
- **Plan over task-prompt on not-provisioned redirect:** PLAN.md `+layout.server.ts.example` adds a `/not-provisioned` redirect when `claims.restaurant_id` is missing — prevents silent render of a dashboard with no tenant. Kept.

## Deviations from Plan

None — plan executed exactly as written. No Rule 1-3 auto-fixes needed.

## Acceptance Criteria

- [x] `hooks.server.ts.example` imports `createServerClient` from `@supabase/ssr`
- [x] File defines `event.locals.safeGetSession`
- [x] File contains both `getSession(` AND `getClaims(` (CI guard #2 positive baseline)
- [x] File does NOT import from `@supabase/auth-helpers-sveltekit`
- [x] `+layout.server.ts.example` throws `redirect(303, '/login')` when no claims
- [x] `+layout.server.ts.example` throws `redirect(303, '/not-provisioned')` when no `restaurant_id` claim
- [x] `docs/reference/README.md` explains `.example` suffix purpose
- [x] `login/+page.server.ts.example` uses `locals.supabase.auth.signInWithPassword`
- [x] `login/+page.svelte.example` is a pure email+password form
- [x] No signup link (D-10), no reset link (D-11)

## Known Stubs

None — these are intentional reference files. The whole directory is a stub by design (Phase 4 activates them by copying into `src/` and dropping the `.example` suffix). Documented in `docs/reference/README.md`.

## Self-Check: PASSED

Verified files exist:
- FOUND: docs/reference/hooks.server.ts.example
- FOUND: docs/reference/+layout.server.ts.example
- FOUND: docs/reference/README.md
- FOUND: docs/reference/login/+page.server.ts.example
- FOUND: docs/reference/login/+page.svelte.example

Verified commits exist:
- FOUND: 7c1a1e2
- FOUND: 970ac9c

## EXECUTION COMPLETE
