# 02-04 Real CSV Ingestion Run (DEV)

**Date:** 2026-04-14
**Environment:** DEV (`paafpikebsudoqxwumgm.supabase.co`)
**Source CSV:** `orderbird_data/5-JOINED_DATA_20250611_20260411/ramen_bones_order_items.csv`
**Bucket object:** `orderbird-raw/dev/ramen_bones_order_items.csv` (5,255,455 bytes — post-normalization re-upload)
**Restaurant ID:** `ba1bf707-aae9-46a9-8166-4b6459e6c2fd`
**Date range in CSV:** 2025-06-11 → 2026-04-11

## Reports

### Dry-run (baseline, no writes)

```json
{"rows_read":20948,"invoices_deduped":6842,"staging_upserted":0,"transactions_new":0,"transactions_updated":0,"cash_rows_excluded":4478,"missing_worldline_rows":772,"errors":0}
```

### First write-mode run

```json
{"rows_read":20948,"invoices_deduped":6842,"staging_upserted":20948,"transactions_new":6842,"transactions_updated":0,"cash_rows_excluded":4478,"missing_worldline_rows":772,"errors":0}
```

### Second write-mode run (idempotency proof)

```json
{"rows_read":20948,"invoices_deduped":6842,"staging_upserted":20948,"transactions_new":0,"transactions_updated":6842,"cash_rows_excluded":4478,"missing_worldline_rows":772,"errors":0}
```

### Third write-mode run (post-normalization re-ingest, 2026-04-14)

After collapsing casing duplicates in the source CSV (see Corrections below) and
switching the loader to pass-through, the CSV was re-uploaded and re-ingested.

```json
{"rows_read":20948,"invoices_deduped":6842,"staging_upserted":20948,"transactions_new":0,"transactions_updated":6842,"cash_rows_excluded":4478,"missing_worldline_rows":772,"errors":0}
```

Idempotent: `transactions_new=0` because every `(restaurant_id, source_tx_id)`
already existed from the prior run; the upsert path overwrote the ~1,196 rows
whose `payment_method` text flipped to the canonical CSV casing (e.g. `Visa
Electron`, `V PAY`, `Debit Mastercard`).

Runtime: ~12s per full-CSV run.

**Idempotency verdict:** PASS. Second run produces `transactions_new=0` and physical row counts are unchanged (see verification below). `transactions_updated=6842` reflects the upsert path touching every row with byte-identical values — this is expected because we do not diff before upserting; the natural key `(restaurant_id, source_tx_id)` collides and Postgres re-writes the tuple with the same values.

## Row count verification (REST, post-run)

| Table                                                 | Count  | Expected             |
| ----------------------------------------------------- | ------ | -------------------- |
| `stg_orderbird_order_items` (restaurant-scoped)       | 20,948 | = rows_read          |
| `transactions` (restaurant-scoped)                    | 6,842  | = invoices_deduped   |
| `transactions WHERE card_hash IS NOT NULL`            | 5,271  | all card invoices    |
| `transactions WHERE card_hash IS NULL`                | 1,571  | 6842 − 5271          |

### Payment method distribution (DB vs CSV, post-normalization)

Post re-ingest verification: DB `transactions.payment_method` distribution
matches CSV invoice-grain distribution exactly — 9 values, 6,842 invoices,
byte-identical counts.

| payment_method      | DB count | CSV count | Match |
| ------------------- | -------- | --------- | ----- |
| MasterCard          | 2,448    | 2,448     | ✓     |
| Visa                | 2,248    | 2,248     | ✓     |
| Bar                 | 1,318    | 1,318     | ✓     |
| Maestro             | 469      | 469       | ✓     |
| Visa Electron       | 354      | 354       | ✓     |
| Debit Mastercard    | 2        | 2         | ✓     |
| Auf Rechnung        | 1        | 1         | ✓     |
| V PAY               | 1        | 1         | ✓     |
| DKB Visa Debit      | 1        | 1         | ✓     |
| **Total**           | **6,842**| **6,842** | ✓     |

Staging row count exactly matches `rows_read` (proves synthetic `row_index` PK survived the real split-bill and multi-line invoices). Transactions count exactly matches `invoices_deduped`.

## Spot-check: top 5 invoices by gross

| source_tx_id | occurred_at (UTC)      | gross_eur | tip_eur | payment_method | sales_type | card_hash |
| ------------ | ---------------------- | --------- | ------- | -------------- | ---------- | --------- |
| 1-1302       | 2025-08-15T16:22:57Z   | 155.00    | 5.00    | MasterCard     | INHOUSE    | set       |
| 1-2224       | 2025-09-21T19:09:34Z   | 132.50    | 6.62    | MasterCard     | INHOUSE    | set       |
| 1-1801       | 2025-09-04T18:08:55Z   | 131.00    | 13.10   | Visa           | INHOUSE    | set       |
| 1-5107       | 2026-02-01T19:41:58Z   | 126.50    | 6.00    | MasterCard     | INHOUSE    | set       |
| 1-1651       | 2025-08-28T19:11:27Z   | 122.00    | 18.30   | MasterCard     | INHOUSE    | set       |

All five rows have:
- Canonical payment_method casing (`MasterCard`, `Visa`) — D-13 pass.
- Non-null `card_hash` on card transactions — card-hash-as-customer-id invariant holds.
- Plausible tip amounts (not multiplied by line-item count) — D-12 tip-from-first-row holds on real data.
- `occurred_at` in UTC; Europe/Berlin conversion done at query time.

## Anomalies / notes

- **`missing_worldline_rows=772`** — within the ~772 expected in Phase 2 RESEARCH Pitfall 2. These are card-intended rows where the Orderbird CSV's worldline join did not resolve `wl_card_number`. **Correction (2026-04-14):** These rows are NOT excluded from `transactions`. They are persisted to both staging AND transactions; only their `card_hash` is `NULL` (because there was no worldline number to hash). They count toward the 1,571 `card_hash IS NULL` invoices alongside the cash invoices. The counter is a diagnostic flag, not an exclusion gate. Founder awareness of the blackout window is still required (see Corrections).
- **`cash_rows_excluded=4478`** — cash payments correctly excluded from the card-hash customer-tracking path; these invoices still appear in `transactions` with `card_hash IS NULL` (1,571 non-card transactions → cash invoices are deduped at invoice level, not line-item level).
- **`errors=0`** on both runs — no parse failures, no upsert conflicts.

## Rule 3 note: orderbird-raw bucket auto-provisioned

Prior to this run the DEV Supabase project had no `orderbird-raw` storage bucket. The uploader script `scripts/ingest/upload-csv.ts` (invoked with the service-role key) failed its first upload attempt. Per deviation Rule 3 (auto-fix blocking issues), migration `0009_create_orderbird_raw_bucket.sql` was added as an idempotent DDL-level bucket creation so forkers get the bucket automatically on `supabase db push`. The bucket was subsequently created and the CSV uploaded successfully (5,255,383 bytes confirmed).

## Corrections (2026-04-14)

Post-initial-run review surfaced three issues. All resolved or documented here.

### (a) CSV source normalized upstream to collapse casing duplicates

The original Orderbird join produced casing duplicates in `payment_method` (e.g.
`mastercard`/`MasterCard`, `visa electron`/`Visa Electron`). Rather than teach
the loader a case map, the upstream CSV generator was normalized at source so
all 9 payment method values now ship in proper case: `MasterCard`, `Visa`,
`Bar`, `Maestro`, `Visa Electron`, `V PAY`, `DKB Visa Debit`, `Debit
Mastercard`, `Auf Rechnung`. Row counts and the overall 20,948 / 6,842 /
2025-06-11..2026-04-11 shape are unchanged.

### (b) Loader switched to pass-through for payment_method

`scripts/ingest/normalize.ts` previously carried a `PAYMENT_MAP` constant and a
case-insensitive canonicalizer (D-10). With the source CSV now authoritative,
that logic is replaced with a trim-only pass-through. Principle: one place to
fix casing (the source), DB content byte-matches CSV content. The previously
asserted `T-8 MASTERCARD → MasterCard` unit test was updated to pin the
pass-through behavior instead.

### (c) Worldline blackout 2026-04-01..2026-04-11 — open question for founder

While investigating `missing_worldline_rows=772`, the gap is not random —
there is a concentrated blackout near the tail of the export window where the
Orderbird→Worldline join breaks. This is NOT a loader bug; it is upstream data
loss. These invoices still land in `transactions` with `card_hash IS NULL`, so
revenue / daily-KPI totals are unaffected. The only consequence is that cohort
/ retention / LTV analytics lose their card-hash customer linkage for those
invoices. **Action:** raise with founder at ING-05 checkpoint. Do NOT patch in
the loader — out of scope for Phase 2.

## Outcome

- Write-mode ingest PASS.
- Idempotency PASS.
- Row counts match report.
- Top-5 spot check PASS.
- Ready for founder ING-05 human-verify checkpoint (Task 3).
