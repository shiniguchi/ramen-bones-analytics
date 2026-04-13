# Phase 2: Ingestion - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-14
**Phase:** 02-ingestion
**Areas discussed:** Loader language, Schema grain, CSV parsing, Void/refund/tip semantics, Card hash, CSV source, Ingest trigger, source_tx_id choice

---

## 1. Loader Language & Runtime

| Option | Description | Selected |
|--------|-------------|----------|
| Python + supabase-py + pandas | Matches stack doc; pandas ergonomic for CSV shaping | |
| TypeScript + Node + @supabase/supabase-js | One-stack with rest of repo; no Python toolchain for forkers | ✓ |

**User's question:** "if you modify and visualize let's say acquisition date cohort or retention curve, then don't we need python?"

**Claude clarification:** No — cohort/retention math runs in Postgres SQL (materialized views, Phase 3). TypeScript loader only reads CSV → parses → hashes → upserts. Visualization is SvelteKit/TS.

**User's choice:** TypeScript (accepted the clarification).

---

## 2. Schema Grain (staging vs normalized)

| Option | Description | Selected |
|--------|-------------|----------|
| (a) One table — stg mirrors CSV, transactions = dedup aggregated at load | Two grains, loader dedupes to invoice level | ✓ |
| (b) stg + new transaction_items table | Three grains; item-level persisted separately | |
| (c) No staging — direct into transactions + transaction_items | Two grains, no audit preservation | |

**User's answer:** "each visualization we will create dedicated models for the speed and no computation power - we will update them whenever we have a new data rows in the original file"

**Interpretation:** Phase 3 MV-per-chart pattern. Doesn't directly answer grain question, but combined with the tip/invoice_total semantics answered in area 4, the clean shape is (a): staging preserves CSV 1:1 (for audit + item-grain queries), `transactions` is invoice-level deduped at load.

**Recorded decision:** (a) — stg 1:1 mirror + loader dedupes invoice-level into `transactions`.

---

## 3. CSV Parsing Robustness

| Option | Description | Selected |
|--------|-------------|----------|
| Strict (fail on misalignment) | Forces upstream fix; no silent data loss | ✓ |
| Tolerant (log bad rows to ingest_errors) | Some data survives corruption | |
| Fix upstream (repair the joiner in cowork) | Prevent bad rows from reaching loader | ✓ |

**User's choice:** "fix upstream cowork"

**Interpretation:** Both strict loader AND upstream fix. Loader stays strict so the founder knows immediately when to re-run the pre-joiner.

---

## 4. Void / Refund / Tip Semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Filter voids at load | Loader scans for cancelled flag | |
| Trust pre-joiner filter + strip negative invoice_total | Pre-joiner already removes 262 cancellations; loader filters the 3 known correction-pair negatives | ✓ |

**User's context dump (verbatim, high signal):**
- "The pipeline already filters cancelled orders correctly — 262 cancellations in GDPdU, 0 leaked into JOINED_DATA."
- "The 3 negative rows are a different case entirely: invoice 1-211 on 2025-06-19 where the same items appear as both positive and negative pairs (Kimchi +5/−5, Ramen +15/−15 twice). This is a correction/re-invoice — the waiter voided and re-rang items within the same invoice."
- "GDPdU doesn't flag them as cancelled=1 because they weren't cancelled through the normal cancellation flow. Net effect: the positive and negative pairs cancel out to €0 within the same invoice."
- "You should filter invoice_total_eur < 0 rows out of any revenue analysis — or better, deduplicate at invoice level (which you're already doing for the totals)."
- "tip_eur is invoice-level, repeated on every item row. Invoice 1-7 has 2 items both showing tip_eur = 1.0 — the tip is €1 total, not €1 per item. This is consistent across all 5 samples checked."
- "Implication: never SUM(tip_eur) over raw rows — you'll multiply by item count. Always deduplicate by invoice_number first."

**Recorded decisions:** D-10 (trust pre-joiner), D-11 (filter `invoice_total_eur < 0` at dedup), D-12 (tip invoice-level, never sum over raw staging rows).

---

## 5. Card Hash Rule

| Option | Description | Selected |
|--------|-------------|----------|
| sha256(wl_card_number \|\| restaurant_id) | Deterministic, stable per physical card, cash = NULL | ✓ |

**User's choice:** "good idea"

**Recorded decision:** D-07, D-08 — hash computed in loader before write, cash rows anonymous.

---

## 6. CSV Source & Location

| Option | Description | Selected |
|--------|-------------|----------|
| Commit CSV to repo | Reproducible; leaks customer data into git history | |
| Local path (gitignored) | Convenient; coupled to founder's laptop | |
| Supabase Storage private bucket | Stateless, secure, forker-friendly | ✓ |

**User's choice:** "pulled from supabase - never save any data in github (stateless, secure)"

**Recorded decisions:** D-13, D-14, D-15 — private bucket, .gitignore orderbird_data/, migration adds bucket + policy.

---

## 7. Ingest Trigger

| Option | Description | Selected |
|--------|-------------|----------|
| A) Manual `npm run ingest` | Founder watches the first runs succeed; simplest v1 | ✓ |
| B) Scheduled (pg_cron / GHA) | Automated nightly | |
| C) Event-triggered (Storage webhook → Edge Function) | Immediate on upload | |

**User's first response:** "i don't understand your question" — Claude re-asked with plainer framing.

**User's second response:** "A"

**Recorded decision:** D-16 — manual `npm run ingest`, scheduled/webhook deferred to Phase 5.

---

## 8. source_tx_id Natural Key (emerged from schema discussion)

| Option | Description | Selected |
|--------|-------------|----------|
| source_tx_id = order_id | Order = running tab; one order can split across multiple invoices | |
| source_tx_id = invoice_number | Invoice = one payment event, unique across dataset, joins GDPdU → PDFs | ✓ |

**User's answer:** "Yes. invoice_number (1-211, 1-7, etc.) is the unique identifier for each payment event — one invoice, one payment, one bill. It's what we use to join GDPdU → PDFs, and it's unique across the dataset."

**Recorded decision:** D-04 — `source_tx_id = invoice_number`, `transactions` is invoice-grain.

---

## Claude's Discretion
- Exact column list added to `transactions` beyond the locked minimum (D-04)
- CSV streaming vs sync parse (file is small)
- Upsert batch size
- Directory structure for loader code
- `--dry-run` flag (recommended but not required)
- Staging table PK shape (natural composite vs synthetic row index)
- Exact error messages and log format

## Deferred Ideas
- Scheduled / event-triggered ingest (Phase 5 forkability)
- Playwright scraper (replaced by pre-joiner cowork indefinitely)
- `transaction_items` normalized table (staging serves item-grain)
- Tolerant CSV parser + `ingest_errors` quarantine (strict + upstream fix instead)
- Multi-file batch ingest / historical backfill (run loader multiple times)
- DATEV XML / Worldline direct ingest (those feed the pre-joiner, not Supabase)
- Ingest UI in dashboard
