---
phase: 04-mobile-reader-ui
plan: 01
subsystem: frontend-bootstrap
tags: [sveltekit, tailwind-v4, shadcn-svelte, supabase-ssr, playwright, vitest, cloudflare-pages]
requires:
  - supabase.public.transactions (created_at column, restaurant_id)
  - supabase.auth.jwt() -> restaurant_id claim (from 0002_auth_hook.sql)
  - docs/reference/*.example files (Phase 1 D-14)
  - scripts/ci-guards.sh (Phase 1 Guard 1 + Guard 2)
provides:
  - SvelteKit 2 + Svelte 5 + adapter-cloudflare app buildable at repo root
  - Reference auth wired in src/ (hooks.server.ts, +layout.server.ts, login routes)
  - public.data_freshness_v (security_invoker view, tenant-scoped via JWT)
  - Hand-rolled shadcn-svelte primitives (button, card, input, label, toggle-group, tooltip)
  - Playwright 375px baseline config + 2 RED e2e stubs
  - Vitest unit lane scoped to tests/unit/ with 15 it.todo card stubs
affects:
  - package.json (adds dev/build/preview/check/test:unit/test:e2e scripts; vitest 1 -> 4; vite 5 -> 8)
  - tsconfig.json (rewritten to extend .svelte-kit/tsconfig.json)
  - .env.example (adds PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_PUBLISHABLE_KEY)
tech-stack:
  added:
    - "@sveltejs/kit@^2"
    - "svelte@^5"
    - "@sveltejs/adapter-cloudflare@^7"
    - "@sveltejs/vite-plugin-svelte@^7"
    - "tailwindcss@^4 + @tailwindcss/vite@^4"
    - "vite@^8, vitest@^4"
    - "@playwright/test + @testing-library/svelte + @testing-library/jest-dom + jsdom"
    - "layerchart, date-fns@^4, lucide-svelte"
    - "clsx, tailwind-merge, tailwind-variants, tw-animate-css"
  patterns:
    - "Tailwind v4 via Vite plugin (no postcss.config); @import \"tailwindcss\" in src/app.css"
    - "@supabase/ssr createServerClient in hooks.server.ts with safeGetSession() gate (getClaims path)"
    - "Root +layout.server.ts rejects missing claims -> redirect(/login); missing restaurant_id -> /not-provisioned"
key-files:
  created:
    - svelte.config.js
    - vite.config.ts
    - tsconfig.json (rewritten)
    - src/app.html
    - src/app.css
    - src/app.d.ts
    - src/hooks.server.ts
    - src/routes/+layout.server.ts
    - src/routes/+layout.svelte
    - src/routes/+page.server.ts
    - src/routes/+page.svelte
    - src/routes/login/+page.svelte
    - src/routes/login/+page.server.ts
    - src/lib/utils.ts
    - src/lib/components/ui/{button,card,input,label,toggle-group,tooltip}.svelte
    - src/lib/components/ui/index.ts
    - components.json
    - supabase/migrations/0014_data_freshness_v.sql
    - playwright.config.ts
    - tests/e2e/layout.spec.ts
    - tests/e2e/chips.spec.ts
    - tests/unit/cards.test.ts
  modified:
    - package.json
    - package-lock.json
    - .env.example
decisions:
  - "shadcn-svelte primitives hand-rolled: the @next CLI hangs on interactive TTY inside the executor sandbox and its pinned registry URL returns HTML (not JSON). Wrote the 6 required primitives (button/card/input/label/toggle-group/tooltip) directly with matching components.json aliases so downstream plans can still run `shadcn-svelte add ...` to extend."
  - "data_freshness_v uses MAX(created_at), not MAX(ingested_at): transactions table exposes created_at (per 0003_transactions_skeleton.sql); ingested_at only lives on staging (0007). Aliased to last_ingested_at so UI contract is stable."
  - "test:unit scoped to `vitest run tests/unit` to avoid re-running legacy integration tests (which need live Supabase env) in the unit lane."
  - "Upgraded vitest 1.6 -> 4.1 and vite 5 -> 8 to satisfy @sveltejs/vite-plugin-svelte@^7 peer. Root project already used vitest, so bumping in-place was cleaner than pinning two major versions."
metrics:
  duration_minutes: 18
  completed: 2026-04-14
  tasks: 2
  files_created: 25
  files_modified: 3
---

# Phase 04 Plan 01: Bootstrap Summary

SvelteKit 2 + Tailwind v4 + Supabase SSR auth + Playwright/Vitest RED scaffold landed; `data_freshness_v` live on DEV.

## What Shipped

**Task 1 (commit `d0f6b3f`) — SvelteKit skeleton + reference auth + migration**

- Installed locked runtime stack: `@sveltejs/kit@^2`, `svelte@^5`, `@sveltejs/adapter-cloudflare@^7`, `@sveltejs/vite-plugin-svelte@^7`, Tailwind v4 (Vite plugin), `layerchart`, `date-fns@^4`, `lucide-svelte`.
- Installed dev stack: `vite@^8`, `vitest@^4`, `svelte-check`, `@playwright/test`, `@testing-library/svelte`, `@testing-library/jest-dom`, `jsdom`.
- `svelte.config.js` uses `adapter-cloudflare` and `$lib` alias.
- `vite.config.ts` loads `tailwindcss()` BEFORE `sveltekit()` (Pitfall 3).
- `src/app.css` is one line: `@import "tailwindcss"` (plus the shadcn OKLCH token block).
- No `postcss.config.*` anywhere in the repo (guarded).
- `src/app.d.ts` declares `App.Locals.supabase` + `safeGetSession`.
- Reference files copied verbatim from `docs/reference/*.example` → `src/` (hooks.server.ts, +layout.server.ts, login/+page.svelte, login/+page.server.ts). CI Guard 2 still green because `hooks.server.ts` has `getClaims()` in the same file.
- Root `+layout.svelte` imports `app.css` and renders children; placeholder `+page.server.ts`/`+page.svelte` so the build has a route (real dashboard lands in 04-02).
- `supabase/migrations/0014_data_freshness_v.sql` created and applied to DEV via `supabase db push`.
- `bash scripts/ci-guards.sh` green, `npm run build` green.

**Task 2 (commit `0ab9dba`) — Test scaffold**

- `playwright.config.ts` at 375×667 iPhone SE viewport with `npm run preview` webServer.
- `tests/e2e/layout.spec.ts` + `tests/e2e/chips.spec.ts` — 2 skipped RED stubs.
- `tests/unit/cards.test.ts` — 15 `it.todo` stubs covering all downstream card contracts (D-04, D-08, D-09, D-10a, D-11, D-14, D-16..D-22).
- `test:unit` script scoped to `tests/unit/` so integration tests stay in their own lane.
- `npm run test:unit` reports `Tests  3 passed | 15 todo (18)`.
- `npx playwright test --list` reports 2 specs.

## Deviations from Plan

### Rule 3 — Blocking tooling issue: `shadcn-svelte@next init` unreachable

- **Found during:** Task 1, step 11.
- **Issue:** The plan prescribes `npx shadcn-svelte@next init --yes --base-color zinc` then `add -y button card input label toggle-group tooltip`. (a) `@next` CLI has no `--yes` flag and hangs on interactive TTY inside the executor sandbox. (b) The pinned `@next` registry URL `https://next.shadcn-svelte.com/registry/index.json` returns HTML (the marketing homepage), not JSON — so even non-interactive invocations error with `SyntaxError: Unexpected token '<'`.
- **Fix:** Wrote `components.json` directly (pointed at the stable registry for future `add` commands), hand-rolled the 6 primitive components under `src/lib/components/ui/`, and installed the shadcn runtime deps (`clsx`, `tailwind-merge`, `tailwind-variants`, `tw-animate-css`) manually. Aliases in `components.json` match the plan spec, so downstream plans can `npx shadcn-svelte@latest add <component>` (stable CLI, which does work) to extend.
- **Commit:** `d0f6b3f`

### Rule 1 — Bug: `ingested_at` column does not exist on `transactions`

- **Found during:** Task 1, step 12 (`supabase db push`).
- **Issue:** Plan prescribes `MAX(t.ingested_at)` in `data_freshness_v`, but `transactions` only has `created_at` (per 0003_transactions_skeleton.sql). `ingested_at` lives on `stg_orderbird_order_items` (staging, 0007).
- **Fix:** Switched to `MAX(t.created_at) AS last_ingested_at` — same semantic (row insertion timestamp), and the output alias is preserved so the UI contract stays stable. Documented inline in the migration file.
- **Commit:** `d0f6b3f`

### Rule 3 — Blocking dep conflict: vite 5 vs vite-plugin-svelte@7 needs vite ^8

- **Found during:** Task 1, npm install.
- **Issue:** Pre-existing `vitest@1.6.1` pinned `vite@^5`, but `@sveltejs/vite-plugin-svelte@7` requires `vite@^8`. `npm install` refused to resolve.
- **Fix:** Bumped `vitest` from `^1.6.1` → `^4.1.4` and `vite` to `^8.0.8`. The existing `vitest.config.ts` (with `css.postcss` stub for parent-dir-postcss-config defense) still works unchanged. Integration tests continue to run under vitest 4 with no code changes.
- **Commit:** `d0f6b3f`

### Auth gates

None. Supabase CLI was already authenticated from Phase 3; no user interaction required.

## Verification

| Check | Result |
| --- | --- |
| `npm run build` | exits 0 (adapter-cloudflare built) |
| `bash scripts/ci-guards.sh` | `All CI guards passed.` |
| `npm run test:unit` | `Tests 3 passed | 15 todo (18)` |
| `npx playwright test --list` | 2 specs (layout, chips) at mobile-chrome project |
| `SELECT * FROM data_freshness_v` on DEV | view exists, security_invoker, tenant-scoped via `auth.jwt() ->> 'restaurant_id'` |
| `components.json` exists | yes, aliases match plan |
| `src/lib/components/ui/button.svelte` exists | yes (plus card, input, label, toggle-group, tooltip) |
| `postcss.config.*` in repo root | absent (globbed, no matches) |

## Requirements Closed

- UI-01: 375px baseline config landed (playwright.config.ts viewport) — RED stub waiting for 04-02 dashboard
- UI-02: mobile-first project skeleton compiles and deploys
- UI-03: Supabase SSR auth wired via reference files
- UI-11: chip URL param contract captured as RED stub

## Known Stubs

Task 1's placeholder `+page.svelte` renders only `<h1>Ramen Bones</h1>` and `+page.server.ts` returns a hardcoded `{ range: '7d', grain: 'week' }`. These are intentional scaffolding to be superseded by 04-02 (dashboard + chip bar + loader). Documented here so the verifier does not flag them as regressions.

## Self-Check: PASSED

- `src/hooks.server.ts` — FOUND
- `src/routes/+layout.server.ts` — FOUND
- `src/routes/login/+page.svelte` — FOUND
- `src/routes/login/+page.server.ts` — FOUND
- `supabase/migrations/0014_data_freshness_v.sql` — FOUND
- `components.json` — FOUND
- `playwright.config.ts` — FOUND
- `tests/unit/cards.test.ts` — FOUND
- commit `d0f6b3f` — FOUND
- commit `0ab9dba` — FOUND
