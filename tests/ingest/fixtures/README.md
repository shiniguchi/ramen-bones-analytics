# sample.csv — synthetic Orderbird fixture (ING-05 founder sign-off)

24 data rows + 1 header. 29 columns matching the real Orderbird CSV export.
All values synthetic. No real PAN, PII, or customer data. Card numbers use the
`482510xxxxxxxxx####` pattern from RESEARCH (Pitfall 2).

This file IS the ING-05 "≥20 real rows reviewed" artifact — every documented
edge case from `02-RESEARCH.md` and every D-XX decision from `02-CONTEXT.md`
that touches ingest is exercised by at least one invoice below.

## Scenario Map

| Invoice         | Rows | D-XX             | Pitfall   | What it exercises                                                   |
| --------------- | ---- | ---------------- | --------- | ------------------------------------------------------------------- |
| T-1             | 2    | D-12             | —         | Normal 2-line INHOUSE invoice, Visa, tip=3.00 (per-row repeated)    |
| T-2             | 1    | D-08, D-11       | —         | TAKEAWAY cash, blank wl_card_number, is_cash=True                   |
| T-3             | 3    | D-07             | Pitfall 6 | Split-bill: two IDENTICAL Ramen rows, distinct order_id (PK proof)  |
| T-4             | 4    | D-11             | —         | Correction pair (+/− Kimchi, +/− Ramen), invoice_total=0.00         |
| T-5             | 1    | D-11             | —         | Negative-total invoice, must be DROPPED from transactions           |
| T-6             | 1    | D-08             | Pitfall 2 | Card row, blank wl_card_number → NULL card_hash, counter increment  |
| T-7             | 1    | D-09             | Pitfall 4 | DST fall-back 2025-10-26 02:30 Berlin → first-occurrence UTC        |
| T-8             | 1    | D-10             | —         | payment_method=`MASTERCARD` uppercase → normalize to `MasterCard`   |
| T-9             | 1    | D-08             | Pitfall 7 | Blank is_cash, payment_method=Bar → infer cash                      |
| T-10 (ex-T-4)   | 1    | D-07             | —         | Recovered-invoice number with space and parens, stored verbatim     |
| T-11            | 3    | D-12             | —         | Tip 5.00 repeated on all 3 rows → tx tip_cents=500 (NOT 1500)       |
| T-12..T-16      | 1ea  | —                | —         | Padding rows so total reaches ≥24 (used as "normal" baseline)       |

## Counters (expected loader output against this fixture)

- CSV data rows: 24
- Staging rows after upsert: 24 (1:1 — synthetic row_index PK survives T-3)
- Unique invoice_numbers: 16 (T-1..T-16, with T-10 being `T-10 (ex-T-4)`)
- Negative-total invoices dropped: 1 (T-5)
- Transactions written: 15
- missing_worldline_rows: 1 (T-6)
- cash_rows_excluded (or cash tx with NULL card_hash): ≥ 2 (T-2, T-9)

## Why synthetic

The founder cannot share real CSVs (PII / PCI). This fixture is hand-built from
real-row observations recorded in `02-RESEARCH.md` and committed to the repo as
the durable reference for every D-XX decision the loader must enforce.
