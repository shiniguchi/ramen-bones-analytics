# Phase 11-02 Execution Summary

**Plan:** `11-02-PLAN.md` — Defer 4 lifetime-unbounded queries off SSR to `/api/*` endpoints via `LazyMount` + `clientFetch`
**Wave:** 2 (depends on 11-01)
**Executed:** 2026-04-21 (executor agent hit usage limit after code commits landed; SUMMARY backfilled by orchestrator after verification)

## What changed

### New files
- `src/lib/clientFetch.ts` — SWR-style in-memory cached fetch keyed by query params
- `src/lib/components/LazyMount.svelte` — `IntersectionObserver`-gated mount with `onvisible` callback prop (single mandated idiom — no `{@const _ = ...}` alternative)
- `src/routes/api/kpi-daily/+server.ts` — deferred endpoint serving `kpi_daily_v` rows
- `src/routes/api/customer-ltv/+server.ts` — deferred endpoint serving `customer_ltv_v`
- `src/routes/api/repeater-lifetime/+server.ts` — deferred endpoint; honors `?days=` contract per D-03 (server-side day-of-week filter when subset of 1..7)
- `src/routes/api/retention/+server.ts` — deferred endpoint returning `{ weekly, monthly }` via single `Promise.all`
- `tests/unit/clientFetch.test.ts` — cache behavior pinning
- `tests/unit/apiEndpoints.test.ts` — auth + Cache-Control + `?days=` contract tests

### Modified files
- `src/routes/+page.server.ts` — removed `dailyKpiP`, `customerLtvP`, `repeaterTxP`, `retentionP`, `retentionMonthlyP` from the SSR `Promise.all`. SSR now runs 6 queries (freshness + dailyRows + priorDailyRows + itemCounts + benchmark{Anchors,Sources} + insight) instead of 11.
- `src/routes/+page.svelte` — added `<LazyMount onvisible={...}>` wrappers around below-fold cards (retention, cohort, LTV histogram, repeater) that trigger the deferred fetches.
- `src/lib/components/CohortRetentionCard.svelte` — additive reactive `monthsOfHistory` prop (permitted per 11-02 plan — not in user's protected file set).

### Auth & security enforcement
- Every new `/api/*/+server.ts` uses `const { claims } = await locals.safeGetSession()` (canonical pattern from `src/hooks.server.ts:27-35`). No direct `getClaims()` calls.
- Every endpoint sets `Cache-Control: private, no-store` on every `json(...)` response — prevents CF edge from serving tenant-scoped data cross-tenant.

### Commits
- `11a158a` — fix(11-ssr-perf-recovery/11-02): add LazyMount + clientFetch primitives (Task 1)
- `9c889c0` — fix(11-ssr-perf-recovery/11-02): 4 deferred /api/* endpoints (Task 2)
- `7b93a76` — fix(11-ssr-perf-recovery/11-02): atomic SSR cleanup + client LazyMount wiring (Task 3)

## Verification

- **Plan-scoped tests:** `npm test -- tests/unit/{dateRange,filters,supabasePagination,clientFetch,apiEndpoints,pageServerLoader}.test.ts --run` → **6 files / 90 tests passed** (0 failures).
- **Build:** `npm run build` → `✓ built in 12.36s` via `@sveltejs/adapter-cloudflare`. Worker bundle compiles cleanly.
- **Protected files:** verified untouched. `git status` still shows only the pre-existing M-marks on `Calendar{Counts,ItemRevenue,Items,Revenue}Card.svelte`, `dashboardStore.svelte.ts`, `CalendarCards.test.ts`.
- **Pre-existing failures:** 16 failing tests in the full suite (`sparseFilter`, `CalendarCards`, `CohortRetentionCard`, `ci-guards`). Confirmed pre-existing by running `npm test --run` with user's uncommitted work stashed — same failure count before and after 11-02. Details in `deferred-items.md`.
- **CI Guard 1 noise:** `cohortAgg.ts` comment-only false-positive pre-existing. Logged in `deferred-items.md`.

## Production smoke check

**Deferred to after 11-03 + deploy.** The three production curls from CONTEXT.md will run once 11-03 lands and the GH Actions deploy workflow re-pins.

## Deviations

None noted by the executor agent. The atomic Task 3 (SSR cleanup + client wiring) landed in a single commit as required — no non-compiling intermediate. The monthsOfHistory "no visual regression" D-04 compliance was preserved via the additive `CohortRetentionCard` prop + client-side `differenceInMonths(today, earliest.cohort_week)` derivation.

---

*Plan: 11-02*
*Orchestrator note: SUMMARY backfilled post-usage-limit. All three code commits landed cleanly before the budget hit.*
