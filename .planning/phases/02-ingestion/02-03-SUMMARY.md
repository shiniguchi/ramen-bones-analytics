---
phase: 02-ingestion
plan: 03
subsystem: ingest-loader
tags: [typescript, csv, supabase, ingest, pg_cron, tdd-green]
requires:
  - phase: 02-ingestion plan 01 (schema + bucket)
  - phase: 02-ingestion plan 02 (RED test surface)
provides:
  - scripts/ingest/hash.ts — D-07 sha256 card hasher (tenant-salted)
  - scripts/ingest/parse.ts — strict 29-column CSV parser (D-06)
  - scripts/ingest/normalize.ts — staging shaper + invoice-grain reducer
  - scripts/ingest/types.ts — StagingRow / TxRow / IngestReport
  - scripts/ingest/env.ts — D-19/D-20 fail-fast env loader
  - scripts/ingest/download.ts — Storage → text download (D-02/D-13)
  - scripts/ingest/upsert.ts — 500-row chunked upserts for both grains
  - scripts/ingest/report.ts — JSON summary printer (D-18)
  - scripts/ingest/index.ts — runIngest orchestrator + CLI entry
  - npm run ingest script
affects:
  - 02-ingestion plan 04 (integration tests now have a live implementation)
tech-stack:
  added:
    - csv-parse@^6
    - date-fns-tz@^3
  patterns:
    - "card_hash computed on its own line, never co-references wl_* (ci-guard 4)"
    - "Tip-from-first-row (D-12) — never sum tip_eur across item rows"
    - "Invoice-grain reducer drops negative-total groups pre-write (D-11)"
    - "Synthetic row_index PK survives split-bill duplicate rows"
key-files:
  created:
    - scripts/ingest/types.ts
    - scripts/ingest/hash.ts
    - scripts/ingest/parse.ts
    - scripts/ingest/normalize.ts
    - scripts/ingest/env.ts
    - scripts/ingest/download.ts
    - scripts/ingest/upsert.ts
    - scripts/ingest/report.ts
    - scripts/ingest/index.ts
  modified:
    - package.json (adds csv-parse, date-fns-tz, npm run ingest)
key-decisions:
  - "Chunk size 500 for both upserts — ~1KB/row keeps payload under Supabase 1MB cap with 2× headroom while amortizing RTT"
  - "transactions_new vs transactions_updated computed via pre/post count delta on (restaurant_id) filter, not via upsert response rows (supabase-js gives no insert-vs-update signal)"
  - "PAYMENT_MAP is case-insensitive with title-case fallback — unknown processors stay human-readable, known ones canonicalize to MasterCard/Visa/Bar/Amex/Maestro/Girocard"
  - "countTransactions scoped by restaurant_id (not global) so multi-tenant runs don't cross-contaminate the delta"
requirements-completed: [ING-01, ING-02, ING-03, ING-04]
metrics:
  duration: ~8min
  tasks: 2
  files: 10
  completed: 2026-04-14
---

# Phase 02 Plan 03: Ingest Loader Implementation Summary

**One-command CSV→staging→transactions loader: 9 TS modules, 12 unit tests GREEN, card hashing enforced pre-write, fail-fast env + strict parser.**

## Performance

- **Duration:** ~8 min
- **Tasks:** 2
- **Files created:** 9 (scripts/ingest/*.ts)
- **Files modified:** 1 (package.json)

## Accomplishments

- Turned Plan 02 RED test surface GREEN: `hash.test.ts` (4/4) and `normalize.test.ts` (8/8) all pass
- Every D-XX decision the fixture pins to an invoice is enforced in code:
  - T-1/T-11: tip from first row only (D-12)
  - T-3: split-bill synthetic row_index (Pitfall 6)
  - T-4: correction pair gross_cents=0 via invoice-total (D-11)
  - T-5: negative-total invoice dropped (D-11)
  - T-6: missing wl_card_number → NULL card_hash (D-08)
  - T-7: DST fall-back 02:30 Berlin → valid UTC ISO (D-09)
  - T-8: MASTERCARD → MasterCard canonicalization (D-10)
- `npm run ingest` wired; fail-fast exits 1 with full missing-var list
- `bash scripts/ci-guards.sh` green — card_hash + wl_card_number never co-reference on the same line

## Task Commits

1. **Task 1: hash + parse + normalize (TDD GREEN)** — `c37bc75` (feat)
2. **Task 2: env + download + upsert + index orchestrator** — `22a90b7` (feat)

## Final Module Boundaries & Export Shapes

| Module         | Exports                                                                      | Purpose                                     |
| -------------- | ---------------------------------------------------------------------------- | ------------------------------------------- |
| `types.ts`     | `StagingRow`, `TxRow`, `IngestReport`                                        | Shared shapes                               |
| `hash.ts`      | `hashCard(wl, rid)`                                                          | D-07 sha256 + tenant salt                   |
| `parse.ts`     | `parseCsv(text)`, `ORDERBIRD_COLUMNS`                                        | Strict 29-col validator                     |
| `normalize.ts` | `toStagingRows`, `toTransactions`, `toBerlinUtc`, `normalizePaymentMethod`   | Shape + reduce + tz + canonicalize          |
| `env.ts`       | `loadEnv()`, `IngestEnv`                                                     | D-19/D-20 fail-fast                         |
| `download.ts`  | `downloadCsv(client, bucket, object)`                                        | Service-role Storage read                   |
| `upsert.ts`    | `upsertStaging`, `upsertTransactions`, `countTransactions`                   | Chunked writes + delta                      |
| `report.ts`    | `printReport`, `emptyReport`                                                 | JSON summary                                |
| `index.ts`     | `runIngest({ dryRun? })` + CLI                                               | Orchestrator                                |

## Chunk Size Decision

Chose **500 rows per batch** for both staging and transactions upserts.

- Staging rows are ~1 KB each (text columns), so 500 rows ≈ 500 KB per request — half the Supabase 1 MB payload ceiling, leaving headroom for header overhead and variable-width columns.
- Transactions rows are ~200 bytes each; 500 is trivially under the cap but still amortizes round-trips.
- Chose one constant rather than per-table tuning to keep the loader readable.

## Deviations from RESEARCH

**1. transactions_new vs transactions_updated counting**

RESEARCH proposed using the upsert response row count. In practice, `@supabase/supabase-js` v2 gives no insert-vs-update signal in the default upsert response. Implemented the pragmatic fallback named in the plan: `pre = count(restaurant_id)`, `post = count(restaurant_id)`, `new = post - pre`, `updated = tx.length - new`. Scoped by `restaurant_id` so multi-tenant runs don't leak counts.

**2. cash_rows_excluded semantics**

The plan defined "cash_rows_excluded" loosely. Settled on: **count of raw CSV rows with blank `wl_card_number`** — captures T-2 (explicit cash) + T-9 (blank `is_cash`, inferred cash) + T-6 (missing-wl card row). The `missing_worldline_rows` counter separately isolates the card-intended subset (`payment_method != Bar`).

## Cohort-loss observation

Against the synthetic fixture (the real CSV is not yet available — EXT-07 sit-with-founder is still pending per STATE.md), `missing_worldline_rows = 1` (just T-6). Once the real CSV is ingested this counter becomes the canonical cohort-loss metric the Phase 3 retention model must caveat.

## Deviations from Plan

None beyond the two items in "Deviations from RESEARCH" above. Plan steps executed in order.

## Issues Encountered

None. RED→GREEN transition was clean on first run:

```
✓ tests/ingest/hash.test.ts  (4 tests) 10ms
✓ tests/ingest/normalize.test.ts  (8 tests) 60ms
Test Files  2 passed (2)
Tests  12 passed (12)
```

`ci-guards.sh` passed without modification. Fail-fast env loader verified by running `env -i npx tsx scripts/ingest/index.ts --dry-run` → exit 1 with the full missing-vars list.

## Known Stubs

None. Every export has a real implementation driven by the Plan 02 test surface.

## Files Created / Modified

| File                           | Action   | Commit    |
| ------------------------------ | -------- | --------- |
| `scripts/ingest/types.ts`      | created  | c37bc75   |
| `scripts/ingest/hash.ts`       | created  | c37bc75   |
| `scripts/ingest/parse.ts`      | created  | c37bc75   |
| `scripts/ingest/normalize.ts`  | created  | c37bc75   |
| `scripts/ingest/env.ts`        | created  | 22a90b7   |
| `scripts/ingest/download.ts`   | created  | 22a90b7   |
| `scripts/ingest/upsert.ts`     | created  | 22a90b7   |
| `scripts/ingest/report.ts`     | created  | 22a90b7   |
| `scripts/ingest/index.ts`      | created  | 22a90b7   |
| `package.json`                 | modified | c37bc75   |

## Self-Check: PASSED

- FOUND: scripts/ingest/types.ts
- FOUND: scripts/ingest/hash.ts
- FOUND: scripts/ingest/parse.ts
- FOUND: scripts/ingest/normalize.ts
- FOUND: scripts/ingest/env.ts
- FOUND: scripts/ingest/download.ts
- FOUND: scripts/ingest/upsert.ts
- FOUND: scripts/ingest/report.ts
- FOUND: scripts/ingest/index.ts
- FOUND commit c37bc75
- FOUND commit 22a90b7
- 12/12 unit tests GREEN
- ci-guards.sh exits 0
- fail-fast env loader verified (exit 1 with full missing-list)

## Next Phase Readiness

Plan 02-04 (integration tests against TEST Supabase) now has a live `runIngest` implementation to drive. ING-01 (staging 1:1), ING-02 (idempotent upsert), ING-03 (normalize), ING-04 (hash) are code-complete; 02-04 will prove ING-02/05 against a real DB.

---
*Phase: 02-ingestion*
*Completed: 2026-04-14*
