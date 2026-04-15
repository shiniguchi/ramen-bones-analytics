---
phase: 07-column-promotion
plan: 01
subsystem: tests
tags: [tdd, wave-0, red-scaffold, dm-01, dm-02, dm-03, flt-05]
requirements: [DM-01, DM-02, DM-03, FLT-05]
dependency-graph:
  requires: [phase-06-filter-foundation]
  provides: [wave-0-red-scaffold, canonicalizeCardType-contract, country-filter-contract]
  affects: [tests/ingest, tests/unit, tests/integration, tests/ingest/fixtures/sample.csv]
tech-stack:
  added: []
  patterns: [describe.skip-with-TODO, testing-library/svelte-deferred-import, supabase-chain-mock]
key-files:
  created:
    - tests/ingest/schema.test.ts
    - tests/ingest/backfill.test.ts
    - tests/unit/filters-country.test.ts
    - tests/unit/country-multiselect.test.ts
    - tests/integration/filter-country-loader.test.ts
  modified:
    - tests/ingest/normalize.test.ts
    - tests/ingest/idempotency.test.ts
    - tests/ingest/loader.test.ts
    - tests/ingest/fixtures/sample.csv
decisions:
  - "Wave 0 tests land with describe.skip + TODO(07-0X) markers so CI stays green; downstream waves flip them on as production code ships."
  - "Fixture extended in-place (sample.csv 24→30 rows) instead of separate card-types.csv to keep fixture story single-sourced per D-07 planning note."
metrics:
  duration: "~20min"
  tasks: 2
  files: 9
  completed: "2026-04-16"
---

# Phase 7 Plan 01: Wave 0 RED Scaffold Summary

Failing/skipped tests landed for every Phase 7 requirement (DM-01, DM-02, DM-03, FLT-05) before any production code. Mirrors the Phase 2/3/4/5/6 TDD entry pattern. Waves 1-3 flip these tests GREEN one-by-one.

## Tasks Completed

| Task | Name | Commit | Key files |
|---|---|---|---|
| 1 | RED scaffold for DM-01/DM-02/DM-03 (backend + loader) | `2be09f7` | schema.test.ts, backfill.test.ts, normalize.test.ts, idempotency.test.ts, sample.csv |
| 2 | RED scaffold for FLT-05 (filter schema + UI + SSR) | `6e22356` | filters-country.test.ts, country-multiselect.test.ts, filter-country-loader.test.ts, loader.test.ts |

## Test Inventory (wave flip targets)

| File | Wave flip target | Mechanism |
|---|---|---|
| `tests/ingest/schema.test.ts` | 07-02 | `describe.skip` — unskip when migration 0019 lands |
| `tests/ingest/backfill.test.ts` | 07-02 | `describe.skip` — unskip after DISTINCT ON backfill runs |
| `tests/ingest/normalize.test.ts` (canonicalizeCardType block) | 07-03 | `describe.skip` — unskip when `canonicalizeCardType` exported from normalize.ts |
| `tests/ingest/idempotency.test.ts` (new block) | 07-03 | `it.skip` column-existence guard |
| `tests/unit/filters-country.test.ts` | 07-04 | `describe.skip` — unskip when `country` field added to filters.ts zod schema |
| `tests/unit/country-multiselect.test.ts` | 07-04 | `describe.skip` — unskip when CountryMultiSelect.svelte lands |
| `tests/integration/filter-country-loader.test.ts` | 07-04 | `describe.skip` — unskip when +page.server.ts composes the country WHERE clause |

## Fixture extension

`tests/ingest/fixtures/sample.csv` gained 6 invoice-grain rows to cover canonical card-type buckets plus the POS-fallback path:

| Invoice | wl_card_type | card_type (POS) | wl_issuing_country | Expected canonical | Role |
|---|---|---|---|---|---|
| T-VISA | Visa | Visa | DE | `visa` | Visa happy path |
| T-MC | MasterCard | MasterCard | AT | `mastercard` | non-DE country |
| T-GIRO | girocard | girocard | DE | `girocard` | girocard mapping |
| T-UNK | *(empty)* | *(empty, cash)* | *(empty)* | `unknown` | Cash / blackout |
| T-OTHER | Diners | Diners | FR | `other` | long-tail bucket + FR |
| T-FALLBACK | *(empty)* | Visa | *(empty)* | `visa` | POS fallback path |

Staging count pin bumped `24 → 30` across `normalize.test.ts` + `loader.test.ts`. Transactions count pin bumped `15 → 21` in loader.test.ts (T-UNK is cash, all 5 other new invoices produce card transactions).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Extended fixture broke hard-coded loader.test.ts pins**
- **Found during:** Task 1 verification
- **Issue:** `tests/ingest/loader.test.ts` pinned `rows_read=24`, `staging_upserted=24`, `count=24`, transactions `count=15`. Adding 6 rows to sample.csv broke all four assertions.
- **Fix:** Bumped pins to 30/30/30/21. The transactions count math: 16 original invoices − 1 dropped (T-5 negative) + 6 new − 0 dropped = 21. T-UNK stays in transactions because cash invoices are not filtered out of the transactions table (only `cash_rows_excluded` diagnostic counter tracks them).
- **Files modified:** tests/ingest/loader.test.ts
- **Commit:** `6e22356`

**2. [Rule 1 - Bug] T-FALLBACK fixture row initially set wl_card_number blank**
- **Found during:** Task 1 verification loop
- **Issue:** First draft of T-FALLBACK row left `wl_card_number` empty, which would have bumped `missing_worldline_rows` from 1 → 2 and broken that pin in loader.test.ts. The intent of T-FALLBACK is to test the POS-fallback path for `card_type`, which only needs `wl_card_type` + `wl_issuing_country` blank — `wl_card_number` should still be populated.
- **Fix:** Set `wl_card_number=482510xxxxxxxxx0022` and left only `wl_card_type`, `wl_payment_type`, `wl_issuing_country` empty on T-FALLBACK.
- **Files modified:** tests/ingest/fixtures/sample.csv
- **Commit:** `2be09f7`

## Known Stubs

None. Every file is either pure test code or a fixture row; no UI stubs were introduced.

## Verification

- `npm run test -- --run tests/ingest/schema.test.ts tests/ingest/backfill.test.ts tests/ingest/normalize.test.ts tests/ingest/idempotency.test.ts` — 12 passed, 7 skipped (after Task 1 commit)
- `npm run test -- --run tests/unit/filters-country.test.ts tests/unit/country-multiselect.test.ts tests/integration/filter-country-loader.test.ts` — 0 passed, 16 skipped, 0 failed
- `npm run test -- --run tests/ingest/loader.test.ts tests/ingest/normalize.test.ts tests/ingest/idempotency.test.ts` — 15 passed, 2 skipped, 0 failed
- Full-suite pre-existing failures (e2e, supabase edge function lanes, infra-dependent integration tests) are unrelated to this plan — failing count dropped from 18 → 3 after loader.test.ts pin fix. The 3 remaining are Playwright e2e and edge-function Deno tests that do not run in this vitest lane.

## Self-Check: PASSED

- [x] tests/ingest/schema.test.ts FOUND
- [x] tests/ingest/backfill.test.ts FOUND (subsequently rewritten by 07-02 — expected hand-off)
- [x] tests/unit/filters-country.test.ts FOUND
- [x] tests/unit/country-multiselect.test.ts FOUND
- [x] tests/integration/filter-country-loader.test.ts FOUND
- [x] Commit `2be09f7` present in `git log`
- [x] Commit `6e22356` present in `git log`
