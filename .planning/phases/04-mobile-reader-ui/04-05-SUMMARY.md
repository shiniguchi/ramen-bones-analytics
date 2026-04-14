---
phase: 04-mobile-reader-ui
plan: 05
subsystem: frontend-frequency-nvr-cards
tags: [sveltekit, svelte5-runes, tailwind-v4, frequency, new-vs-returning, tdd, partial]
requires:
  - src/lib/components/EmptyState.svelte (04-02)
  - src/lib/format.ts formatEUR (04-01)
  - src/routes/+page.server.ts loader shell + kpi + cohort + ltv (04-03, 04-04)
  - src/routes/+page.svelte card stream (04-03)
  - public.frequency_v (03-04 migration 0012)
  - public.new_vs_returning_v (03-04 migration 0012)
provides:
  - src/lib/nvrAgg.ts shapeNvr() (chip-window aggregation for NVR data)
  - src/lib/components/FrequencyCard.svelte (plain-div bars, 5 buckets, no LayerChart)
  - src/lib/components/NewVsReturningCard.svelte (stacked bar + legend with formatEUR)
  - .github/pull_request_template.md (375px screenshot checklist)
  - scripts/verify-viewport.mjs (Playwright 375px overflow check)
affects:
  - src/routes/+page.server.ts (freq + NVR parallel queries, nvrShaped return)
  - src/routes/+page.svelte (FrequencyCard + NewVsReturningCard wired in)
  - tests/unit/cards.test.ts (all 5 todos flipped; 0 todos remain, 33 passing)
  - tests/e2e/layout.spec.ts (screenshot test behind E2E_SCREENSHOTS=1)
tech-stack:
  added:
    - "nvrAgg.ts pure aggregation module — shapeNvr() sums NVR rows per segment, absorbs blackout_unknown into cash_anonymous"
  patterns:
    - "FrequencyCard D-18: plain divs only, no LayerChart; bar width = customer_count/max * 100%"
    - "NewVsReturningCard D-19a: receives pre-shaped data from loader (chip-scoped); stateless component"
    - "shapeNvr() extracted to nvrAgg.ts for pure-function unit testing (mirrors sparseFilter.ts pattern)"
    - "FreshnessLabel tested via static top-level import (not dynamic require) in ESM vitest"
    - "E2E_SCREENSHOTS=1 env gate prevents screenshot test from flaking in CI without baselines"
key-files:
  created:
    - src/lib/nvrAgg.ts
    - src/lib/components/FrequencyCard.svelte
    - src/lib/components/NewVsReturningCard.svelte
    - .github/pull_request_template.md
    - scripts/verify-viewport.mjs
  modified:
    - src/routes/+page.server.ts
    - src/routes/+page.svelte
    - tests/unit/cards.test.ts
    - tests/e2e/layout.spec.ts
decisions:
  - "shapeNvr() absorbs blackout_unknown into cash_anonymous: preserves D-19 tie-out invariant; blackout rows would otherwise break returning+new+cash===revenue assertion"
  - "FreshnessLabel imported statically at top-level: ESM + vitest + vite-plugin-svelte pipeline cannot transform .svelte via require(); static import is the correct pattern"
  - "verify-viewport.mjs exits non-zero on scrollWidth > 375: makes the viewport contract machine-checkable for forkers and CI"
metrics:
  duration_minutes: 4
  completed: 2026-04-14
  tasks: 2
  tasks_total: 3
  status: partial_checkpoint
  files_created: 5
  files_modified: 4
---

# Phase 04 Plan 05: Frequency + NVR Cards, PR Gate, iPhone Checkpoint Summary

FrequencyCard + NewVsReturningCard shipped as plain-div components; all 5 seed todos flipped green; 375px PR gate enforced. PAUSED at Task 3 (human iPhone checkpoint).

## What Shipped

**Task 1 RED (commit `16ec8dd`) — Failing tests**

- `tests/unit/cards.test.ts` — 5 todos replaced with real failing assertions:
  - `FreshnessLabel muted <=30h, yellow >30h, red >48h (D-10a)` — 3 render cases
  - `FrequencyCard uses plain divs not LayerChart (D-18)` — bar + li count assertions
  - `NewVsReturningCard IS chip-scoped (D-19a exception)` — `shapeNvr()` fixture
  - `NewVsReturningCard tie-out: returning + new + cash === revenue (D-19)` — sum assertion
  - `Per-card error fallback does NOT throw whole page (D-22)` — KpiTile null render

**Task 1 GREEN (commit `bb443fe`) — Implementation**

- `src/lib/nvrAgg.ts`:
  - `NvrRow` type (segment + revenue_cents; includes `blackout_unknown`)
  - `NvrShaped` type (3-key: returning, new, cash_anonymous)
  - `shapeNvr(rows)`: sums by segment, absorbs blackout_unknown into cash_anonymous, returns fixed-order array
- `src/lib/components/FrequencyCard.svelte`:
  - Props: `{ data: Array<{ bucket: string; customer_count: number }> }`
  - Plain `<div>` bars — NO layerchart import (D-18)
  - 5 DB buckets mapped to readable labels: `1 visit`, `2 visits`, `3–5 visits`, `6–10 visits`, `11+`
  - EmptyState fallback when data empty
- `src/lib/components/NewVsReturningCard.svelte`:
  - Props: `{ data: Array<{ segment: 'new'|'returning'|'cash_anonymous'; revenue_cents: number }> }`
  - Stacked `<div class="flex h-3">` with bg-blue-600/bg-indigo-300/bg-zinc-200 segments
  - Legend with `formatEUR(cents)` (integer, no decimals)
  - EmptyState when `totals.total === 0`
- `src/routes/+page.server.ts`:
  - `FreqRow` + `NvrRaw` inline types
  - `freqP`: `frequency_v` all-time (chip-independent)
  - `nvrP`: `new_vs_returning_v` filtered by `chipW.from`..`chipW.to` (chip-scoped)
  - Promise.all expanded to 12 queries (was 10)
  - `nvrShaped = shapeNvr(nvrRaw)` computed after await
  - Return shape extended: `frequency`, `newVsReturning`
- `src/routes/+page.svelte`:
  - `FrequencyCard` + `NewVsReturningCard` imported and wired below LtvCard

All 33 unit tests pass, 0 todos remain, `npm run build` clean, CI guards pass.

**Task 2 (commit `58fa698`) — PR template + viewport script**

- `.github/pull_request_template.md`: mandatory 375px iPhone SE checklist for every `src/` PR
- `scripts/verify-viewport.mjs`: Playwright Chromium at 375×667 → screenshot `docs/screenshots/375-dashboard.png`, exits 1 if scrollWidth > 375
- `tests/e2e/layout.spec.ts`: screenshot baseline test behind `E2E_SCREENSHOTS=1` env flag

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] FreshnessLabel tested via static import, not dynamic require()**

- **Found during:** Task 1 GREEN run.
- **Issue:** Test initially used `const FreshnessLabel = require('...FreshnessLabel.svelte').default` inside the test body. In ESM + vitest + vite-plugin-svelte pipeline, `require()` cannot transform `.svelte` files — raises `SyntaxError: Unexpected token '<'`.
- **Fix:** Added `FreshnessLabel` as a static top-level import alongside the other component imports.
- **Files modified:** `tests/unit/cards.test.ts`
- **Commit:** `bb443fe`

### Auth gates

None.

## Verification

| Check | Result |
| --- | --- |
| `npm run build` | exits 0 |
| `bash scripts/ci-guards.sh` | `All CI guards passed.` |
| `npm run test:unit` | `Tests 33 passed (33)` — 0 todos |
| `grep 'from .layerchart' FrequencyCard.svelte` | no match (D-18 enforced) |
| `test -f .github/pull_request_template.md` | FOUND |
| `grep '375' .github/pull_request_template.md` | match |
| `node --check scripts/verify-viewport.mjs` | exits 0 |

## Requirements Closed (partial)

- **UI-08** — Visit frequency distribution: FrequencyCard ships as plain-div list
- **UI-09** — New vs returning stacked bar: NewVsReturningCard ships chip-scoped
- **UI-11** — 375px screenshot gate: PR template + verify-viewport.mjs land

## Open: Task 3 (human checkpoint)

Task 3 is `checkpoint:human-verify` — paused awaiting friend's iPhone sign-off.

**UI-10** (Core Value gate: friend makes real business decision) — pending human checkpoint.

## Known Stubs

None introduced in this plan. All 9 dashboard cards are wired to real view data.

## Self-Check: PASSED

- `src/lib/nvrAgg.ts` — FOUND
- `src/lib/components/FrequencyCard.svelte` — FOUND
- `src/lib/components/NewVsReturningCard.svelte` — FOUND
- `.github/pull_request_template.md` — FOUND
- `scripts/verify-viewport.mjs` — FOUND
- `src/routes/+page.server.ts` (frequency + newVsReturning) — FOUND
- `src/routes/+page.svelte` (FrequencyCard + NewVsReturningCard) — FOUND
- commit `16ec8dd` (RED tests) — FOUND
- commit `bb443fe` (GREEN implementation) — FOUND
- commit `58fa698` (PR template + script) — FOUND
