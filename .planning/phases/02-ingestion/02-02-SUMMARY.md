---
phase: 02-ingestion
plan: 02
subsystem: ingest-tests
tags: [tests, fixtures, vitest, ingest, wave-0, tdd-red]
requires:
  - tests/helpers/supabase.ts (Phase 1)
  - tests/setup.ts (Phase 1)
provides:
  - tests/ingest/fixtures/sample.csv
  - tests/ingest/fixtures/README.md
  - tests/ingest/hash.test.ts
  - tests/ingest/normalize.test.ts
  - tests/ingest/loader.test.ts
  - tests/ingest/idempotency.test.ts
affects:
  - vitest.config.ts (added css.postcss stub)
tech_stack:
  added: []
  patterns:
    - "Wave-0 RED stubs reference loader modules that Plan 03 will create"
    - "Synthetic-fixture-as-spec: every D-XX decision pinned to a CSV row"
key_files:
  created:
    - tests/ingest/fixtures/sample.csv
    - tests/ingest/fixtures/README.md
    - tests/ingest/hash.test.ts
    - tests/ingest/normalize.test.ts
    - tests/ingest/loader.test.ts
    - tests/ingest/idempotency.test.ts
  modified:
    - vitest.config.ts
key_decisions:
  - "Stub PostCSS plugins in vitest.config.ts to neutralize stray ~/postcss.config.js in parent directory"
metrics:
  duration: ~10min
  tasks: 2
  files: 6
  completed: 2026-04-14
---

# Phase 02 Plan 02: Ingest test surface (wave 0 RED) Summary

Built the deterministic test surface for the CSV ingest loader before any loader
code exists. The fixture pins every D-XX decision and RESEARCH pitfall to a
named invoice; the four vitest stubs import from `scripts/ingest/*` modules that
Plan 03 will create. Result: wave 0 satisfied — every Plan 03/04 task can point
its `<automated>` verify at one of these test files.

## What Was Built

### 1. Fixture CSV — `tests/ingest/fixtures/sample.csv`

24 data rows + 29-column header matching the real Orderbird export. Hand-built
from observations in `02-RESEARCH.md`; all values synthetic (no PAN/PII).

### 2. Fixture Scenario Map — `tests/ingest/fixtures/README.md`

The ING-05 founder sign-off artifact. Documents each invoice against its D-XX
decision and RESEARCH pitfall.

| Invoice         | D-XX             | Pitfall   | Exercises                                                        |
| --------------- | ---------------- | --------- | ---------------------------------------------------------------- |
| T-1             | D-12             | —         | Normal 2-line INHOUSE Visa, tip=3.00 repeated per row            |
| T-2             | D-08, D-11       | —         | TAKEAWAY cash, blank wl_card_number, is_cash=True                |
| T-3             | D-07             | Pitfall 6 | Split-bill: two IDENTICAL Ramen rows, distinct order_id          |
| T-4             | D-11             | —         | Correction pair (+/− Kimchi, +/− Ramen), invoice_total=0.00     |
| T-5             | D-11             | —         | Negative-total invoice — must DROP from transactions             |
| T-6             | D-08             | Pitfall 2 | Card row, blank wl_card_number → NULL card_hash + counter       |
| T-7             | D-09             | Pitfall 4 | DST fall-back 2025-10-26 02:30 Berlin → first-occurrence UTC    |
| T-8             | D-10             | —         | `MASTERCARD` uppercase → normalize to `MasterCard`              |
| T-9             | D-08             | Pitfall 7 | Blank is_cash, payment_method=Bar → infer cash                  |
| T-10 (ex-T-4)   | D-07             | —         | Recovered-invoice number with space + parens, stored verbatim   |
| T-11            | D-12             | —         | Tip 5.00 repeated on 3 rows → tx tip_cents=500 (NOT 1500)       |
| T-12..T-16      | —                | —         | Padding "normal" baseline rows                                   |

### 3. Four RED Test Files

- `hash.test.ts` (ING-04): null/empty → null, deterministic sha256, tenant salt
- `normalize.test.ts` (ING-01/03): split-bill PK survival, correction-pair net,
  negative-total drop, tip-dedupe, `MASTERCARD` → `MasterCard`, DST validity,
  missing-wl → NULL card_hash
- `loader.test.ts` (ING-01/02): `runIngest` report counters; row-count assertions
  against TEST Supabase (skips when `TEST_SUPABASE_URL` is unset)
- `idempotency.test.ts` (ING-02/05): two-run zero-diff (skips when env unset)

## Expected RED Baseline (the bar Plan 03 must beat)

```
$ npx vitest run tests/ingest/

❯ tests/ingest/idempotency.test.ts (0 test)
❯ tests/ingest/hash.test.ts (0 test)
❯ tests/ingest/loader.test.ts (0 test)
❯ tests/ingest/normalize.test.ts (0 test)

FAIL  tests/ingest/hash.test.ts
  Failed to load url ../../scripts/ingest/hash
FAIL  tests/ingest/idempotency.test.ts
  Failed to load url ../../scripts/ingest/index
FAIL  tests/ingest/loader.test.ts
  Failed to load url ../../scripts/ingest/index
FAIL  tests/ingest/normalize.test.ts
  Failed to load url ../../scripts/ingest/parse

Test Files  4 failed (4)
```

This is the wave-0 success state. Plan 03 turns every "Failed to load url" into
a green tick by creating `scripts/ingest/{hash,parse,normalize,index}.ts`.

## Decisions Made

- **Stub PostCSS plugins in vitest.config.ts** — A stray `~/postcss.config.js`
  in a parent directory was crashing every vitest invocation with
  `Cannot find module 'tailwindcss'` because Vite walks upward looking for a
  postcss config. Setting `css: { postcss: { plugins: [] } }` in the project's
  vitest config short-circuits the search. Affects all test runs project-wide.
- **`it.skip` (not `it.todo`) for DB tests** — when `TEST_SUPABASE_URL` is unset
  the loader/idempotency suites skip rather than todo, matching the Phase 1
  pattern in `tests/helpers/supabase.ts`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking issue] Vitest could not load any test file**

- **Found during:** Task 2 verify
- **Issue:** `npx vitest run tests/ingest/` failed with
  `Failed to load PostCSS config: Cannot find module 'tailwindcss'` because Vite
  walked upward and found `/Users/shiniguchi/postcss.config.js` (a stray host
  file outside the repo). This blocked verification of the wave-0 RED signal.
- **Fix:** Added `css: { postcss: { plugins: [] } }` to `vitest.config.ts` so
  Vite uses an inline empty postcss config instead of searching parent dirs.
- **Files modified:** `vitest.config.ts`
- **Commit:** `a7714d9`

### Verify-Command Note

Plan's `<automated>` for Task 2 greps for `Cannot find module`. Vite/Vitest 1.6
emits the semantically-equivalent `Failed to load url ../../scripts/ingest/...`.
Same wave-0 RED signal; Plan 03 should accept either string.

## Files Created / Modified

| File                                     | Action  | Commit  |
| ---------------------------------------- | ------- | ------- |
| `tests/ingest/fixtures/sample.csv`       | created | ca40a2e |
| `tests/ingest/fixtures/README.md`        | created | ca40a2e |
| `tests/ingest/hash.test.ts`              | created | a7714d9 |
| `tests/ingest/normalize.test.ts`         | created | a7714d9 |
| `tests/ingest/loader.test.ts`            | created | a7714d9 |
| `tests/ingest/idempotency.test.ts`       | created | a7714d9 |
| `vitest.config.ts`                       | modified| a7714d9 |

## Verification

- [x] `wc -l tests/ingest/fixtures/sample.csv` → 25 (1 header + 24 data rows)
- [x] `head -1 sample.csv | tr , \\n | wc -l` → 29 columns
- [x] `ls tests/ingest/fixtures/sample.csv tests/ingest/*.test.ts` → 5 files
- [x] `npx vitest run tests/ingest/` → 4 files executed, all RED on missing
      `scripts/ingest/*` imports

## Self-Check: PASSED

- FOUND: `tests/ingest/fixtures/sample.csv`
- FOUND: `tests/ingest/fixtures/README.md`
- FOUND: `tests/ingest/hash.test.ts`
- FOUND: `tests/ingest/normalize.test.ts`
- FOUND: `tests/ingest/loader.test.ts`
- FOUND: `tests/ingest/idempotency.test.ts`
- FOUND commit `ca40a2e` (fixture + README)
- FOUND commit `a7714d9` (4 test stubs + vitest config fix)
