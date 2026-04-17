---
phase: 07-column-promotion
plan: 03
subsystem: ingest-loader
tags: [tdd, loader, canonical-mapper, idempotency, dm-03]
requirements: [DM-03]
dependency-graph:
  requires: [07-01, 07-02]
  provides: [canonicalizeCardType-ts-helper, loader-persists-new-columns]
  affects: [07-04]
tech-stack:
  added: []
  patterns:
    - TS↔SQL byte-identical canonical mapper
    - first-row-of-invoice-group promotion via existing reducer pattern
key-files:
  created: []
  modified:
    - scripts/ingest/types.ts
    - scripts/ingest/normalize.ts
    - tests/ingest/normalize.test.ts
    - tests/ingest/idempotency.test.ts
    - tests/ingest/fixtures/sample.csv
decisions:
  - "canonicalizeCardType is single-arg (raw string), NOT 2-arg as plan sketched — forces callers to do the same COALESCE precedence as the SQL (wl_payment_type → wl_card_type → POS card_type), keeping TS and SQL byte-identical"
  - "sample.csv fixture rewritten to match real DEV ground-truth: network in wl_payment_type, Debit/Credit flag in wl_card_type (plan's original fixture put network in wl_card_type, contradicting the 07-02 COALESCE fix)"
  - "idempotency.test.ts uses REAL Supabase (TEST project akyugfvsdfrwuzirmylo), NOT a mock — relevant for 07-04 / Phase 8 planning (the test requires migration 0019 applied to TEST, which 07-02 already did)"
metrics:
  duration: ~15min
  tasks: 2
  files: 5
  completed: 2026-04-16
---

# Phase 07 Plan 03: Loader canonicalizeCardType + idempotency Summary

**One-liner:** CSV loader now persists `wl_issuing_country` + canonical `card_type` onto every ingest via a new `canonicalizeCardType` TS helper that is byte-identical to migration 0019's `public.normalize_card_type` SQL function.

## Tasks Completed

| Task | Name | Commit | Key files |
|---|---|---|---|
| 1 | canonicalizeCardType + TxRow extension + reducer wire-in (+ fixture fix) | `71e4d9b` | normalize.ts, types.ts, sample.csv |
| 2 | Idempotency assertions for wl_issuing_country + card_type | `f437df8` | idempotency.test.ts |

RED commit (test-first): `87359b6` — unskipped canonicalizeCardType block + added data-driven + reducer tests.

## What Changed

### `scripts/ingest/types.ts`
`TxRow` gained two fields:
```ts
wl_issuing_country: string | null;  // ISO-2 or NULL
card_type: string;                    // canonical, never NULL (floor = 'unknown')
```

### `scripts/ingest/normalize.ts`
New exported `canonicalizeCardType(raw)` helper. Single-arg raw-string form that mirrors `public.normalize_card_type` SQL in `0019_transactions_country_cardtype.sql` case-for-case:
- Visa family (explicit + `visa *` / `* visa` match)
- Mastercard family (explicit + `mastercard *` / `* mastercard` match)
- Amex, Maestro/V PAY, Girocard/EC variants
- Bare `Debit|Credit|Commercial*` → `unknown`
- Empty/null → `unknown`, anything else → `other`

Reducer at lines 128-138 now populates both new fields, using the same
COALESCE precedence as the SQL backfill: `wl_payment_type → wl_card_type → POS card_type`.

### `scripts/ingest/upsert.ts`, `scripts/ingest/parse.ts`
**Zero change.** Verified. The `const { invoice_number, ...rest } = r` destructure at upsert.ts:42-45 already spreads new fields into the insert payload. Parse.ts 29-column header validator already covers all source columns.

## TxRow Output Sample (post-change)

T-VISA invoice (after reducer):
```json
{
  "restaurant_id": "...",
  "source_tx_id": "T-VISA",
  "occurred_at": "2025-09-16T10:00:00.000Z",
  "card_hash": "<sha256>",
  "gross_cents": 1500,
  "net_cents": 1402,
  "tip_cents": 0,
  "payment_method": "Visa",
  "sales_type": "INHOUSE",
  "wl_issuing_country": "DE",
  "card_type": "visa",
  "invoice_number": "T-VISA"
}
```

T-FALLBACK (POS fallback path — `wl_payment_type=''`, `wl_card_type=''`, `card_type='Visa'`):
```json
{ "wl_issuing_country": "NL", "card_type": "visa", ... }
```

T-UNK (cash — everything empty):
```json
{ "wl_issuing_country": null, "card_type": "unknown", ... }
```

## Loader Report JSON (run 1 + run 2)

Run 1:
```json
{"rows_read":30,"invoices_deduped":21,"staging_upserted":30,"transactions_new":21,"transactions_updated":0,"cash_rows_excluded":4,"missing_worldline_rows":1,"errors":0}
```

Run 2 (zero-diff):
```json
{"rows_read":30,"invoices_deduped":21,"staging_upserted":30,"transactions_new":0,"transactions_updated":21,"cash_rows_excluded":4,"missing_worldline_rows":1,"errors":0}
```

`transactions_new=0` on run 2 confirms no invoice was seen as new. `transactions_updated=21` is the supabase-js upsert reporting artifact (it has no insert-vs-update signal, so every row of the second run is counted as an update even when the underlying state is unchanged). The actual DB state is zero-diff — verified by the explicit T-VISA / T-FALLBACK / T-UNK row snapshots before vs after run 2.

## Idempotency Test Target: Real DB vs Mock

**Real DB.** `tests/ingest/idempotency.test.ts` hits the TEST Supabase project (`akyugfvsdfrwuzirmylo`) via `TEST_SUPABASE_URL` + `TEST_SUPABASE_SERVICE_ROLE_KEY`. The test:
1. Uploads the fixture CSV to the `orderbird-raw` bucket
2. Runs `runIngest()` twice
3. Queries `transactions` directly via `adminClient()`

This matters for Phase 8 / Wave 3: the TEST project must have migration 0019 applied before the `wl_issuing_country` + `card_type` assertions pass. 07-02 already ran `supabase db push` against TEST, so the column exists. Future migrations must continue to apply to TEST, not just DEV.

## Deviations from Plan

### 1. [Rule 1 - Bug] canonicalizeCardType signature changed from 2-arg to 1-arg

- **Found during:** Task 1 implementation
- **Issue:** Plan specified `canonicalizeCardType(wl, pos)` as 2-arg, doing an internal COALESCE of `wl ?? pos`. But 07-02 discovered the real DEV precedence is `wl_payment_type → wl_card_type → POS card_type` (three columns). A 2-arg helper can't express that, and putting 3 args inside the helper couples the helper to the reducer's field layout.
- **Fix:** Made the helper take a single raw string. Caller does the precedence COALESCE inline in the reducer, matching the SQL backfill exactly.
- **Files modified:** scripts/ingest/normalize.ts, tests/ingest/normalize.test.ts
- **Commit:** 71e4d9b

### 2. [Rule 1 - Bug] canonicalizeCardType implementation rewritten to match SQL, not plan's dict

- **Found during:** Task 1 implementation
- **Issue:** Plan gave a simple `Record<string,string>` dict with ~11 entries. That would fail the data-driven test against `canonical-card-types.json` (40 entries including `"Visa Debit"→visa`, `"V PAY"→maestro`, `"KEBHANA MASTER"→mastercard`, `"Debit"→unknown`) because the dict has no prefix/suffix matching and no bare-funding-flag special case.
- **Fix:** Rewrote as a case-ladder mirroring `public.normalize_card_type` in 0019 line-for-line: explicit variant list + `startsWith('visa ')` / `endsWith(' visa')` checks + `mastercard` equivalents + `v pay`/`vpay` aliases to maestro + bare `debit|credit|commercial*` → `unknown`. All 40 fixture entries now pass.
- **Files modified:** scripts/ingest/normalize.ts
- **Commit:** 71e4d9b

### 3. [Rule 1 - Bug] sample.csv fixture columns swapped to match real DEV ground-truth

- **Found during:** Task 1 T-MC assertion failure
- **Issue:** The 07-01 Wave 0 fixture authored T-VISA/T-MC/T-GIRO/T-OTHER with the card network in `wl_card_type` and Debit/Credit in `wl_payment_type`. That's the opposite of what 07-02's ground-truth probe found on real DEV data (network lives in `wl_payment_type`, `wl_card_type` is the funding flag). With the SQL-identical COALESCE precedence in place, the reducer picked `CREDIT`/`DEBIT` first and mapped to `unknown`.
- **Fix:** Swapped the two columns on 4 fixture rows (T-VISA, T-MC, T-GIRO, T-OTHER). T-FALLBACK (both `wl_*` empty, POS-only) and T-UNK (all empty) unchanged — those rows test fallback and cash paths and don't need the swap.
- **Files modified:** tests/ingest/fixtures/sample.csv
- **Commit:** 71e4d9b

## Known Stubs

None. Every code path has a concrete implementation. The `'other'` bucket is a deliberate long-tail catch-all per D-04, not a stub.

## Verification Results

| Check | Command | Result |
|-------|---------|--------|
| Plan-scoped: normalize.test.ts | `npm run test -- --run tests/ingest/normalize.test.ts` | 16 passed |
| Plan-scoped: idempotency.test.ts | `npm run test -- --run tests/ingest/idempotency.test.ts` | 2 passed (real TEST DB) |
| Full ingest suite | `npm run test -- --run tests/ingest/` | 34 passed, 0 skipped |
| ci-guards | `bash scripts/ci-guards.sh` | All CI guards passed |
| TS canonicalizeCardType ↔ SQL normalize_card_type identity | data-driven test over canonical-card-types.json | 40/40 entries match |

## Requirements Closed

- [x] **DM-03** — Loader writes both new columns on every ingest, re-runs are zero-diff (including on `wl_issuing_country` + `card_type`). Worldline fallback path proven by T-FALLBACK. Full canonical coverage proven by the 40-entry data-driven test.

## Self-Check: PASSED

**Files modified (verified via git log + Read):**
- scripts/ingest/types.ts FOUND (TxRow has wl_issuing_country + card_type)
- scripts/ingest/normalize.ts FOUND (canonicalizeCardType exported, reducer wired)
- tests/ingest/normalize.test.ts FOUND (4 new tests GREEN)
- tests/ingest/idempotency.test.ts FOUND (new-column block GREEN)
- tests/ingest/fixtures/sample.csv FOUND (T-VISA/T-MC/T-GIRO/T-OTHER columns swapped)

**Commits:**
- `87359b6` test(07-03): unskip canonicalizeCardType + add data-driven + reducer tests ✅
- `71e4d9b` feat(07-03): canonicalizeCardType helper + wl_issuing_country/card_type on TxRow ✅
- `f437df8` test(07-03): unskip idempotency new-column assertions (DM-03) ✅
