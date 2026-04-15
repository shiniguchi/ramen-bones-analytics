---
phase: 07-column-promotion
type: research
researched: 2026-04-16
domain: Postgres migration + CSV loader + SvelteKit filter UI
requirements: [DM-01, DM-02, DM-03, FLT-05]
depends_on: [06]
confidence: HIGH
---

# Phase 7: Column Promotion — Research

## Summary

Phase 7 lifts two staging columns (`wl_issuing_country`, `card_type`) into `public.transactions` via migration `0019`, extends the CSV loader to write them on future ingests, refreshes `transactions_filterable_v` to expose the new country column, and wires FLT-05 through the Phase 6 filter infrastructure with a pinned-meta-option dropdown UX. All seven CONTEXT decisions (D-01..D-07) are locked and research below fleshes out implementation details.

**Primary recommendation:** Ship in 3 waves. Wave 1 = migration 0019 (schema + backfill + view refresh via `CREATE OR REPLACE VIEW`). Wave 2 = loader normalization helper + idempotency tests (parallel-safe with Wave 1; tests run against a locally-migrated DB). Wave 3 = `filters.ts` extension + `FilterSheet` meta-option wiring.

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** New migration is `supabase/migrations/0019_transactions_country_cardtype.sql` (NOT 0018 — the ROADMAP draft collided with Phase 6's existing `0018_transactions_filterable_v.sql`).
- **D-02:** Backfill is inline in the same migration — `ALTER TABLE ... ADD COLUMN NULL` + `UPDATE ... FROM (SELECT DISTINCT ON ...)` atomically. Revisit trigger: ~500k rows.
- **D-03:** `card_type` source precedence is Worldline first, POS fallback: `COALESCE(NULLIF(TRIM(stg.wl_card_type), ''), NULLIF(TRIM(stg.card_type), ''))`. Handles the April 2026 Worldline blackout window (772 rows) automatically.
- **D-04:** Canonical card_type set at loader: `visa | mastercard | amex | maestro | girocard | other | unknown`. Identical normalization logic applied in BOTH migration 0019 backfill AND `scripts/ingest/normalize.ts` — backfilled rows and live-ingested rows must be byte-identical. Normalize at ingest, never in a view.
- **D-05:** FLT-05 UX is a single multi-select with pinned "DE only" / "Non-DE only" meta-options at the top of the existing `MultiSelectDropdown`, mutually exclusive with specific-country selections.
- **D-06:** NULL `wl_issuing_country` is first-class, surfaced as `Unknown` in the dropdown and as NULL in data. Weaker success guard added: `SELECT count(*) FROM transactions WHERE wl_issuing_country IS NOT NULL > 0`.
- **D-07:** Idempotency, normalization coverage, and Worldline-fallback tests are non-negotiable. Test-file layout is planner's call.

### Claude's Discretion
- Exact file layout for the shared canonical-card-type mapper (TS helper location + SQL CASE placement)
- Wave/plan split (CONTEXT suggests 3 waves, planner confirms)
- Whether FLT-05 needs a Wave 0 RED scaffold mirroring Phase 6's pattern
- Fixture extension strategy for the normalize tests (extend `sample.csv` vs. new fixture)

### Deferred Ideas (OUT OF SCOPE)
- `card_type` filter UI (not in FLT-05 — deferred, possibly never)
- FLT-06 repeater-bucket filter (Phase 8)
- Any `dim_customer` / `fct_transactions` / Star Schema work (Phase 8)
- Historical data quality fixes beyond what the backfill produces

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DM-01 | `transactions` gains `wl_issuing_country` (char(2)) + `card_type` (text) via migration `0019` | Migration section + D-03/D-04 normalization rules below |
| DM-02 | One-shot backfill from `stg_orderbird_order_items` first-row-per-invoice, ≥20 spot-checked | DISTINCT ON analysis (Q1) + precedent check + backfill SQL template |
| DM-03 | CSV loader writes both columns on future ingests, idempotency preserved | Insertion-point analysis in `normalize.ts` + `upsert.ts` + types.ts diff |
| FLT-05 | Country dropdown through Phase 6 schema, DE-only / non-DE-only / individual multi-select | `filters.ts` + `FilterSheet.svelte` + `MultiSelectDropdown.svelte` deltas |

---

## Focus Question 1 — DISTINCT ON Determinism

**Question:** Does `stg_orderbird_order_items` guarantee one distinct `(restaurant_id, invoice_number)` row carries country/card_type for the whole invoice, or can line items within an invoice disagree?

**Answer: Line items WITHIN an invoice MUST carry identical `wl_issuing_country`, `wl_card_type`, and `card_type` values, because all rows in an invoice represent a single payment event.** Proof from fixture + schema:

- `supabase/migrations/0007_stg_orderbird_order_items.sql:38` stores `wl_issuing_country` as text per line item (no invoice-level table exists). But invoice-grain fields like `invoice_total_eur`, `tip_eur`, `wl_card_number`, `payment_method` are **repeated on every row** of the invoice (see `tests/ingest/fixtures/sample.csv` lines 5-7 for T-3, lines 18-20 for T-11 — `wl_card_number=482510xxxxxxxxx0002` appears on all three T-3 rows, `wl_issuing_country=DE` on all three, etc).
- The loader's existing tip-dedupe logic (`normalize.ts:118` — "tip from FIRST row only") exploits the same invariant: invoice-grain fields are duplicated across line items.
- `.planning/phases/02-ingestion/02-04-REAL-RUN.md` documents the Worldline join: it's an invoice-grain join, so when a row is blackout-missing, **all** line items for that invoice are missing Worldline data, not a subset.

**Implication for DISTINCT ON:** Any row of a given invoice carries identical values, so `DISTINCT ON (restaurant_id, invoice_number)` is deterministic *by value* even if not by physical row pick. The `ORDER BY` clause is only needed to make the row pick reproducible (for the COALESCE → POS-fallback path where `wl_card_type` could be NULL but a neighboring row would also be NULL — they agree).

**Edge case — fully-NULL Worldline invoices (772 blackout rows):** Every row has `wl_card_type = ''` and `wl_issuing_country = ''`. `DISTINCT ON` picks row 1 by `ORDER BY row_index`, `COALESCE` falls through to `stg.card_type` (POS), and `wl_issuing_country` stays NULL (correctly surfaced as `Unknown` per D-06).

**Recommended backfill SQL shape:**

```sql
UPDATE public.transactions t
   SET wl_issuing_country = src.wl_issuing_country,
       card_type          = src.card_type_canonical
  FROM (
    SELECT DISTINCT ON (stg.restaurant_id, stg.invoice_number)
           stg.restaurant_id,
           stg.invoice_number,
           NULLIF(TRIM(stg.wl_issuing_country), '')                AS wl_issuing_country,
           -- canonical mapper: Worldline first, POS fallback, then normalize
           public.normalize_card_type(
             COALESCE(
               NULLIF(TRIM(stg.wl_card_type), ''),
               NULLIF(TRIM(stg.card_type),    '')
             )
           )                                                        AS card_type_canonical
      FROM public.stg_orderbird_order_items stg
     ORDER BY stg.restaurant_id, stg.invoice_number, stg.row_index  -- deterministic pick
  ) src
 WHERE t.restaurant_id = src.restaurant_id
   AND t.source_tx_id  = src.invoice_number;  -- source_tx_id = invoice_number per 02 loader
```

**Note:** `t.source_tx_id = src.invoice_number` is safe because `normalize.ts:128` sets `source_tx_id: invoice` on the TxRow.

**Aggregation rule (if line items ever disagreed):** Not needed for this phase, but if Phase 8 ever finds disagreement, fall back to `first-non-null by row_index ASC` — matches the existing `first row wins` reducer convention in `normalize.ts:98`.

**Confidence: HIGH** (fixture + schema + 02-REAL-RUN + existing reducer all agree).

**Precedent check for `UPDATE...FROM (DISTINCT ON)`:** No existing migration in `supabase/migrations/` uses this pattern (verified via Grep across the migrations folder). Phase 7 is the first inline backfill. This means the planner should write the SQL freshly but can test it against a scratch DB before committing, since there's no local template to copy.

---

## Focus Question 2 — Pre-existing Normalization Helpers

**Question:** Are there normalization helpers in `scripts/ingest/` we should extend, or is this new ground?

**Answer: One relevant helper exists (`normalizePaymentMethod` in `normalize.ts:18-20`) but it is a deliberate PASS-THROUGH — it trims whitespace and nothing else.** Source: `normalize.ts:15-20`:

```ts
// D-10 (revised 02-04): payment_method is pass-through. The upstream CSV is
// now normalized at source ...
export function normalizePaymentMethod(raw: string | null | undefined): string {
  return (raw ?? '').trim();
}
```

**Other files checked:**
- `scripts/ingest/parse.ts` — strict header validation only, no value normalization
- `scripts/ingest/hash.ts` — SHA-256 card hashing (not relevant)
- `scripts/ingest/upsert.ts` — DB batch writer, no transforms
- `scripts/ingest/download.ts`, `env.ts`, `report.ts`, `index.ts` — orchestration only

**Conclusion:** The canonical card-type mapper is **new ground**. The planner should add a dedicated function (recommended name: `canonicalizeCardType`) in `scripts/ingest/normalize.ts` next to `normalizePaymentMethod` so both helpers live in the same file, and export it so tests can hit it directly. The existing `normalizePaymentMethod` is NOT a model to mimic — Phase 7 actually needs a real normalization (canonical-set mapping), whereas `normalizePaymentMethod` explicitly rejected mapping.

**TS helper shape:**

```ts
// scripts/ingest/normalize.ts (new function, sits next to normalizePaymentMethod)
const CARD_TYPE_CANONICAL: Record<string, string> = {
  'visa': 'visa',
  'mastercard': 'mastercard',
  'mc': 'mastercard',
  'master card': 'mastercard',
  'amex': 'amex',
  'american express': 'amex',
  'maestro': 'maestro',
  'girocard': 'girocard',
  'ec': 'girocard',
  'ec karte': 'girocard',
  'ec-karte': 'girocard',
};

// D-03 + D-04: Worldline first, POS fallback, canonical-set mapping.
export function canonicalizeCardType(
  wl: string | null | undefined,
  pos: string | null | undefined,
): string {
  const raw = (wl ?? '').trim() || (pos ?? '').trim();
  if (!raw) return 'unknown';
  const key = raw.toLowerCase().replace(/\s+/g, ' ');
  return CARD_TYPE_CANONICAL[key] ?? 'other';
}
```

**Mirror SQL function for the migration (same logic, same output):**

```sql
create or replace function public.normalize_card_type(raw text)
returns text
language sql
immutable
as $$
  select case
    when raw is null or btrim(raw) = '' then 'unknown'
    when lower(regexp_replace(btrim(raw), '\s+', ' ', 'g')) in ('visa')                         then 'visa'
    when lower(regexp_replace(btrim(raw), '\s+', ' ', 'g')) in ('mastercard','mc','master card') then 'mastercard'
    when lower(regexp_replace(btrim(raw), '\s+', ' ', 'g')) in ('amex','american express')      then 'amex'
    when lower(regexp_replace(btrim(raw), '\s+', ' ', 'g')) in ('maestro')                      then 'maestro'
    when lower(regexp_replace(btrim(raw), '\s+', ' ', 'g')) in ('girocard','ec','ec karte','ec-karte') then 'girocard'
    else 'other'
  end;
$$;
```

**Idempotent identity contract:** For every raw input string, the TS and SQL functions must return the same output. The planner should add a single shared reference test (a JSON/SQL fixture of `{input, expected}` pairs) and assert both sides against it.

**Edge cases that the TRIM+NULLIF+COALESCE pattern catches:**
- Empty string `''` → `NULLIF` → NULL → skipped → falls through to POS → if also empty → `unknown`
- Whitespace-only `'   '` → TRIM makes it `''` → NULLIF → skipped
- `'Visa'`, `'VISA'`, `'visa'` → lowercased → `visa`
- `'Master Card'` (with space) → collapse whitespace → `master card` → `mastercard`

**Edge cases the pattern does NOT catch (flag for planner):**
- Literal string `'NULL'` or `'null'` (not SQL NULL) → would map to `other`. Unlikely in Orderbird CSV but worth one ground-truth check in Task 0.
- Unicode variants (e.g. full-width `Ｖｉｓａ`) → would map to `other`. Vanishingly unlikely, don't spend time on it.
- `'mc.'` / `'m/c'` / `'Masterc.'` → map to `other`. If Task 0 ground-truth finds any of these, add them to the dict.

---

## Focus Question 3 — transactions_filterable_v Refresh Strategy

**Question:** Does the Phase 6 view need a full `DROP + CREATE`, or can we `ALTER VIEW ... ADD COLUMN` in Postgres 17?

**Answer: Use `CREATE OR REPLACE VIEW` (NOT `ALTER VIEW ADD COLUMN` — that syntax does not exist in Postgres).**

Postgres allows `CREATE OR REPLACE VIEW` to add new columns **only at the end of the select list**, and only if every existing column keeps the same name, type, and position. Source: [PostgreSQL 17 CREATE VIEW docs](https://www.postgresql.org/docs/17/sql-createview.html):

> "CREATE OR REPLACE VIEW is similar, but if a view of the same name already exists, it is replaced. The new query must generate the same columns that were generated by the existing view query (that is, the same column names in the same order and with the same data types), but it may add additional columns to the end of the list."

**Implication for Phase 7:** `0018_transactions_filterable_v.sql` exposes columns in this order: `restaurant_id, business_date, gross_cents, sales_type, payment_method` (lines 25-29). Appending `wl_issuing_country` at the end satisfies the CREATE OR REPLACE contract — no DROP, no dependent-object cascade risk, no grant re-apply needed.

**Migration 0019 view-refresh block:**

```sql
create or replace view public.transactions_filterable_v
with (security_invoker = true) as
select
  t.restaurant_id,
  (t.occurred_at at time zone r.timezone)::date as business_date,
  t.gross_cents,
  t.sales_type,
  t.payment_method,
  t.wl_issuing_country   -- NEW: appended at end to satisfy CREATE OR REPLACE VIEW
from public.transactions t
join public.restaurants r on r.id = t.restaurant_id
where t.restaurant_id::text = (auth.jwt() ->> 'restaurant_id');
```

**No re-grant needed** — `CREATE OR REPLACE VIEW` preserves existing grants (`grant select on public.transactions_filterable_v to authenticated;` from `0018_transactions_filterable_v.sql:34` stays valid). The `security_invoker = true` option is preserved because it's restated in the replacement.

**`ALTER VIEW` exists but only for renaming / owner changes / setting options** — you cannot add columns with it. Trying `ALTER VIEW ... ADD COLUMN` would be a syntax error.

**Do NOT add `card_type` to the view.** Per D-07-scope (`card_type` filter UI is out of scope), only `wl_issuing_country` needs to be exposed through the view. Adding `card_type` to the view now would be dead-weight.

**Confidence: HIGH** (official Postgres docs + Phase 6 view is a trivial flat select, no dependents).

---

## Staging Schema Recap

`stg_orderbird_order_items` (from `supabase/migrations/0007_stg_orderbird_order_items.sql:6-43`):

| Column | Type | Notes |
|---|---|---|
| `restaurant_id` | uuid NOT NULL | PK component |
| `invoice_number` | text NOT NULL | PK component |
| `row_index` | integer NOT NULL | PK component — deterministic ordering within invoice |
| `card_type` | text | Orderbird POS operator entry — noisy, but always populated for card txns |
| `wl_card_type` | text | Worldline-side card network — authoritative when present, NULL during April blackout |
| `wl_issuing_country` | text | Worldline-side issuing country (ISO-2 like `DE`, `AT`, `FR`) — NULL for cash + blackout |
| 26 other text columns | text | not relevant to this phase |
| `ingested_at` | timestamptz DEFAULT now() | audit |
| `source_file` | text NOT NULL | audit |

All CSV value columns are stored as `text` — no type coercion at staging. This matches the "29-column 1:1 text mirror" design from Phase 2.

**`transactions` existing shape** (after `0008_transactions_columns.sql`): `tip_cents`, `payment_method`, `sales_type` already exist. Phase 7's ALTER adds exactly two columns:

```sql
alter table public.transactions
  add column wl_issuing_country char(2),   -- NULL for cash, blackout, non-card
  add column card_type          text;      -- canonical set enum (no CHECK, enforced at loader)
```

Why `char(2)` for country: matches ISO-3166-1 alpha-2, matches the `wl_issuing_country` data shape in the sample CSV (`DE`), and matches REQ DM-01 verbatim ("char(2)"). Why plain `text` for card_type: the canonical set is small but might grow; a CHECK constraint would force a future migration every time. Enforce at loader.

---

## Task 0 — Ground-Truth Query for Canonical Enumeration

The canonical set in D-04 is based on Claude's training-data assumption about German POS data. Before committing the TS dict + SQL CASE, the planner should run this against DEV and update the dict if anything unexpected appears:

```sql
-- Task 0: ground-truth card_type distribution.
-- Run via Supabase SQL editor on DEV. Paste output into 07-RESEARCH.md
-- before Wave 1 starts. If any value appears >10x and isn't in D-04's
-- canonical set, surface it to the user.
select
  coalesce(nullif(btrim(wl_card_type), ''), nullif(btrim(card_type), '')) as raw_card_type,
  count(*) as n
from public.stg_orderbird_order_items
group by 1
order by n desc;

-- And for country (should show DE dominant, AT/FR/NL/CH sprinkled, and a
-- chunk of NULL / empty-string from the April blackout):
select
  nullif(btrim(wl_issuing_country), '') as country,
  count(*) as n
from public.stg_orderbird_order_items
group by 1
order by n desc;
```

**Pass condition:** Every non-null `raw_card_type` maps to exactly one canonical bucket (`visa|mastercard|amex|maestro|girocard|other`). If >5% of rows land in `other`, surface the unmapped values to the user before shipping — `other` is a long-tail bucket, not a dumping ground.

---

## Loader Integration — Exact Insertion Point

**File:** `scripts/ingest/normalize.ts`

**Current invoice-grain reducer** (lines 84-142) builds `TxRow` objects. The new columns go in here, wired through `types.ts`:

**Change 1 — `scripts/ingest/types.ts:46-58` (TxRow interface):**

```ts
export interface TxRow {
  restaurant_id: string;
  source_tx_id: string;
  occurred_at: string;
  card_hash: string | null;
  gross_cents: number;
  net_cents: number;
  tip_cents: number;
  payment_method: string;
  sales_type: string;
  wl_issuing_country: string | null;   // NEW — char(2) or null
  card_type: string;                    // NEW — canonical (always set, min value = 'unknown')
  invoice_number: string;               // stays; stripped in upsert.ts:43
}
```

**Change 2 — `scripts/ingest/normalize.ts:126-138` (TxRow construction):**

```ts
const tx: TxRow = {
  restaurant_id: restaurantId,
  source_tx_id: invoice,
  occurred_at: toBerlinUtc(first.csv_date, first.csv_time),
  card_hash: hashed,
  gross_cents,
  net_cents,
  tip_cents,
  payment_method: normalizePaymentMethod(first.payment_method),
  sales_type: first.sales_type,
  // NEW — read from first row of invoice group (same first-row-wins convention
  // as tip_cents at line 118, sales_type above, and payment_method)
  wl_issuing_country: (first.wl_issuing_country || '').trim() || null,
  card_type: canonicalizeCardType(first.wl_card_type, first.card_type),
  invoice_number: invoice,
};
```

**Change 3 — `scripts/ingest/upsert.ts:42-45`** — the existing destructure `const { invoice_number, ...rest } = r;` already strips `invoice_number` and passes the rest verbatim. The two new columns will flow through unchanged because the upsert payload is a spread. **Zero code change in upsert.ts.**

**Change 4 — no change to `parse.ts`.** The 29-column header validator at `parse.ts:7-37` already includes both `card_type` (line 28) and `wl_issuing_country` (line 36) + `wl_card_type` (line 34). Nothing upstream to touch.

**Integration point for `canonicalizeCardType`:** Add it between `normalizePaymentMethod` (line 20) and `toStagingRows` (line 26) in `normalize.ts`. Export it so `normalize.test.ts` can unit-test the canonical mapping against the ground-truth list from Task 0.

---

## FilterSheet Meta-Option Integration

**File:** `src/lib/components/FilterSheet.svelte` + `src/lib/components/MultiSelectDropdown.svelte` + `src/lib/filters.ts`

### Schema delta — `src/lib/filters.ts`

Current `sales_type` / `payment_method` pattern (lines 40-41):

```ts
sales_type: csvArray(SALES_TYPE_VALUES),
payment_method: csvArray(),
```

**Add for FLT-05** — country is unbounded so no enum whitelist (same approach as `payment_method`):

```ts
// After line 41, add:
country: csvArray(),
```

That's the entire filter-schema change. `parseFilters` at line 48 auto-picks it up.

**Meta-option handling lives in the loader, NOT in the zod schema.** The dropdown emits one of three shapes:
1. `undefined` (All — no filter)
2. `['__de_only__']` — translate to `WHERE wl_issuing_country = 'DE'`
3. `['__non_de_only__']` — translate to `WHERE wl_issuing_country IS NULL OR wl_issuing_country <> 'DE'` (per D-06, NULL is "non-DE")
4. `['DE','AT',...]` or `['__unknown__']` — regular multi-select, with `__unknown__` translating to `wl_issuing_country IS NULL`

**Recommended sentinel values** (prefixed with `__` so they can never collide with a real ISO-2):
- `__de_only__`
- `__non_de_only__`
- `__unknown__`

**Loader wiring in `src/routes/+page.server.ts`** — mirror the existing `distinctPaymentMethodsP` pattern (lines 223-231):

```ts
const distinctCountriesP = locals.supabase
  .from('transactions_filterable_v')
  .select('wl_issuing_country')
  .then(r => {
    const rows = (r.data ?? []) as Array<{ wl_issuing_country: string | null }>;
    const real = [...new Set(
      rows.map(x => x.wl_issuing_country).filter((v): v is string => !!v)
    )].sort();
    // Prepend meta-options and append Unknown bucket.
    return ['__de_only__', '__non_de_only__', ...real, '__unknown__'];
  })
  .catch((e: unknown) => { console.error('[distinctCountries]', e); return [] as string[]; });
```

Then WHERE-clause composition (in the same loader function where `sales_type` / `payment_method` filters are applied):

```ts
// Translate country filter into a Supabase query constraint.
if (filters.country && filters.country.length > 0) {
  if (filters.country.includes('__de_only__')) {
    q = q.eq('wl_issuing_country', 'DE');
  } else if (filters.country.includes('__non_de_only__')) {
    q = q.or('wl_issuing_country.is.null,wl_issuing_country.neq.DE');
  } else {
    const hasUnknown = filters.country.includes('__unknown__');
    const specific = filters.country.filter(c => !c.startsWith('__'));
    if (hasUnknown && specific.length > 0) {
      q = q.or(`wl_issuing_country.is.null,wl_issuing_country.in.(${specific.join(',')})`);
    } else if (hasUnknown) {
      q = q.is('wl_issuing_country', null);
    } else if (specific.length > 0) {
      q = q.in('wl_issuing_country', specific);
    }
  }
}
```

### UI delta — extend `MultiSelectDropdown` or wrap it?

**Recommendation: wrap, not extend.** The existing `MultiSelectDropdown.svelte` is clean and generic — adding meta-option logic to it would pollute the sales-type and payment-method dropdowns with conditional logic they don't need.

**New component:** `src/lib/components/CountryMultiSelect.svelte` — thin wrapper around `MultiSelectDropdown` that:
1. Renders meta-option rows (DE only / Non-DE only) with visual separator above the regular list
2. Enforces mutual exclusion: clicking a meta-option clears specific selections; clicking a specific country clears meta-options
3. Translates `__unknown__` to the display label `Unknown`
4. Translates `DE` → `DE (Germany)` etc. using a small ISO-2 label map (populate with the 5-10 countries that actually appear in the data — Task 0 query tells you which)

**Why a wrapper and not `{#if label === 'country'}` in MultiSelectDropdown:** Phase 8's FLT-06 repeater-bucket filter will want its own special-case ordering (first_timer → 2x → 3x...), and a pattern of "wrap for special semantics" is cleaner than a kitchen-sink `MultiSelectDropdown`.

**FilterSheet.svelte delta:**

```svelte
<!-- After the payment-method block (around line 98), add: -->
{#if distinctCountries.length > 0}
  <CountryMultiSelect
    options={distinctCountries}
    bind:selected={countryDraft}
  />
{/if}
```

Plus the usual draft-state wiring at the top of the script block (mirrors `salesTypeDraft` / `paymentMethodDraft` at lines 25-26, 31-32, 54).

### Wave 0 RED scaffold — recommendation

**Yes, Phase 7 warrants a Wave 0 RED scaffold for the FLT-05 meta-option logic specifically.** Rationale: the mutual-exclusion rules (D-05) are the most error-prone piece of the phase and the exact class of logic Phase 6 got right by starting with tests. Minimal scaffold:

- `tests/unit/filters-country.test.ts` — zod schema accepts `country=__de_only__`, `country=__unknown__,AT,FR`, rejects garbage
- `tests/unit/country-multiselect.test.ts` — simulate toggles, assert mutual exclusion
- `tests/integration/filter-country-loader.test.ts` — end-to-end: set country filter, assert WHERE clause applied to the view

The migration + backfill + loader changes don't need a RED scaffold — existing `tests/ingest/normalize.test.ts` + `tests/ingest/idempotency.test.ts` patterns already work and just need new cases added.

---

## Tests — Locked Requirements (from D-07)

1. **Idempotency test:** Extend `tests/ingest/idempotency.test.ts` OR add a Phase 7 assertion block — two sequential runs of the loader against the same CSV produce `transactions_new=0` AND `transactions_updated=0` AND zero diff on `wl_issuing_country` + `card_type`.
2. **Normalization coverage test:** Fixture rows for each canonical bucket — `visa`, `mastercard`, `girocard`, `unknown` (empty both wl and POS), `other` (a deliberately weird value). Add to `tests/ingest/fixtures/sample.csv` or create `tests/ingest/fixtures/card-types.csv`.
3. **Worldline fallback test:** Fixture row with `wl_card_type=''` and `card_type='Visa'` → asserts `transactions.card_type = 'visa'` via the POS fallback path. (T-2 and T-9 in `sample.csv` are cash with no card data — they don't cover fallback; a new fixture row is needed.)

**Fixture extension strategy:** Extend `sample.csv` rather than creating a new file. Existing tests at `tests/ingest/normalize.test.ts:22` hard-code `expect(staging.length).toBe(24)`; adding rows will bump that number but is a one-character change. Every existing test pins rows by `invoice_number` so new rows won't cross-contaminate. This keeps the fixture story single-sourced.

---

## Runtime State Inventory

Phase 7 is additive schema + code changes — no renames or migrations of existing records. Categories:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — `transactions` table gains 2 new columns; existing rows get backfilled in the same atomic migration, not migrated-in-place to a new shape | — (handled by 0019 inline UPDATE) |
| Live service config | None — no n8n, no Datadog, no Tailscale in this project | None — verified by grep: no configs reference `wl_issuing_country` or `card_type` today |
| OS-registered state | None — `pg_cron` schedule `refresh_analytics_mvs` stays unchanged (no new MV added in Phase 7) | None |
| Secrets/env vars | None — no new env vars | None |
| Build artifacts / installed packages | None — TS compile only, no eggs/binaries | None |

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Supabase CLI | Apply migration `0019` locally before DEV | ✓ (Phase 1-6 used it) | per `package.json` | — |
| `@supabase/supabase-js` | Loader upsert + view query | ✓ (Phase 2) | 2.x | — |
| `csv-parse` | Already imported by `parse.ts` | ✓ | existing | — |
| Vitest | Unit + integration tests | ✓ | existing | — |
| Postgres 15+ (Supabase-managed) | `CREATE OR REPLACE VIEW` + `DISTINCT ON` | ✓ | Postgres 15 (Supabase free tier) | — |

Zero new dependencies. All integration points exist from Phase 2 and Phase 6.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (existing, per Phase 1) |
| Config file | `vitest.config.ts` (existing) |
| Quick run command | `npm run test -- --run tests/unit/filters-country.test.ts tests/ingest/normalize.test.ts` |
| Full suite command | `npm run test -- --run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| DM-01 | `transactions` has `wl_issuing_country char(2)` and `card_type text` after migration | integration | `npm run test -- --run tests/ingest/schema.test.ts` (new) | ❌ Wave 0 |
| DM-02 | Backfill populates ≥20 historical invoices via DISTINCT ON; spot-check matches raw stg rows | integration | `npm run test -- --run tests/ingest/backfill.test.ts` (new) | ❌ Wave 0 |
| DM-03 | Loader writes both columns on re-ingest; second run has zero diffs | integration | `npm run test -- --run tests/ingest/idempotency.test.ts` (extend) | ✅ exists, extend |
| DM-04 (canonical) | `canonicalizeCardType` maps every bucket correctly; fallback path honored | unit | `npm run test -- --run tests/ingest/normalize.test.ts` | ✅ exists, extend |
| FLT-05 (schema) | `parseFilters` accepts `country=...` including meta-options | unit | `npm run test -- --run tests/unit/filters-country.test.ts` (new) | ❌ Wave 0 |
| FLT-05 (UI) | `CountryMultiSelect` enforces mutual exclusion | unit | `npm run test -- --run tests/unit/country-multiselect.test.ts` (new) | ❌ Wave 0 |
| FLT-05 (SSR) | Page loader translates country filter into correct WHERE clause | integration | `npm run test -- --run tests/integration/filter-country-loader.test.ts` (new) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm run test -- --run tests/ingest/normalize.test.ts tests/unit/filters-country.test.ts`
- **Per wave merge:** `npm run test -- --run` (full suite)
- **Phase gate:** Full suite green + manual DEV verify of FLT-05 dropdown at 375px before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/ingest/schema.test.ts` — covers DM-01 (assert `information_schema.columns` has both new columns)
- [ ] `tests/ingest/backfill.test.ts` — covers DM-02 (seed 3 staging invoices, run migration, assert backfill values match)
- [ ] `tests/unit/filters-country.test.ts` — covers FLT-05 schema parsing
- [ ] `tests/unit/country-multiselect.test.ts` — covers meta-option mutual exclusion
- [ ] `tests/integration/filter-country-loader.test.ts` — covers SSR WHERE-clause translation
- [ ] Extend `tests/ingest/normalize.test.ts` with 5 new canonical-bucket cases + 1 Worldline-fallback case
- [ ] Extend `tests/ingest/idempotency.test.ts` to assert zero-diff on new columns

---

## Project Constraints (from CLAUDE.md)

- **Tech stack lock:** SvelteKit 2 + Svelte 5 + `adapter-cloudflare` + Supabase Postgres — Phase 7 stays inside this lock.
- **Mobile-first 375px verification:** FLT-05 dropdown MUST be verified at 375px before merge (per UI-11 contract carried through to v1.1 per ROADMAP Phase 10 criterion 6, and per `.claude/CLAUDE.md` Mandatory QA rules).
- **No dynamic SQL strings:** FLT-07 (Phase 6) — country filter composition must go through zod-validated params only; the `q.or(...)` template in the loader snippet above uses only sanitized array contents (specific countries from `SELECT DISTINCT`, not user text).
- **`ci-guards` Guard 1:** SvelteKit loader still queries the wrapper view `transactions_filterable_v`, NOT raw `transactions`. The Phase 7 view refresh must preserve `security_invoker = true` and the JWT-claim WHERE clause.
- **No `Co-authored-by: Claude`:** Per `.claude/CLAUDE.md` — commit messages must not include the attribution line.
- **Default environment DEV:** All verification happens against DEV (not local Supabase). Migration 0019 must be applied to DEV and spot-checked via Supabase SQL editor before claiming DM-02 complete.
- **Supabase secret / security posture:** No new secrets. No PII. `wl_issuing_country` is an ISO-2 country code, not PII.

---

## Open Questions

1. **Should `card_type` be indexed?** Not in this phase — no filter UI uses it. Phase 8's `fct_transactions` will denormalize and index it as part of the composite filter index. Leave unindexed for Phase 7.
2. **Does the existing `tests/ingest/idempotency.test.ts` run against a real Supabase client or a mock?** Planner should check before Wave 2 — if it requires a real DB, Wave 2 must run *after* Wave 1's migration is applied to the test DB, which breaks the parallel-safe claim. Worth a 2-minute check during planning.
3. **Task 0 ground-truth — does the DEV environment have the April blackout rows already loaded?** If yes, the planner can run the SELECT DISTINCT query immediately. If DEV is synthetic-only (per `05-09-PLAN.md` — "Seed ≥50 recent synthetic transactions"), the blackout pattern may not exist in DEV and must be verified on a different artifact.

---

## Sources

### Primary (HIGH confidence)
- `supabase/migrations/0007_stg_orderbird_order_items.sql` — staging schema (read in full)
- `supabase/migrations/0008_transactions_columns.sql` — existing `transactions` columns
- `supabase/migrations/0018_transactions_filterable_v.sql` — Phase 6 view definition (read in full)
- `scripts/ingest/normalize.ts` — existing reducer + `normalizePaymentMethod` helper
- `scripts/ingest/parse.ts` — header validator (29 columns confirmed)
- `scripts/ingest/types.ts` — `TxRow` interface shape
- `scripts/ingest/upsert.ts` — batch writer (no change needed)
- `src/lib/filters.ts` — Phase 6 zod schema
- `src/lib/components/FilterSheet.svelte` — draft-and-apply sheet pattern
- `src/lib/components/MultiSelectDropdown.svelte` — draft-state multi-select
- `src/routes/+page.server.ts:213-231` — existing distinct-option loader pattern
- `tests/ingest/fixtures/sample.csv` — invoice-grain data shape proof (T-3, T-11 wl_* columns identical across rows)
- `tests/ingest/normalize.test.ts` — existing test pattern for loader unit tests
- [PostgreSQL 17 CREATE VIEW docs](https://www.postgresql.org/docs/17/sql-createview.html) — CREATE OR REPLACE VIEW append-column rule
- `.planning/phases/07-column-promotion/07-CONTEXT.md` — D-01..D-07 locked decisions

### Secondary (MEDIUM confidence)
- `.planning/phases/02-ingestion/02-04-REAL-RUN.md` — referenced via CONTEXT.md for the 772-row April blackout; not re-read for this phase (not required for implementation decisions)

### Tertiary (LOW confidence)
- None — every claim in this document is backed by a primary source or explicit D-0x decision.

---

## Metadata

**Confidence breakdown:**
- Focus Q1 (DISTINCT ON determinism): HIGH — fixture + schema + reducer all agree
- Focus Q2 (normalization helpers): HIGH — exhaustive grep of `scripts/ingest/`
- Focus Q3 (view refresh strategy): HIGH — Postgres 17 docs authoritative
- Loader insertion point: HIGH — line-level citations in `normalize.ts` + `types.ts` + `upsert.ts`
- FilterSheet meta-option approach: HIGH — mirrors Phase 6 DX, minimal new component
- Task 0 ground-truth query: MEDIUM — depends on DEV having real-world card_type distribution, not just synthetic seed data (see Open Question 3)
- Test coverage plan: HIGH — aligns with D-07 locked requirements

**Research date:** 2026-04-16
**Valid until:** 2026-05-16 (30 days — Phase 6 infrastructure is stable, Postgres + Supabase are stable, CONTEXT decisions are locked)
