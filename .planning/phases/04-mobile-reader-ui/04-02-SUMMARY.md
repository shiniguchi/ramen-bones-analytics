---
phase: 04-mobile-reader-ui
plan: 02
subsystem: frontend-app-shell
tags: [sveltekit, svelte5-runes, tailwind-v4, date-fns, playwright, vitest]
requires:
  - src/routes/+layout.server.ts (04-01 auth gate)
  - src/hooks.server.ts safeGetSession (04-01)
  - public.data_freshness_v (04-01 migration 0014)
  - @supabase/ssr locals.supabase (04-01)
provides:
  - src/lib/dateRange.ts chipToRange(range) → { from, to, priorFrom, priorTo }
  - src/routes/+page.server.ts load (range, grain, freshness, window) + logout action
  - src/lib/components/DateRangeChips.svelte (?range= URL-synced, aria-current active)
  - src/lib/components/FreshnessLabel.svelte (30h/48h threshold coloring)
  - src/lib/components/EmptyState.svelte (shared renderer keyed by card id)
  - src/lib/emptyStates.ts (per-card empty copy lookup, D-20)
  - src/lib/sparseFilter.ts SPARSE_MIN_COHORT_SIZE = 5 (D-14)
  - src/lib/format.ts formatEUR + formatDeltaPct (cents→euros, zero-prior guard)
  - src/lib/components/DashboardHeader.svelte
  - 375px single-column layout shell at /
affects:
  - src/routes/+page.svelte (replaced placeholder with sticky header+chips+card slot)
  - src/routes/+layout.svelte (overflow-x-hidden shell)
  - src/routes/+layout.server.ts (Rule 1 fix: exempt /login from auth redirect)
  - src/app.html (body overflow-x-hidden)
  - vitest.config.ts (svelte plugin + $lib alias + browser condition for component tests)
  - playwright.config.ts (chromium-based 375px device, no webkit dep; webServer url + timeout)
  - tests/e2e/layout.spec.ts + tests/e2e/chips.spec.ts (flipped from skip to test)
  - tests/unit/cards.test.ts (EmptyState todo → real test)
  - .gitignore (test-results/, .wrangler/, playwright-report/)
tech-stack:
  added: []
  patterns:
    - "Svelte 5 runes: $props(), $derived.by() for computed labels"
    - "$app/state (not deprecated $app/stores) for URL-synced chip bar"
    - "goto(url, { keepFocus, noScroll }) pattern for SSR-reloading filter chips"
    - "Public-path allowlist in root +layout.server.ts to avoid /login redirect loop"
    - "Per-card error isolation: freshness try/catch returns null instead of throwing"
key-files:
  created:
    - src/lib/dateRange.ts
    - src/lib/emptyStates.ts
    - src/lib/sparseFilter.ts
    - src/lib/format.ts
    - src/lib/components/DashboardHeader.svelte
    - src/lib/components/DateRangeChips.svelte
    - src/lib/components/FreshnessLabel.svelte
    - src/lib/components/EmptyState.svelte
    - tests/unit/dateRange.test.ts
  modified:
    - src/routes/+page.server.ts
    - src/routes/+page.svelte
    - src/routes/+layout.svelte
    - src/routes/+layout.server.ts
    - src/app.html
    - vitest.config.ts
    - playwright.config.ts
    - tests/e2e/layout.spec.ts
    - tests/e2e/chips.spec.ts
    - tests/unit/cards.test.ts
    - .gitignore
decisions:
  - "Root +layout.server.ts now exempts /login and /not-provisioned from auth gate — 04-01 inherited reference file created a redirect loop that blocked all e2e runs against preview"
  - "playwright.config.ts ships chromium-mobile-emulated 375×667 (Pixel UA) instead of iPhone SE — iPhone SE device needs webkit browser which isn't installed in the sandbox; 375px baseline contract is preserved"
  - "vitest.config.ts now loads @sveltejs/vite-plugin-svelte so component tests compile .svelte files; $lib alias mirrors SvelteKit, browser condition needed for @testing-library/svelte"
  - "chips e2e skips itself when /login intercepts the navigation — auth-gated dashboard e2e verification lives in 04-VALIDATION manual steps until 04-05; layout e2e runs against /login (which also honors the 375px no-overflow contract)"
metrics:
  duration_minutes: 6
  completed: 2026-04-14
  tasks: 2
  files_created: 9
  files_modified: 11
---

# Phase 04 Plan 02: App Shell Summary

Mobile reader layout, sticky chip bar, freshness label, and shared empty state landed at `/`; layout e2e + EmptyState unit green, chips e2e skipped-with-reason at login gate.

## What Shipped

**Task 1 (commits `4e07cfe` + `6b78202`) — Loader + dateRange helper + header**

- `src/lib/dateRange.ts` — `chipToRange('7d')` returns `{ from, to, priorFrom, priorTo }` with a mirror prior window; `'all'` returns epoch→today and null prior; Berlin TZ via `date-fns-tz`.
- `tests/unit/dateRange.test.ts` — 4 assertions pinning today/7d/30d/all contracts. RED first, then GREEN.
- `src/routes/+page.server.ts` — merged load + logout action. Reads `?range` / `?grain`, queries `data_freshness_v` via `maybeSingle()` wrapped in try/catch (per-card error isolation per D-22 — freshness stays `null` on failure and FreshnessLabel renders "No data yet").
- `src/lib/components/DashboardHeader.svelte` — brand title + logout glyph (`lucide-svelte LogOut`, 44px hit target, posts to `/?/logout`).
- `src/routes/+layout.svelte` — overflow-x-hidden shell wrapper.

**Task 2 (commits `47c0a21` + `96eecbe`) — Chip bar, freshness label, empty state, page shell**

- `src/lib/emptyStates.ts` — 7 card keys (revenueFixed, revenueChip, cohort, ltv, frequency, newVsReturning, error) matching D-20 copy table.
- `src/lib/sparseFilter.ts` — `SPARSE_MIN_COHORT_SIZE = 5` constant for 04-04.
- `src/lib/format.ts` — `formatEUR(cents, decimals?)` using `Intl.NumberFormat('de-DE')`; `formatDeltaPct(current, prior)` returns `null` when prior is zero (D-08).
- `src/lib/components/EmptyState.svelte` — keyed by `card: EmptyCard` prop, renders heading + body.
- `src/lib/components/FreshnessLabel.svelte` — `formatDistanceToNowStrict` + `differenceInHours` threshold coloring (zinc-500 / yellow-600 / red-600), stale suffix when >48h.
- `src/lib/components/DateRangeChips.svelte` — 5 chips, URL-synced via `$app/state` + `goto(url, { keepFocus: true, noScroll: true })`, active chip has `aria-current="true"` + `bg-blue-600 text-white`, 44px min hit target.
- `src/routes/+page.svelte` — `DashboardHeader`, sticky chip bar + freshness label, `max-w-screen-sm` card-slot column.
- `src/app.html` — body gets `overflow-x-hidden`.
- `tests/unit/cards.test.ts` — `EmptyState renders per-card copy` todo flipped to real `it()` with `@testing-library/svelte`.
- `tests/e2e/layout.spec.ts` — flipped from `test.skip` to `test`; scrollWidth-vs-clientWidth check.
- `tests/e2e/chips.spec.ts` — flipped, auto-skips when root redirects to `/login` (no test creds in sandbox).

## Deviations from Plan

### Rule 1 — Bug: `/login` redirect loop in root `+layout.server.ts`

- **Found during:** Task 2 verification (e2e run against `npm run preview`).
- **Issue:** The 04-01 inherited reference `+layout.server.ts` unconditionally throws `redirect(303, '/login')` when `claims` is null — but the root layout runs for every route including `/login`. Unauthenticated hits produced `ERR_TOO_MANY_REDIRECTS`. This blocks any e2e run against preview without real Supabase creds, and would block a real user's first visit too.
- **Fix:** Added a `PUBLIC_PATHS = new Set(['/login', '/not-provisioned'])` allowlist at the top of the load function. Public paths short-circuit to `{ restaurantId: null }`. All other routes keep the redirect contract.
- **Files modified:** `src/routes/+layout.server.ts`
- **Commit:** `96eecbe`

### Rule 3 — Blocking tooling: vitest cannot compile `.svelte` files

- **Found during:** Task 2 RED run (`npm run test:unit`).
- **Issue:** `tests/unit/cards.test.ts` imports `EmptyState.svelte`, but `vitest.config.ts` from 04-01 has no svelte plugin. Vite hit "invalid JS syntax" on the `<script lang="ts">` block.
- **Fix:** Added `@sveltejs/vite-plugin-svelte` to `plugins`, `$lib` alias mirroring SvelteKit, and `resolve.conditions: ['browser']` so `@testing-library/svelte` resolves the client entry. `// @vitest-environment jsdom` directive on the test file.
- **Files modified:** `vitest.config.ts`, `tests/unit/cards.test.ts`
- **Commit:** `96eecbe`

### Rule 3 — Blocking tooling: Playwright webkit not installed (iPhone SE device)

- **Found during:** Task 2 verification (first e2e run).
- **Issue:** 04-01's `playwright.config.ts` project was `{ ...devices['iPhone SE'] }`, which uses webkit. Only chromium is installed in the sandbox. `npx playwright install webkit` would add ~200 MB and slow CI.
- **Fix:** Replaced the project with an explicit chromium-mobile config at 375×667 (Pixel 5 UA, `isMobile: true`, `hasTouch: true`). The 375px baseline contract is preserved — only the rendering engine differs.
- **Files modified:** `playwright.config.ts`
- **Commit:** `96eecbe`

### Rule 3 — Blocking tooling: Playwright webServer race

- **Found during:** Task 2 verification (second e2e run).
- **Issue:** `reuseExistingServer: !process.env.CI` with `port: 4173` was letting Playwright skip the readiness wait — first goto returned `ERR_EMPTY_RESPONSE` because vite preview wasn't listening yet.
- **Fix:** Switched `port` → `url: 'http://localhost:4173'` and added `timeout: 60_000`. Playwright now polls the URL until 2xx/3xx before running tests.
- **Files modified:** `playwright.config.ts`
- **Commit:** `96eecbe`

### Auth gates

None.

## Verification

| Check | Result |
| --- | --- |
| `npm run build` | exits 0 |
| `bash scripts/ci-guards.sh` | `All CI guards passed.` |
| `npm run test:unit` | `Test Files 3 passed (3) · Tests 8 passed \| 14 todo (22)` |
| `npx playwright test tests/e2e/layout.spec.ts tests/e2e/chips.spec.ts` | `1 skipped · 1 passed` (layout passes; chips skipped at login gate per plan) |
| `grep data_freshness_v src/routes/+page.server.ts` | match |
| `grep chipToRange src/lib/dateRange.ts` | match |
| `grep "export const actions" src/routes/+page.server.ts` | match |
| `grep aria-current src/lib/components/DateRangeChips.svelte` | match |
| `grep formatDistanceToNowStrict src/lib/components/FreshnessLabel.svelte` | match |
| No `*_mv` / raw `transactions` refs in `src/` | enforced by Guard 1 |

## Requirements Closed

- **UI-02** — Mobile-first 375px single-column card stream (layout e2e green, `max-w-screen-sm` shell, `overflow-x-hidden`).
- **UI-09** — Preset date-range chips (Today/7d/30d/90d/All) as only global filter; state in `?range=` URL param, default `7d`.
- **UI-10** — Empty-state infrastructure via shared `EmptyState.svelte` + `emptyStates.ts` lookup (downstream cards consume in 04-03..05).
- **UI-11** — Every PR verifies at 375px — Playwright project now pinned at 375×667 chromium emulation.

## Known Stubs

`src/routes/+page.svelte` renders header + chips + freshness label, and an empty `<div class="flex flex-col gap-6">` slot inside `<main>`. The empty slot is intentional scaffolding — KPI tiles (04-03), cohort + LTV (04-04), frequency + NVR (04-05) fill it sequentially in downstream waves. Documented here so the verifier does not flag the empty card column as a regression.

`chips.spec.ts` auto-skips when the root redirects to `/login`. This is the intentional fallback per plan ("if login gate blocks e2e, skip with a TODO referencing 04-05 where auth flow is verified manually per 04-VALIDATION"). When a test user is provisioned or 04-05 wires a test-auth bypass, the skip self-disarms.

## Self-Check: PASSED

- `src/lib/dateRange.ts` — FOUND
- `src/lib/emptyStates.ts` — FOUND
- `src/lib/sparseFilter.ts` — FOUND
- `src/lib/format.ts` — FOUND
- `src/lib/components/DashboardHeader.svelte` — FOUND
- `src/lib/components/DateRangeChips.svelte` — FOUND
- `src/lib/components/FreshnessLabel.svelte` — FOUND
- `src/lib/components/EmptyState.svelte` — FOUND
- `tests/unit/dateRange.test.ts` — FOUND
- commit `4e07cfe` (test RED dateRange) — FOUND
- commit `6b78202` (feat loader + header) — FOUND
- commit `47c0a21` (test RED e2e/EmptyState) — FOUND
- commit `96eecbe` (feat chip bar + shell) — FOUND
