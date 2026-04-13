---
phase: 02-ingestion
plan: 01
subsystem: database
tags: [supabase, postgres, rls, storage, migrations, pii]

requires:
  - phase: 01-foundation
    provides: tenancy schema, transactions skeleton, ci-guards
provides:
  - stg_orderbird_order_items staging table (29 CSV cols + 3 audit cols)
  - synthetic PK (restaurant_id, invoice_number, row_index) for split-bill safety
  - tip_cents/payment_method/sales_type extensions on transactions
  - private orderbird-raw storage bucket with service-role-only read policy
  - extended PII manifest covering 6 Worldline/card columns
  - orderbird_data/ gitignore entry
affects: [02-ingestion loader plan, 03-analytics MVs, ingestion CI]

tech-stack:
  added: [supabase storage policies]
  patterns:
    - "All CSV mirror columns stored as text; type coercion happens in loader TS (D-06)"
    - "Synthetic row_index PK to survive split-bill duplicate item rows"
    - "RLS via JWT restaurant_id claim on every staging table"

key-files:
  created:
    - supabase/migrations/0007_stg_orderbird_order_items.sql
    - supabase/migrations/0008_transactions_columns.sql
    - supabase/migrations/0009_storage_bucket.sql
  modified:
    - pii-columns.txt
    - .gitignore

key-decisions:
  - "Synthetic PK (restaurant_id, invoice_number, row_index) chosen over natural composite to handle split-bill duplicate item rows in invoice 1-211 (RESEARCH Pitfall 6)"
  - "All 29 CSV mirror columns typed as text — strict parsing deferred to loader TS (D-06)"
  - "Storage bucket policy targets service_role only; authenticated/anon rely on default-deny"

patterns-established:
  - "Staging tables: text-typed mirrors + RLS + tenant FK + audit columns (ingested_at, source_file)"
  - "PII manifest grows alongside scraper schema — guard 4 enforces no card_hash join"

requirements-completed: [ING-01, ING-02, ING-03, ING-04]

duration: 6min
completed: 2026-04-14
---

# Phase 02 Plan 01: Ingestion Schema Surface Summary

**Staging table, transactions extensions, private CSV bucket, and PII manifest update — Phase 2 loader has all DB targets ready.**

## Performance

- **Duration:** ~6 min
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Created `stg_orderbird_order_items` with synthetic-row-index PK that survives split-bill duplicates
- Extended `transactions` with `tip_cents`, `payment_method`, `sales_type` (all nullable, skeleton-test safe)
- Provisioned private `orderbird-raw` Supabase Storage bucket with service-role read policy
- Appended six Worldline/card columns to `pii-columns.txt` so guard 4 protects them structurally
- Excluded `orderbird_data/` from git so raw CSVs never get committed

## Task Commits

1. **Task 1: stg_orderbird_order_items migration (0007)** — `d54e98e` (feat)
2. **Task 2: transactions cols + bucket + PII manifest + gitignore** — `15f65b6` (feat)

## Files Created/Modified

- `supabase/migrations/0007_stg_orderbird_order_items.sql` — Item-level CSV mirror, RLS, synthetic PK
- `supabase/migrations/0008_transactions_columns.sql` — tip_cents/payment_method/sales_type ALTER
- `supabase/migrations/0009_storage_bucket.sql` — Private orderbird-raw bucket + service-role policy
- `pii-columns.txt` — 6 new PII column entries (wl_*, card_last4, card_txn_id)
- `.gitignore` — orderbird_data/ excluded

## Decisions Made

- **Synthetic PK over natural composite:** invoice 1-211 in real CSV samples has duplicate item rows under split-bill scenarios — natural PK would lose data. row_index is generated per-invoice during load.
- **Text-only CSV mirror columns:** Lets loader handle blank `is_cash` (Pitfall 7) and other edge cases without DB-side cast errors. The DB is the audit mirror, not the source of typed truth.
- **Service-role-only storage read:** Authenticated/anon roles get no policy → default-deny applies. Explicit policy documents intent.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. CI guards passed on first run after each task.

## Self-Check: PASSED

Files verified:
- supabase/migrations/0007_stg_orderbird_order_items.sql FOUND
- supabase/migrations/0008_transactions_columns.sql FOUND
- supabase/migrations/0009_storage_bucket.sql FOUND
- pii-columns.txt updated (wl_card_number present)
- .gitignore updated (orderbird_data/ present)

Commits verified:
- d54e98e FOUND
- 15f65b6 FOUND

## Next Phase Readiness

Plan 02-02 (loader-core) can `supabase db push` against the TEST project and find every target table, column, and bucket pre-staged. ING-01/02/03/04 schema obligations satisfied.

---
*Phase: 02-ingestion*
*Completed: 2026-04-14*
