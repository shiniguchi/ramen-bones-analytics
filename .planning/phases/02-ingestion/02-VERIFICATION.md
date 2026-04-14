---
phase: 02-ingestion
verified: 2026-04-14T02:50:00Z
status: passed
score: 5/5 requirements verified
re_verification: null
---

# Phase 02: Ingestion Verification Report

**Phase Goal:** Turn the pre-joined Orderbird CSV into a trustworthy, idempotent `transactions` + `stg_orderbird_order_items` dataset on Supabase, with `card_hash` computed pre-write and founder sign-off on real-row semantics.

**Verified:** 2026-04-14
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth                                                                              | Status     | Evidence                                                                                              |
| --- | ---------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| 1   | Loader reads real CSV and upserts both grains end-to-end                            | VERIFIED   | 02-04-REAL-RUN.md: 20,948 stg / 6,842 tx / 0 errors; `npm run ingest` wired via package.json:12      |
| 2   | Ingest is idempotent — second run produces zero new tx rows                         | VERIFIED   | REAL-RUN 2nd/3rd/4th runs: `transactions_new=0`; integration test idempotency.test.ts asserts counts  |
| 3   | Normalization handles tips (D-12), mixed-tax net (per-line), correction pairs, DST  | VERIFIED   | normalize.ts:79-142 + 11 unit tests GREEN; per-line net_cents fix applied to 1,775 mixed-tax invoices |
| 4   | card_hash = sha256(wl_card_number ‖ restaurant_id) computed pre-write; NULL on cash | VERIFIED   | hash.ts:8-14 (createHash sha256 + trim-empty → null); 4 hash unit tests GREEN; ci-guards.sh PASS     |
| 5   | Founder reviewed ≥20 real rows (ING-05 human sign-off)                               | VERIFIED   | 02-04-SUMMARY.md line 70: "approved"; top-5 spot-check in REAL-RUN.md lines 119-133                  |
| 6   | PII stays in staging; wl_* columns never co-referenced with card_hash               | VERIFIED   | ci-guards.sh PASS (all 5 guards); pii-columns.txt has 6 wl_*/card_* entries; normalize.ts:120-124 comment documents line separation |
| 7   | Synthetic row_index PK survives split-bill duplicate rows                            | VERIFIED   | staging row count (20,948) exactly equals rows_read on real data; normalize.ts:31-36 assigns 1..N per invoice |

**Score:** 7/7 truths verified

### Required Artifacts

| Artifact                                              | Expected                                          | Status      | Details                                        |
| ----------------------------------------------------- | ------------------------------------------------- | ----------- | ---------------------------------------------- |
| supabase/migrations/0007_stg_orderbird_order_items.sql | Staging table + synthetic PK + RLS tenant policy   | VERIFIED    | 52 lines; PK (restaurant_id, invoice_number, row_index); RLS policy stg_tenant_read; 29 CSV cols mirrored |
| supabase/migrations/0008_transactions_columns.sql     | ALTER transactions: tip_cents, payment_method, sales_type | VERIFIED    | 12 lines; three columns added with comments    |
| supabase/migrations/0009_storage_bucket.sql           | Private orderbird-raw bucket + service-role policy | VERIFIED    | 13 lines; `public=false`; service_role SELECT policy |
| pii-columns.txt                                        | 6 wl_*/card_* entries                             | VERIFIED    | All 6 entries present                          |
| .gitignore                                             | orderbird_data/ entry                             | VERIFIED    | Entry present                                  |
| tests/ingest/fixtures/sample.csv                      | 29-col header + ≥24 rows                          | VERIFIED    | 25 lines, 11 scenarios documented              |
| tests/ingest/fixtures/README.md                       | Founder semantic reference                        | VERIFIED    | 42 lines                                       |
| scripts/ingest/hash.ts                                 | createHash sha256, tenant-salted, null-safe       | VERIFIED    | 14 lines, matches D-07/D-08                    |
| scripts/ingest/parse.ts                                | Strict 29-col csv-parse                           | VERIFIED    | 65 lines                                       |
| scripts/ingest/normalize.ts                            | toStagingRows + toTransactions + per-line net     | VERIFIED    | 142 lines; per-line net_cents loop :109-116    |
| scripts/ingest/upsert.ts                               | Batched upserts with onConflict                   | VERIFIED    | 72 lines; chunk=500; both onConflict keys correct |
| scripts/ingest/index.ts                                | Orchestrator + dryRun + CLI entry                 | VERIFIED    | 97 lines; runIngest exported; CLI wired        |
| scripts/ingest/env.ts, download.ts, report.ts, types.ts | Supporting modules                                | VERIFIED    | 37/19/22/69 lines — all non-stub               |
| package.json ingest script                            | `"ingest": "tsx scripts/ingest/index.ts"`         | VERIFIED    | package.json:12                                |
| tests/ingest/hash.test.ts                              | GREEN                                             | VERIFIED    | 4 tests GREEN                                  |
| tests/ingest/normalize.test.ts                         | GREEN                                             | VERIFIED    | 11 tests GREEN                                 |
| tests/ingest/loader.test.ts                            | Integration test exists                           | VERIFIED    | 111 lines; drives runIngest against TEST; skip-safe |
| tests/ingest/idempotency.test.ts                       | Integration test exists                           | VERIFIED    | 98 lines; double-run + row count assertions    |
| .planning/phases/02-ingestion/02-04-REAL-RUN.md        | Real CSV run report                               | VERIFIED    | Dry-run + 4 write-mode JSON reports + scoped tables + corrections |
| README.md ## Ingestion section                         | Docs appended                                     | VERIFIED    | README.md:65                                   |

### Key Link Verification

| From                        | To                                | Via                                        | Status | Details                                               |
| --------------------------- | --------------------------------- | ------------------------------------------ | ------ | ----------------------------------------------------- |
| stg_orderbird_order_items   | restaurants                       | restaurant_id FK + RLS                     | WIRED  | 0007.sql:7 references + :48 RLS + :50 policy          |
| ci-guards.sh                | pii-columns.txt                   | dynamic manifest read                      | WIRED  | ci-guards.sh PASS (all 5 guards green)                |
| scripts/ingest/index.ts     | supabase.storage.download          | service-role client (D-02)                 | WIRED  | index.ts:29-33 → download.ts; real-run proved working |
| scripts/ingest/normalize.ts | scripts/ingest/hash.ts            | hashCard called pre-write                  | WIRED  | normalize.ts:124 `hashCard(rawWl, restaurantId)`      |
| scripts/ingest/upsert.ts    | transactions table                | upsert onConflict restaurant_id,source_tx_id | WIRED  | upsert.ts:49; idempotency proved on real data         |
| scripts/ingest/upsert.ts    | stg_orderbird_order_items         | upsert onConflict ...,row_index             | WIRED  | upsert.ts:20                                          |
| loader.test.ts              | TEST Supabase                     | adminClient() + env override                | WIRED  | loader.test.ts:4-65                                   |

### Data-Flow Trace (Level 4)

| Artifact                  | Data Variable       | Source                              | Produces Real Data | Status   |
| ------------------------- | ------------------- | ----------------------------------- | ------------------ | -------- |
| transactions table (DEV)  | 6,842 rows          | parseCsv → toTransactions → upsert  | Yes (real CSV)     | FLOWING  |
| stg_orderbird_order_items | 20,948 rows         | parseCsv → toStagingRows → upsert   | Yes (real CSV)     | FLOWING  |
| card_hash column          | non-null on card tx | hashCard(wl_card_number, rid)       | Yes (5,271 scoped) | FLOWING  |
| net_cents column          | per-line sum        | normalize.ts:109-116 loop            | Yes (1,775 mixed-tax fixed) | FLOWING  |
| tip_cents column          | first-row only      | normalize.ts:118                    | Yes (spot-checked) | FLOWING  |
| payment_method column     | pass-through trim   | normalize.ts:18-20                  | Yes (9 canonical values, byte-identical to CSV) | FLOWING  |

### Behavioral Spot-Checks

| Behavior                                            | Command                                                       | Result                      | Status |
| --------------------------------------------------- | ------------------------------------------------------------- | --------------------------- | ------ |
| Unit tests (hash + normalize)                       | `npx vitest run tests/ingest/hash.test.ts tests/ingest/normalize.test.ts` | 15/15 passed (2 files)      | PASS   |
| CI guards (including guard 4: card_hash + PII)      | `bash scripts/ci-guards.sh`                                   | "All CI guards passed."     | PASS   |
| Anti-pattern scan (TODO/FIXME in scripts/ingest/)   | grep scripts/ingest                                          | No matches                  | PASS   |
| Real-data DB sanity (from REAL-RUN.md)              | staging=20948, tx=6842, errors=0                              | Matches report              | PASS   |
| Idempotency (from REAL-RUN.md)                      | `transactions_new=0` on 2nd/3rd/4th runs                     | Confirmed                   | PASS   |
| Loader/idempotency integration tests                | User reports 4 GREEN against TEST Supabase                    | Reported GREEN              | PASS (user-reported) |

### Requirements Coverage

| Requirement | Source Plan(s)        | Description                                                                                      | Status    | Evidence                                                                                          |
| ----------- | --------------------- | ------------------------------------------------------------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------- |
| ING-01      | 02-01, 02-02, 02-03, 02-04 | Loader reads pre-joined CSV and upserts to stg_orderbird_order_items                        | SATISFIED | 0007 migration + index.ts orchestrator + real-run proof (20,948 stg rows)                         |
| ING-02      | 02-01, 02-02, 02-03, 02-04 | Idempotent via (restaurant_id, source_tx_id) — re-runs produce zero diff                    | SATISFIED | upsert.ts onConflict + REAL-RUN 2nd-4th runs show `transactions_new=0`; idempotency.test.ts GREEN |
| ING-03      | 02-01, 02-02, 02-03   | Normalization promotes staging → transactions with tips/brutto/netto/corrections/sales_type     | SATISFIED | 0008 columns + normalize.ts:79-142 + 11 normalize tests GREEN + per-line net_cents fix           |
| ING-04      | 02-01, 02-02, 02-03   | card_hash = sha256(wl_card_number ‖ restaurant_id) computed pre-write; NULL for cash            | SATISFIED | hash.ts:8-14 + pii-columns.txt + ci-guards guard 4 PASS + 4 hash tests GREEN                     |
| ING-05      | 02-02, 02-04          | Founder manually reviewed ≥20 real rows to confirm field semantics                              | SATISFIED | 02-04-SUMMARY.md "approved"; top-5 (+25 via SQL editor) spot-check in REAL-RUN.md; fixture README as reference |

**Orphaned requirements check:** REQUIREMENTS.md maps ING-01..05 to "Phase 2 — Ingestion". All 5 IDs appear in at least one plan's `requirements:` frontmatter. No orphans.

### Anti-Patterns Found

None.

- No TODO/FIXME/XXX/HACK/PLACEHOLDER in `scripts/ingest/**`
- No `return null`/`return {}` stubs in loader modules (each function has substantive body)
- No `console.log(wl_card_number|card_last4|card_txn_id)` — upsert.ts error messages log only row_index + invoice_number (verified by ci-guards)
- No hardcoded empty arrays flowing to render — all data sourced from parseCsv → normalize → upsert

### Human Verification Required

None. ING-05 founder sign-off already received ("approved" — 02-04-SUMMARY.md line 70) with ≥25 real rows cross-checked against the DEV SQL editor.

### Known Upstream Issue (Not a Gap)

**Worldline blackout 2026-04-01..2026-04-11** — documented in 02-04-REAL-RUN.md Correction (c) and 02-04-SUMMARY.md "Deferred Items". Upstream Orderbird→Worldline join breaks in this tail window, producing 772 `missing_worldline_rows`. NOT a loader bug; those invoices still land in transactions with `card_hash=NULL`. Phase 3 must caveat. This is a data-source limitation, not a phase 02 gap.

### Gaps Summary

None. All 5 requirements (ING-01..ING-05) satisfied, all 7 observable truths verified, all required artifacts present and substantive, all key links wired, data flows on real 20,948-row CSV, automated tests GREEN, CI guards green, founder sign-off received.

Phase 2 goal achieved: the loader is a one-command path from a Supabase Storage CSV object to populated `stg_orderbird_order_items` + `transactions`, idempotent, byte-correct on real data, with PII confined to staging and tenant-salted card hashing pre-write. Phase 3 (Analytics SQL) can proceed.

---

_Verified: 2026-04-14_
_Verifier: Claude (gsd-verifier)_
