---
phase: 07-column-promotion
type: context
gathered: 2026-04-16
status: ready-for-research
requirements: [DM-01, DM-02, DM-03, FLT-05]
depends_on: [06]
---

# Phase 7: Column Promotion — Context

## Goal (from ROADMAP)

`transactions.wl_issuing_country` and `transactions.card_type` are populated for every row — new ingests and historical — so Phase 8 window functions can denormalize them onto the fact. FLT-05 country filter ships as the user-visible payoff.

## Prior-art landscape (scouted)

- **Staging already has the data.** `stg_orderbird_order_items` (migration `0007`) persists both `wl_issuing_country` and `card_type` columns. `scripts/ingest/normalize.ts` parses them at lines 63 (`card_type`), 69 (`wl_card_type`), 71 (`wl_issuing_country`). Nothing upstream needs to change — the pipeline just drops them on the floor when writing to `transactions`.
- **Phase 6 locked the filter infrastructure.** `src/lib/filters.ts` defines the zod schema and `parseFilters`, `transactions_filterable_v` is the queryable view, `MultiSelectDropdown` is the reusable UI primitive. Phase 7 extends these; does not reinvent.
- **Latest migration is `0018_transactions_filterable_v.sql`** (Phase 6). Phase 7's migration is therefore `0019_`, NOT `0018_` as the ROADMAP draft said.
- **April 2026 Worldline blackout context.** Phase 2 real run (`02-04-REAL-RUN.md`) documented 772 invoices in 2026-04-01..04-11 where the Orderbird→Worldline join failed. Those rows have `wl_card_type` and `wl_issuing_country` = NULL in staging. Phase 7 must handle this gracefully, not hide it.

## Decisions

### D-01 — Migration number: `0019`
New migration is `supabase/migrations/0019_transactions_country_cardtype.sql`. Supersedes the ROADMAP's `0018_` draft (which collides with Phase 6's `0018_transactions_filterable_v.sql`).

### D-02 — Backfill strategy: inline in migration
The new migration runs `ALTER TABLE transactions ADD COLUMN ... NULL` followed by a single `UPDATE transactions t SET ... FROM (SELECT DISTINCT ON (restaurant_id, invoice_number) ...) src WHERE ...` in the same transaction. DEV has ~6,842 invoices — trivially fast. Atomic migration means rollback is `supabase db reset`, no orphaned state.

**Revisit trigger:** if row count ever exceeds ~500k, switch to a separate chunked backfill script post-migration. Not a v1.1 concern.

### D-03 — `card_type` source precedence: Worldline first, POS fallback
When both `wl_card_type` (Worldline network) and `card_type` (Orderbird POS operator entry) are populated, prefer Worldline:

```sql
COALESCE(NULLIF(TRIM(stg.wl_card_type), ''), NULLIF(TRIM(stg.card_type), ''))
```

**Rationale:** Worldline is the payment-network authoritative source; POS entry is operator-typed and noisier. Fallback automatically covers the April 2026 Worldline blackout (772 rows) — those rows get POS-entry values instead of NULL.

### D-04 — `card_type` normalization: canonical set at loader
Store lowercase canonical values in `transactions.card_type`:

```
visa | mastercard | amex | maestro | girocard | other | unknown
```

**Rules:**
- Empty/NULL → `unknown`
- `visa` / `Visa` / `VISA` → `visa`
- `mastercard` / `MasterCard` / `mc` → `mastercard`
- `amex` / `american express` → `amex`
- `maestro` → `maestro`
- `girocard` / `ec` / `ec karte` → `girocard`
- anything else → `other` (long-tail, do not enumerate further)

The same normalization rules apply to (a) the one-shot historical backfill in migration 0019 AND (b) the live CSV loader in `scripts/ingest/normalize.ts`. Implement once as a shared SQL/TS helper; use identical logic in both sites so backfilled rows and live-ingested rows are byte-identical.

**Why at ingest, not in a view:** normalizing in a view means every query pays CPU cost and the filter dropdown shows raw noise. Normalizing at ingest means one-time cost plus a clean, pre-computed filter dropdown.

### D-05 — FLT-05 filter UX: single multi-select + pinned meta-options
Extend the existing Phase 6 `MultiSelectDropdown` component. The country filter dropdown shows:

```
┌─────────────────────────┐
│ ☐ DE only      (meta)   │   ← pinned top, mutually exclusive
│ ☐ Non-DE only  (meta)   │   ← pinned top, mutually exclusive
├─────────────────────────┤
│ ☐ DE  (Germany)         │   ← SELECT DISTINCT from view
│ ☐ AT  (Austria)         │
│ ☐ FR  (France)          │
│ ☐ Unknown               │   ← NULL bucket
│ ...                     │
└─────────────────────────┘
```

**Semantics:**
- Selecting `DE only` or `Non-DE only` clears all specific-country selections
- Selecting a specific country clears both meta-options
- `Unknown` is a selectable specific value that maps to `WHERE wl_issuing_country IS NULL`
- "All" (empty selection) is the default = no WHERE clause

**Rationale:** one dropdown pattern instead of a mode-radio + dropdown combo. Ships in one component. Matches Phase 6 DX.

### D-06 — NULL country is a first-class value, surfaced as "Unknown"
NULL is not hidden, not coerced to "DE", not excluded from counts. It appears in the filter dropdown as `Unknown` and in the data as `NULL`. Success criterion 4 from ROADMAP ("≥1 non-DE country confirming tourist rows exist") is retained as a sanity check — if it fails, we investigate the backfill, we don't block the phase.

**Added criterion (weaker guard, catches total-backfill-failure):**
`SELECT count(*) FROM transactions WHERE wl_issuing_country IS NOT NULL` must return `> 0`.

**Why:** forcing every row into DE/non-DE would silently lie about the Worldline blackout window. NULL is honest.

### D-07 — Tests: planner call, but idempotency is non-negotiable
The integration-test shape (extend `tests/ingest/integration.test.ts` vs add a new file) is left to the planner. What IS locked:

- **Idempotency test:** after one real loader run, a second run must produce zero diffs. Including for the new columns. `transactions_new=0, transactions_updated=0` is the pass condition.
- **Normalization test:** at least one fixture row for each of `visa`, `mastercard`, `girocard`, `unknown`, `other` to prove the canonical-set logic.
- **Worldline fallback test:** at least one fixture row where `wl_card_type` is NULL but `card_type` is populated — must end up in `transactions.card_type` via the POS fallback path.

## Scope (fixed from ROADMAP)

In scope:
- Migration 0019 adds both columns + backfill from `stg_orderbird_order_items`
- CSV loader persistence of both columns (extend `scripts/ingest/normalize.ts` output path, not the parse path — parse already works)
- `transactions_filterable_v` refresh to expose `wl_issuing_country`
- FLT-05 country filter wired through `src/lib/filters.ts` + FilterSheet UI
- Integration tests proving idempotency + normalization + fallback

Out of scope:
- `card_type` filter UI (not in FLT-05; deferred to future phase if wanted)
- Repeater-bucket filter FLT-06 (Phase 8)
- Any Star Schema / `fct_transactions` work (Phase 8)
- Historical data quality fixes beyond what the backfill produces

## Deferred ideas

None surfaced during discussion.

## Questions for researcher

1. Does `stg_orderbird_order_items` guarantee one distinct `(restaurant_id, invoice_number)` row carries the country/card_type for the whole invoice, or can line items within an invoice disagree? If they disagree, `DISTINCT ON` picks a non-deterministic row — is that acceptable or do we need an aggregation rule?
2. Are there pre-existing normalization helpers in `scripts/ingest/` that we should extend, or is this new ground?
3. Does the Phase 6 `transactions_filterable_v` need a full `DROP + CREATE`, or can we `ALTER VIEW ... ADD COLUMN` (Postgres 17 capability check)?

## Questions for planner

1. How to split the work into plans? Suggested wave structure:
   - Wave 1: Migration 0019 (schema + backfill) + updated `transactions_filterable_v`
   - Wave 2: Loader normalization helper + integration tests
   - Wave 3: FLT-05 wiring (filters.ts schema + FilterSheet meta-option logic + distinct-country option source)
2. Can Wave 1 and Wave 2 run in parallel? (Loader tests need the migration applied, but the code changes are in different files.)
3. Does the FLT-05 meta-option logic warrant a Wave 0 RED test scaffold like Phase 6 had?
