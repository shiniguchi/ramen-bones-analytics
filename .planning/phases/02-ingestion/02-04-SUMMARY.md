---
phase: 02-ingestion
plan: 04
subsystem: ingest-loader
tags: [typescript, vitest, supabase, integration-test, csv, dev-run, uat]
requires:
  - phase: 02-ingestion plan 01 (schema + bucket)
  - phase: 02-ingestion plan 02 (RED test surface)
  - phase: 02-ingestion plan 03 (loader implementation)
provides:
  - GREEN loader integration test (tests/ingest/loader.test.ts)
  - GREEN idempotency integration test (tests/ingest/idempotency.test.ts)
  - Real CSV ingest run against DEV Supabase (20,948 stg / 6,842 tx)
  - 02-04-REAL-RUN.md report with dry-run + write-mode + idempotency + post-fix runs
  - Founder ING-05 human-verify sign-off ("approved")
  - Pass-through payment_method contract (upstream CSV is canonical)
  - Per-line net_cents computation (mixed-tax correct)
  - Migration 0009 auto-provisions orderbird-raw storage bucket in any environment
  - README ingestion docs section
affects:
  - phase: 03-analytics (can read transactions + stg_orderbird_order_items with confidence)
  - phase: 03-analytics (April 2026 Worldline blackout is a documented reporting caveat)
tech-stack:
  added: []
  patterns:
    - "Integration tests bootstrap TEST project state via service-role adminClient + scoped truncation"
    - "Upstream CSV is single source of truth for payment_method casing — loader is trim-only pass-through"
    - "Per-line net_cents via Σ round(item_gross_cents / (1 + rate/100)) — mixed-rate safe"
    - "Storage buckets created via idempotent SQL migration, not manual dashboard steps (forkability)"
key-files:
  created:
    - .planning/phases/02-ingestion/02-04-REAL-RUN.md
    - supabase/migrations/0009_storage_bucket.sql
  modified:
    - tests/ingest/loader.test.ts
    - tests/ingest/idempotency.test.ts
    - tests/ingest/fixtures/README.md
    - scripts/ingest/normalize.ts
    - tests/ingest/normalize.test.ts
    - README.md
key-decisions:
  - "Payment method casing normalized upstream in the CSV generator, not in loader — one source of truth, DB byte-matches CSV"
  - "net_cents computed per line item and summed, not at invoice grain with first-row rate — mixed 7%/19% invoices would otherwise skew ~15%"
  - "April 2026 data ingested but excluded from all reporting aggregates; upstream Worldline join blackout 2026-04-01..04-11 documented as open item for Phase 3"
  - "orderbird-raw bucket created via migration 0009 (idempotent DDL) — forkers get it automatically on supabase db push"
  - "missing_worldline_rows is a diagnostic counter, not an exclusion gate — those invoices land in transactions with card_hash=NULL"
patterns-established:
  - "Integration tests seed TEST project restaurant_id via admin query (never hardcoded literal); env overridden in beforeAll from TEST_* pair"
  - "Storage buckets provisioned via migration for full-stack reproducibility"
requirements-completed: [ING-01, ING-02, ING-03, ING-04, ING-05]
duration: ~55min
completed: 2026-04-14
---

# Phase 02 Plan 04: Ingest UAT Summary

**Loader proven GREEN against TEST + DEV with real 20,948-row CSV, founder-signed-off on ≥25 real-row semantics, two correctness fixes landed mid-run (pass-through payment_method + per-line net_cents), and April Worldline blackout documented as a Phase 3 reporting caveat.**

## Performance

- **Duration:** ~55 min (across Tasks 1+2; Task 3 was human-verify wait)
- **Tasks:** 3 (2 auto + 1 checkpoint)
- **Files created:** 2 (02-04-REAL-RUN.md, 0009_storage_bucket.sql)
- **Files modified:** 6

## Accomplishments

- **Task 1 — Integration tests GREEN** against TEST Supabase project. `tests/ingest/loader.test.ts` proves ING-01 (row counts, tip-from-first-row, card-hash presence, missing_worldline_rows=1). `tests/ingest/idempotency.test.ts` proves ING-02 via zero-diff md5 hash across two runs. Tests seed restaurant_id from the 0005 seed via adminClient; skip cleanly when TEST env is missing.
- **Task 2 — Real CSV ingest against DEV.** 20,948 staging rows / 6,842 transactions from `ramen_bones_order_items.csv` (2025-06-11..2026-04-11). Idempotency reverified on real data (second run `transactions_new=0`, row counts stable). Two correctness fixes landed mid-run (see Deviations). README gained an `## Ingestion` section covering prerequisites, dry-run/write workflow, and report field meanings.
- **Task 3 — Founder ING-05 sign-off received** ("approved"). ≥25 top-grossing invoices cross-checked against CSV in Supabase DEV SQL editor; gross_eur, tip_eur, payment_method casing, card_hash presence, and Europe/Berlin wall-clock conversion all match.

## Task Commits

1. **Task 1: Integration tests GREEN** — `59bbf87` (test)
2. **Task 2a: Real CSV ingest run + README docs** — `127cd37` (feat)
3. **Task 2b: Pass-through payment_method + re-ingest** — `3b1a6f6` (fix)
4. **Task 2c: Per-line net_cents + April-excluded report** — `eb54ca9` (fix)
5. **Task 3: Founder ING-05 sign-off** — no code change; documented here
6. **STATE/plan close (this commit)** — docs

## Key Artifacts

- **Loader:** `scripts/ingest/index.ts`, `scripts/ingest/normalize.ts`, `scripts/ingest/parse.ts`, `scripts/ingest/hash.ts`, `scripts/ingest/upsert.ts`, `scripts/ingest/download.ts`, `scripts/ingest/env.ts`, `scripts/ingest/report.ts`, `scripts/ingest/types.ts`
- **Tests:** `tests/ingest/loader.test.ts`, `tests/ingest/idempotency.test.ts`, `tests/ingest/normalize.test.ts`, `tests/ingest/fixtures/README.md`
- **Migrations:** `supabase/migrations/0007_stg_orderbird_order_items.sql`, `supabase/migrations/0008_transactions_columns.sql`, `supabase/migrations/0009_storage_bucket.sql`
- **Run report:** `.planning/phases/02-ingestion/02-04-REAL-RUN.md` — full dry-run + 4 write-mode JSON reports, scoped vs unscoped row tables, payment method distribution, top-5 spot check, all corrections

## Real-Run Headline Numbers

| Metric | Value |
| --- | --- |
| `rows_read` | 20,948 |
| `invoices_deduped` (→ transactions) | 6,842 |
| `staging_upserted` | 20,948 |
| `missing_worldline_rows` | 772 |
| `cash_rows_excluded` | 4,478 |
| `errors` | 0 |
| Runtime per full run | ~12s |

Scoped to Jun 11 2025 – Mar 31 2026 (Berlin) — April excluded: 20,059 stg / 6,546 tx / 5,271 card / 1,275 non-card.

## Decisions Made

- **Upstream CSV is canonical for payment_method casing.** Loader `PAYMENT_MAP` removed in favor of trim-only pass-through. Principle: one source of truth, DB byte-matches CSV. Unit test `T-8` updated to pin pass-through.
- **`net_cents` computed per line item, not per invoice.** The initial single-rate formula (first row's `tax_rate_pct` applied to `invoice_total_eur`) was correct for single-rate invoices but skewed for mixed 7%/19% food+drink invoices. Rewrite sums `round(item_gross_cents / (1 + rate/100))` per line. 1,775 mixed-tax invoices were rewritten on re-ingest; three spot-checked by hand match DB exactly.
- **April 2026 excluded from reporting aggregates.** Upstream Orderbird→Worldline join breaks for 2026-04-01..04-11 window. All 20,948 rows still ingested (loader does not filter); only the reporting aggregates in 02-04-REAL-RUN.md use `[2025-06-11, 2026-03-31]` Berlin.
- **`missing_worldline_rows` is diagnostic, not exclusionary.** Those invoices persist to `transactions` with `card_hash=NULL` (correction vs initial plan wording). Revenue totals are unaffected; only cohort/retention linkage is lost for that subset.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] DEV orderbird-raw bucket missing**
- **Found during:** Task 2a (first upload attempt)
- **Issue:** DEV project had no `orderbird-raw` storage bucket; `scripts/ingest/upload-csv.ts` failed with 404.
- **Fix:** Added `supabase/migrations/0009_storage_bucket.sql` — idempotent DDL-level bucket creation. Forkers get the bucket on `supabase db push`, no manual dashboard step.
- **Verification:** Bucket created via migration, CSV upload succeeded (5,255,383 bytes confirmed).
- **Committed in:** `127cd37`

**2. [Rule 1 — Bug] `payment_method` case-map vs authoritative source**
- **Found during:** Task 2a (post-ingest review)
- **Issue:** Loader's `PAYMENT_MAP` introduced a second source of truth for casing. Upstream CSV had casing duplicates (e.g. `mastercard`/`MasterCard`). Best fix: normalize at source, make loader byte-faithful.
- **Fix:** Upstream CSV generator normalized to 9 canonical payment values. Loader switched to trim-only pass-through. Unit test `T-8` updated from `MASTERCARD → MasterCard` to pin pass-through behavior. Re-ingested (third write-mode run); 1,196 rows updated.
- **Committed in:** `3b1a6f6`

**3. [Rule 1 — Bug] `net_cents` wrong for mixed-tax invoices**
- **Found during:** Task 2a (post-ingest review)
- **Issue:** Initial formula computed `net_cents` at invoice grain using first-row `tax_rate_pct`. For invoices mixing food (7%) and drinks (19%) — standard ramen-shop pattern — net was skewed.
- **Fix:** `scripts/ingest/normalize.ts` now sums per-line integer-cents: `net_cents = Σ round(item_gross_cents_i / (1 + rate_i/100))`. Unit test adds mixed-rate T-11 case (15€@7% + 10€@7% + 20€@19% → 4,018 cents, not 4,673). Re-ingested (fourth run); 1,775 mixed-tax invoices rewritten. Three random invoices hand-verified.
- **Committed in:** `eb54ca9`

**4. [Rule 3 — Blocking] DEV DB migration gap**
- **Found during:** Task 2a (pre-ingest)
- **Issue:** Migrations 0007/0008 not yet applied to DEV DB when real ingest started.
- **Fix:** Applied via `supabase db push` before ingest. Resolved in-line.
- **Committed in:** (no code change — DB state only)

---

**Total deviations:** 4 auto-fixed (3 Rule 1/3, 1 environment). All essential for correctness; none introduced scope creep.

## Deferred Items — Phase 3

- **Worldline blackout 2026-04-01..04-11** — upstream Orderbird→Worldline join breaks in the tail window. NOT a loader bug; out of scope for Phase 2. Phase 3 must either filter April at reporting time or wait for the upstream feed to be restored. Founder aware.
- Cohort/retention/LTV analytics lose `card_hash` customer linkage for the 772 `missing_worldline_rows`. Acceptable per ING-05 sign-off; must be caveated in Phase 4 UI.

## Issues Encountered

- Mid-run discovery of the mixed-tax `net_cents` bug and the upstream casing duplicates both triggered full re-ingests. All resolved in the same execution session; no data loss (upsert path overwrote affected tuples).
- DEV DB migration gap caught pre-ingest, resolved by applying 0007/0008 before first write run.

## User Setup Required

None — all setup (bucket, migrations, env vars) documented in README `## Ingestion` section and `.env.example`.

## Next Phase Readiness

- Phase 3 (Analytics SQL) can begin. `transactions` and `stg_orderbird_order_items` are trustworthy for the Jun 11 2025 – Mar 31 2026 window on real DEV data.
- ING-01 through ING-05 all satisfied and checkmarked.
- April 2026 caveat must be surfaced in Phase 3 MV/reporting logic.

## Self-Check: PASSED

- FOUND: .planning/phases/02-ingestion/02-04-REAL-RUN.md
- FOUND: supabase/migrations/0009_storage_bucket.sql
- FOUND: scripts/ingest/normalize.ts
- FOUND: tests/ingest/loader.test.ts
- FOUND: tests/ingest/idempotency.test.ts
- FOUND commit 59bbf87 (Task 1)
- FOUND commit 127cd37 (Task 2a)
- FOUND commit 3b1a6f6 (Task 2b — pass-through)
- FOUND commit eb54ca9 (Task 2c — net_cents fix)
- Founder ING-05 sign-off: "approved"

---
*Phase: 02-ingestion*
*Completed: 2026-04-14*
