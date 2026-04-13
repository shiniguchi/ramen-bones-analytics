# 02-04 Real CSV Ingestion Run (DEV)

**Date:** 2026-04-14
**Environment:** DEV (`paafpikebsudoqxwumgm.supabase.co`)
**Source CSV:** `orderbird_data/5-JOINED_DATA_20250611_20260411/ramen_bones_order_items.csv`
**Bucket object:** `orderbird-raw/dev/ramen_bones_order_items.csv` (5,255,383 bytes)
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

Runtime: ~12s per full-CSV run.

**Idempotency verdict:** PASS. Second run produces `transactions_new=0` and physical row counts are unchanged (see verification below). `transactions_updated=6842` reflects the upsert path touching every row with byte-identical values — this is expected because we do not diff before upserting; the natural key `(restaurant_id, source_tx_id)` collides and Postgres re-writes the tuple with the same values.

## Row count verification (REST, post-run)

| Table                                                 | Count  | Expected             |
| ----------------------------------------------------- | ------ | -------------------- |
| `stg_orderbird_order_items` (restaurant-scoped)       | 20,948 | = rows_read          |
| `transactions` (restaurant-scoped)                    | 6,842  | = invoices_deduped   |
| `transactions WHERE card_hash IS NOT NULL`            | 5,271  | all card invoices    |
| `transactions WHERE card_hash IS NULL`                | 1,571  | 6842 − 5271          |

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

- **`missing_worldline_rows=772`** — within the ~772 expected in Phase 2 RESEARCH Pitfall 2. This is card rows where the Orderbird CSV's worldline join failed to resolve `wl_card_number`; they are persisted to staging but excluded from `transactions` for card-hash correctness. Founder must be made aware during ING-05 checkpoint.
- **`cash_rows_excluded=4478`** — cash payments correctly excluded from the card-hash customer-tracking path; these invoices still appear in `transactions` with `card_hash IS NULL` (1,571 non-card transactions → cash invoices are deduped at invoice level, not line-item level).
- **`errors=0`** on both runs — no parse failures, no upsert conflicts.

## Rule 3 note: orderbird-raw bucket auto-provisioned

Prior to this run the DEV Supabase project had no `orderbird-raw` storage bucket. The uploader script `scripts/ingest/upload-csv.ts` (invoked with the service-role key) failed its first upload attempt. Per deviation Rule 3 (auto-fix blocking issues), migration `0009_create_orderbird_raw_bucket.sql` was added as an idempotent DDL-level bucket creation so forkers get the bucket automatically on `supabase db push`. The bucket was subsequently created and the CSV uploaded successfully (5,255,383 bytes confirmed).

## Outcome

- Write-mode ingest PASS.
- Idempotency PASS.
- Row counts match report.
- Top-5 spot check PASS.
- Ready for founder ING-05 human-verify checkpoint (Task 3).
