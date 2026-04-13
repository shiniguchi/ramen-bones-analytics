# Phase 2: Ingestion — Research

**Researched:** 2026-04-14
**Domain:** CSV ingestion, idempotent upsert, invoice-grain normalization, PII hashing
**Confidence:** HIGH (real CSV profiled; all decisions verified against ground truth)

## Summary

Phase 2 builds a TypeScript + Node loader (`npm run ingest`) that reads `ramen_bones_order_items.csv` from Supabase Storage, computes `sha256(wl_card_number || restaurant_id)` in memory, and upserts two grains: `stg_orderbird_order_items` (1:1 item-level mirror, 20,948 rows in the current file) and `transactions` (one row per unique `invoice_number`, 6,842 rows). The CSV was profiled directly: 29 ASCII columns, comma-delimited, dot-decimals (NOT German decimal commas), `YYYY-MM-DD` dates, Europe/Berlin local time strings, no Unicode quoting traps.

**Real-data findings worth surfacing to the planner before coding:**
1. Only **one** invoice has correction rows: `1-211` (3 positive + 3 negative rows, all cash). The founder's pre-joiner also created a **recovered invoice `1-212 (ex-211)`** with 3 MasterCard rows where `is_cash` is blank (not `True`/`False`). Loader must treat blank `is_cash` as "infer from `payment_method != 'Bar'`".
2. `invoice_number` can contain **spaces and parentheses** (`1-212 (ex-211)`). Regex/format assumptions will break.
3. **4,478 rows have blank `wl_card_number`** — 3,706 are `Bar` (cash, expected), **but 772 are card rows where Worldline enrichment is missing**, plus 4 `Auf Rechnung` (invoice billing). CONTEXT D-08 says "NULL `wl_card_number` ⇒ NULL `card_hash` ⇒ excluded from cohort" — that bundles 772 real card payments into the cash/anonymous bucket. **Planner must decide**: accept the loss (simplest, matches D-08 verbatim) or fall back to a secondary identity key (`card_txn_id` + `card_last4`) for those 772 rows.
4. `payment_method` has **case variants** (`MasterCard`/`MASTERCARD`, `Visa`/`VISA`) — normalize on write so Phase 3 GROUP BY works.
5. CONTEXT worried about "stray numeric values in `sales_type`" — **not present** in the real file (only `INHOUSE`/`TAKEAWAY`). Strict parser is still correct per D-06, but this specific fragility is absent.
6. Phase 1 `transactions` skeleton has `gross_cents integer NOT NULL` and `net_cents integer NOT NULL` — **this phase MUST populate them** and the planner must add `invoice_total_eur numeric` et al. via `ALTER TABLE` or reuse the existing `*_cents` columns.

**Primary recommendation:** TypeScript loader using `csv-parse/sync` + `@supabase/supabase-js` with service_role. Stream-read CSV, compute hashes in memory, batch-upsert staging in 500-row chunks, then reduce to invoice grain in TS and upsert `transactions`. Use `gross_cents` / `net_cents` (integer) to eliminate float rounding at invoice totals — derive from `Math.round(parseFloat(x) * 100)`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Loader Language & Runtime**
- **D-01:** Loader is **TypeScript + Node** (`npm run ingest`), not Python. Rationale: one-stack forkability; Phase 3/4 are TS/SQL; no pandas-shaped work in the hot path.
- **D-02:** Loader uses `@supabase/supabase-js` with the **service_role key** (env only, never checked in). Service_role bypasses RLS.

**Two-Grain Schema**
- **D-03:** `stg_orderbird_order_items` is a **1:1 mirror of the CSV's 29 columns** plus three loader-added columns: `restaurant_id uuid NOT NULL`, `ingested_at timestamptz NOT NULL DEFAULT now()`, `source_file text NOT NULL`. PK: composite on `(restaurant_id, invoice_number, item_name, quantity, item_gross_amount_eur)` — natural-key dedupe within an invoice. Alternative (planner's call): synthetic `(invoice_number, item_order_in_invoice)`.
- **D-04:** `transactions` is **populated with one row per unique `invoice_number`** (invoice-grain). `source_tx_id = invoice_number` (NOT `order_id`). Columns: `restaurant_id`, `source_tx_id`, `occurred_at` (parsed from `date + time` as `Europe/Berlin` local → UTC), `card_hash`, plus `invoice_total_eur`, `tip_eur`, `payment_method`, `sales_type`. Planner finalizes exact column set against Phase 3 MV needs.
- **D-05:** **Invoice-level dedup at load time, not query time.** For each group of CSV rows sharing `invoice_number`, the loader takes `invoice_total_eur`, `tip_eur`, `payment_method`, `sales_type`, `occurred_at`, `card_hash` from the first row (all identical per invoice — founder verified).

**CSV Quality & Parsing**
- **D-06:** Loader is **strict** — any misaligned row fails the entire ingest. No tolerant mode, no `ingest_errors` table. Founder fixes the pre-joiner and re-runs.

**Card Hashing (PII Guard)**
- **D-07:** `card_hash = sha256(wl_card_number || restaurant_id::text)`, computed in the loader **before any DB write**. Raw `wl_card_number` never reaches Supabase.
- **D-08:** Cash rows (`wl_card_number IS NULL`) ⇒ `card_hash = NULL` ⇒ excluded from cohort/LTV/retention. `kpi_daily_v` still counts cash revenue.
- **D-09:** `card_last4`, `wl_card_number`, `wl_card_type`, `wl_payment_type`, `wl_issuing_country`, `card_txn_id` are stored **only in staging** — never in `transactions`. Extend `pii-columns.txt` with these six names.

**Void / Refund / Correction Semantics**
- **D-10:** Cancellations already filtered by pre-joiner (262 upstream, 0 in CSV). Loader trusts this.
- **D-11:** Correction pairs (positive + negative line items within one invoice) stay in staging; filtered from `transactions` via `WHERE invoice_total_eur >= 0` at dedup.
- **D-12:** `tip_eur` and `invoice_total_eur` are invoice-level (repeated per row). Never `SUM()` them from staging — always query `transactions`.

**CSV Source & Delivery**
- **D-13:** CSV lives in a **private Supabase Storage bucket** (name TBD by planner; suggest `orderbird-raw`). Service_role read-only.
- **D-14:** `orderbird_data/` goes to `.gitignore`. No CSV/XLSX/XML/PDF ever committed.
- **D-15:** Migration adds Storage bucket + service-role-only read policy.

**Ingest Trigger**
- **D-16:** v1 ingest is **manual** (`npm run ingest`). Upload CSV to Storage → run loader → loader downloads + processes.
- **D-17:** Loader is **fully idempotent**: re-running produces zero diffs. `transactions` upsert on `(restaurant_id, source_tx_id)`. Staging upsert on natural-key composite or synthetic row index (planner locks).
- **D-18:** Loader output: summary line (`X rows read, Y invoices deduped, Z new transactions, W updated, 0 errors`). Non-zero exit on error.

**Environment & Secrets**
- **D-19:** Env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ORDERBIRD_CSV_BUCKET`, `ORDERBIRD_CSV_OBJECT`, `RESTAURANT_ID`.
- **D-20:** Fail fast if any env var missing.

**Testing**
- **D-21:** Vitest integration test with ~20-row fixture covering: normal invoice, split-bill, cash, card, correction pair, tip > 0, tip = 0, INHOUSE + TAKEAWAY. Assertions listed in CONTEXT D-21.
- **D-22:** Fixture at `tests/fixtures/orderbird_sample.csv` — synthetic, committed.

### Claude's Discretion
- Exact column list added to `transactions` beyond locked minimum.
- `csv-parse/sync` vs streaming.
- Batch chunk size for `supabase-js upsert()`.
- Directory: `scripts/ingest/` vs `src/ingest/`.
- Whether to add `--dry-run` flag (recommended).
- Exact staging PK shape (natural vs synthetic).
- Error message / log format.

### Deferred Ideas (OUT OF SCOPE)
- Scheduled ingest (cron / pg_cron / Storage webhook) — Phase 5.
- Playwright scraper, GHA cron, `storageState` session management, captcha alerting — deferred indefinitely.
- `transaction_items` normalized table — staging serves item-grain queries.
- Tolerant CSV parser with `ingest_errors` quarantine.
- Multi-file / historical backfill (v1 is one CSV per run).
- DATEV XML / Worldline raw export ingestion — these feed the pre-joiner, not Supabase.
- Ingest UI / drag-drop upload page.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ING-01 | Loader reads `ramen_bones_order_items.csv` and upserts into `stg_orderbird_order_items` | CSV profiled: 29 columns, ASCII, 20,948 rows, dot decimals, comma-delimited; Supabase Storage `storage.from().download()` returns a `Blob` — parse with `csv-parse/sync` |
| ING-02 | Ingest idempotent via `(restaurant_id, source_tx_id)`; **source_tx_id = `invoice_number`** per CONTEXT D-04 (overrides REQUIREMENTS.md wording of `order_id`) | `supabase-js.upsert({ onConflict: 'restaurant_id,source_tx_id' })`; 6,842 unique invoices in the current file; `order_id` is NOT unique per invoice (avg 3 per invoice, max 17 for split-bills) |
| ING-03 | Normalization promotes to `transactions` with documented handling of voids, refunds, tips, brutto/netto | Voids already filtered upstream (D-10); correction pairs filtered via `invoice_total_eur >= 0`; tips are invoice-level (first-row-per-group); `tax_rate_pct` only 19.0/7.0; `item_gross_amount_eur` IS gross — net = `gross / (1 + rate/100)`; use `gross_cents`/`net_cents` integer columns from Phase 1 skeleton to avoid float drift |
| ING-04 | `card_hash = sha256(wl_card_number \|\| restaurant_id)` computed pre-write; cash → NULL → excluded from cohort | Node `crypto.createHash('sha256')`; 4,478 blank `wl_card_number` rows in current file (3,706 Bar + 772 card-without-enrichment + 4 Auf Rechnung) → all get NULL `card_hash` per D-08 |
| ING-05 | Founder reviews ≥20 real rows before normalization finalized | UAT gate — the fixture CSV (D-22) is the artifact of this review; planner must add an explicit UAT step that produces a signed-off summary of real-row sampling |
</phase_requirements>

## Standard Stack

### Core
| Library | Version (verified 2026-04-14) | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@supabase/supabase-js` | 2.103.0 (already installed) | DB + Storage client | Service-role client for upsert; `storage.from(bucket).download(path)` returns Blob |
| `csv-parse` | 6.2.1 | Strict CSV parser | Battle-tested; supports `columns: true` for DictReader-like rows, `cast: true` for type coercion, `relax_column_count: false` for strict mode (D-06) |
| `tsx` | 4.21.0 (already installed) | Run TS loader directly | Already the project's TS runner; `npm run ingest` → `tsx scripts/ingest/index.ts` |
| `dotenv` | 17.4.2 (already installed) | `.env` loader | Already used by `tests/setup.ts` pattern |
| Node built-in `crypto` | — | SHA-256 hashing | `createHash('sha256').update(pan + restaurantId).digest('hex')` — no dependency |
| Node built-in `date-fns-tz` OR manual | 3.2.0 (if used) | Europe/Berlin → UTC | Needed for `occurred_at` conversion. Alternative: one-liner `new Date(\`${date}T${time}+02:00\`)` is WRONG across DST. **Use `date-fns-tz.fromZonedTime(\`${date} ${time}\`, 'Europe/Berlin')`** to handle CET/CEST correctly |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `date-fns-tz` | 3.2.0 | DST-correct timezone math | Required for `occurred_at` — the dataset spans 2025-06-11 → 2026-04-11, crossing 2 DST transitions |
| `vitest` | 1.6.1 (already installed) | Integration test (D-21) | Already the project's test runner |

**Installation:**
```bash
npm install csv-parse date-fns-tz
```

**Version verification (2026-04-14):**
- `csv-parse@6.2.1` — `npm view csv-parse version` confirmed
- `@supabase/supabase-js@2.103.0` — already in `package.json`
- `date-fns-tz@3.2.0` — `npm view date-fns-tz version` confirmed

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `csv-parse/sync` | `csv-parse` streaming | 5 MB / 20k rows is trivial in memory; sync is simpler and strict mode is cleaner |
| `date-fns-tz` | Luxon | Both correct; date-fns-tz has smaller bundle; project already aligned to date-fns ecosystem per `CLAUDE.md` |
| In-TS dedup | SQL RPC with `DISTINCT ON (invoice_number)` | TS dedup is explicit, unit-testable, and faster to reason about for founder review. SQL RPC would bury semantics behind a function. Stay in TS. |
| `crypto.createHash` | `@noble/hashes` | Built-in is zero-dep and sufficient for SHA-256 |

## Architecture Patterns

### Recommended Project Structure
```
scripts/
└── ingest/
    ├── index.ts           # Entry point (wired to `npm run ingest`)
    ├── env.ts             # Env var loader + fail-fast validation (D-19/D-20)
    ├── download.ts        # Supabase Storage object fetch (D-13)
    ├── parse.ts           # csv-parse/sync wrapper (strict mode, D-06)
    ├── hash.ts            # sha256(wl_card_number + restaurant_id) (D-07)
    ├── normalize.ts       # row → staging-shape + invoice-grain reducer (D-05/D-11)
    ├── upsert.ts          # supabase-js batch upsert (500-row chunks)
    └── report.ts          # CLI summary output (D-18)

tests/
├── fixtures/
│   └── orderbird_sample.csv   # ~20 rows, synthetic, committed (D-22)
└── integration/
    └── ingest.test.ts         # D-21 integration test

supabase/migrations/
├── 0007_stg_orderbird_order_items.sql  # Staging table + PK
├── 0008_transactions_columns.sql       # ALTER transactions add cols
└── 0009_storage_bucket.sql             # Private bucket + service-role policy
```

### Pattern 1: Supabase Storage Download (service-role)
```typescript
// scripts/ingest/download.ts
import { createClient } from '@supabase/supabase-js';

export async function downloadCsv(url: string, key: string, bucket: string, object: string): Promise<string> {
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await supabase.storage.from(bucket).download(object);
  if (error) throw new Error(`Storage download failed: ${error.message}`);
  return await data.text();  // Blob → UTF-8 string
}
```

### Pattern 2: Strict csv-parse/sync with column validation
```typescript
// scripts/ingest/parse.ts
import { parse } from 'csv-parse/sync';

const EXPECTED_COLUMNS = [
  'date', 'time', 'item_name', 'quantity', 'item_price_eur', 'category_name',
  'category_kind', 'table_name', 'tab_name', 'party_name', 'invoice_number',
  'tax_rate_pct', 'sales_type', 'item_gross_amount_eur', 'invoice_total_eur',
  'payment_method', 'processor', 'tip_eur', 'given_eur', 'change_eur',
  'card_type', 'card_last4', 'card_txn_id', 'is_cash', 'order_id',
  'wl_card_number', 'wl_card_type', 'wl_payment_type', 'wl_issuing_country'
] as const;

export function parseCsv(text: string): Record<string, string>[] {
  const rows = parse(text, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: false,  // D-06 strict
    relax_quotes: false,
    trim: false,
  }) as Record<string, string>[];
  if (rows.length === 0) throw new Error('CSV is empty');
  const actual = Object.keys(rows[0]);
  if (actual.length !== EXPECTED_COLUMNS.length || actual.some((c, i) => c !== EXPECTED_COLUMNS[i])) {
    throw new Error(`Column mismatch. Expected ${EXPECTED_COLUMNS.join(',')}. Got ${actual.join(',')}.`);
  }
  return rows;
}
```

### Pattern 3: Invoice-grain reducer (D-05 + D-11)
```typescript
// scripts/ingest/normalize.ts — pseudocode
function toTransactions(staging: StagingRow[], restaurantId: string): TxRow[] {
  const byInvoice = new Map<string, StagingRow[]>();
  for (const r of staging) {
    const k = r.invoice_number;
    (byInvoice.get(k) ?? byInvoice.set(k, []).get(k)!).push(r);
  }
  const out: TxRow[] = [];
  for (const [invoice, rs] of byInvoice) {
    const first = rs[0];
    const total_eur = parseFloat(first.invoice_total_eur);
    if (total_eur < 0) continue;  // D-11: filter correction-pair "negative" groups
    out.push({
      restaurant_id: restaurantId,
      source_tx_id: invoice,
      occurred_at: toBerlinUtc(first.date, first.time),
      card_hash: hashCard(first.wl_card_number, restaurantId),  // NULL if blank
      gross_cents: Math.round(total_eur * 100),
      net_cents:   Math.round((total_eur / (1 + parseFloat(first.tax_rate_pct) / 100)) * 100),
      tip_eur:     parseFloat(first.tip_eur),
      payment_method: normalizePaymentMethod(first.payment_method),  // case-fold
      sales_type:  first.sales_type,
    });
  }
  return out;
}
```

### Pattern 4: date-fns-tz for Europe/Berlin → UTC
```typescript
// scripts/ingest/normalize.ts
import { fromZonedTime } from 'date-fns-tz';

function toBerlinUtc(date: string, time: string): string {
  // date='2025-06-11', time='16:34:15' — ISO-like local Berlin wall-clock
  return fromZonedTime(`${date}T${time}`, 'Europe/Berlin').toISOString();
}
```

### Pattern 5: Batch upsert with onConflict
```typescript
// scripts/ingest/upsert.ts
const CHUNK = 500;
for (let i = 0; i < rows.length; i += CHUNK) {
  const batch = rows.slice(i, i + CHUNK);
  const { error } = await supabase
    .from('transactions')
    .upsert(batch, { onConflict: 'restaurant_id,source_tx_id', ignoreDuplicates: false });
  if (error) throw new Error(`Upsert failed at chunk ${i}: ${error.message}`);
}
```

### Anti-Patterns to Avoid
- **Computing `net_cents` as `gross_eur * 100 / 1.19` in floating point then storing.** Round after multiplication, not before: `Math.round(gross_eur * 100 / (1 + rate/100))`.
- **Parsing `${date}T${time}+02:00` with `new Date()`.** Hard-codes CEST offset; breaks for rows in CET (Oct–Mar) — dataset spans both.
- **Summing `tip_eur` from `stg_orderbird_order_items`.** Invoice-level tip is repeated on every item row — summing multiplies by line-item count. D-12 forbids this; Phase 3 queries `transactions`.
- **Using `order_id` as upsert key.** Not unique — split-bill invoices have up to 17 distinct `order_id` values for one `invoice_number`. Requirements doc says `order_id`; CONTEXT D-04 overrides to `invoice_number`. Follow CONTEXT.
- **Assuming `invoice_number` matches `^\d+-\d+$`.** Real file contains `1-212 (ex-211)` — spaces and parentheses. Store as `text`.
- **Treating `is_cash` as strict boolean.** 3 rows in the real file have empty string — infer from `payment_method == 'Bar'` instead.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CSV parsing | Regex / `string.split(',')` | `csv-parse/sync` | `item_name` contains no commas in real file but `party_name` could ("Party 1 (recovered)"); quoted fields, embedded commas, CRLF variants all handled |
| Timezone math | Manual offset strings | `date-fns-tz.fromZonedTime` | DST transitions; dataset spans CET↔CEST twice |
| SHA-256 | JS ports | Node `crypto` (built-in) | Zero-dep, FIPS-grade |
| Idempotent insert | `SELECT ... INSERT IF NOT EXISTS` loop | `supabase-js.upsert({ onConflict })` | Atomic per chunk, single round trip |
| Number → cents | `Math.floor(x * 100)` | `Math.round(x * 100)` | Float `35.5 * 100 = 3549.9999...`; floor loses a cent |

## Runtime State Inventory

> This is a greenfield ingestion phase (no rename/refactor). Inventory section omitted per template guidance.

## Common Pitfalls

### Pitfall 1: `invoice_number` assumed to be `\d+-\d+`
**What goes wrong:** Loader crashes or silently misroutes row when parsing `1-212 (ex-211)`.
**Why it happens:** Founder's pre-joiner created a "recovered" invoice after the correction pair in `1-211`. Format is opaque.
**How to avoid:** Treat `invoice_number` as an opaque text blob. No validation, no parsing. Store verbatim.
**Warning signs:** Any regex on `invoice_number` in the loader; any numeric cast.

### Pitfall 2: 772 card rows silently re-classified as cash
**What goes wrong:** D-08 says "blank `wl_card_number` ⇒ NULL hash ⇒ excluded from cohort". Real file has 772 rows where `payment_method != 'Bar'` but `wl_card_number` is blank (missing Worldline enrichment) — plus 4 `Auf Rechnung`. These **are** identifiable transactions (they have `card_txn_id` and `card_last4`) but the loader will drop them from cohort per D-08.
**Why it happens:** Pre-joiner couldn't match Orderbird row to a Worldline row (timing gap, different batch, failed enrichment).
**How to avoid:** **Planner must decide**:
  - **(a)** Accept the loss. Write a `normalize.ts` comment quoting D-08 and the real-file count (`776 non-Bar rows lose cohort membership`). Safest, matches CONTEXT verbatim.
  - **(b)** Fall back: `wl_card_number ?? (card_txn_id && card_last4 ? sha256(card_txn_id + card_last4 + restaurant_id) : null)`. More identities preserved but hashes are NOT comparable to Worldline-enriched rows for the SAME physical card — would fragment cohorts.
  - **(c)** Reject the CSV until the pre-joiner fills the gap. Strictest per D-06 spirit, but blocks ingest on a non-fatal data issue.
  Recommend **(a)** for v1; flag count in `report.ts` output so founder sees the loss on every run.
**Warning signs:** `report.ts` prints fewer cohort-eligible transactions than expected.

### Pitfall 3: Case-variant `payment_method` breaks Phase 3 GROUP BY
**What goes wrong:** `MasterCard` (7,362 rows) and `MASTERCARD` (2 rows) produce two buckets in a `SUM ... GROUP BY payment_method` KPI.
**Why it happens:** Orderbird UI accepted both casings over time; pre-joiner preserved them.
**How to avoid:** Normalize in `normalize.ts` before writing to `transactions`. Keep the raw string in staging (1:1 mirror per D-03). Canonical set: `MasterCard`, `Visa`, `Maestro`, `Visa Electron`, `V PAY`, `Bar`, `Auf Rechnung`, `DKB Visa Debit`, `Debit Mastercard`.
**Warning signs:** Phase 3 KPI shows 2 "Mastercard"-like buckets.

### Pitfall 4: DST off-by-one for rows near 03:00 local on transition weekends
**What goes wrong:** `new Date('2025-10-26T02:30:00+02:00')` — during CET switchover at 03:00, that wall-clock time exists twice. Naive offset is wrong.
**How to avoid:** `date-fns-tz.fromZonedTime('2025-10-26 02:30:00', 'Europe/Berlin')` handles the disambiguation by convention (first occurrence wins — matches Orderbird's clock).
**Warning signs:** Rows on DST transition weekends land on the wrong `business_date`.

### Pitfall 5: Float drift on invoice totals
**What goes wrong:** `Math.round(35.5 * 100)` is `3550`, but `Math.round(parseFloat('35.55') * 100)` can drift. Over 6,842 invoices the cents-sum disagrees with the euro-sum by 1–3 cents.
**How to avoid:** Always use `Math.round(x * 100)` (never `Math.floor` or `Math.trunc`). Store both `gross_cents` (phase 1 skeleton column) and `invoice_total_eur numeric(10,2)` if planner adds it, but treat `gross_cents` as the source of truth for sums.
**Warning signs:** KPI totals drift by small amounts run-to-run.

### Pitfall 6: Staging PK collision on split-bills
**What goes wrong:** CONTEXT D-03's proposed PK `(restaurant_id, invoice_number, item_name, quantity, item_gross_amount_eur)` **collides** in invoice `1-211`: two rows `('Jiro-Kei Ramen', 1, 15.0)` are present (split-bill, different `order_id`). Upsert will overwrite not insert, and staging row count will diverge from CSV row count — breaking D-21 assertion 1.
**How to avoid:** Use synthetic PK `(restaurant_id, invoice_number, row_index)` where `row_index` is a 1-based sequence within each invoice assigned in TS before upsert. This matches D-03's "Alternative" clause.
**Warning signs:** `stg_orderbird_order_items` row count < CSV row count after ingest.

### Pitfall 7: Blank `is_cash` breaks boolean mapping
**What goes wrong:** 3 rows in `1-212 (ex-211)` have empty-string `is_cash`. A `boolean NOT NULL` column in staging rejects them.
**How to avoid:** Store `is_cash text` (1:1 mirror per D-03) OR derive as `is_cash boolean GENERATED ALWAYS AS (payment_method = 'Bar') STORED`. Don't trust the CSV value.

## Code Examples

### SHA-256 card hash
```typescript
// scripts/ingest/hash.ts
import { createHash } from 'node:crypto';

export function hashCard(wlCardNumber: string | null | undefined, restaurantId: string): string | null {
  if (!wlCardNumber || wlCardNumber.trim() === '') return null;  // D-08
  return createHash('sha256').update(wlCardNumber + restaurantId).digest('hex');
}
```

### Env fail-fast (D-20)
```typescript
// scripts/ingest/env.ts
const REQUIRED = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ORDERBIRD_CSV_BUCKET',
  'ORDERBIRD_CSV_OBJECT',
  'RESTAURANT_ID',
] as const;

export function loadEnv() {
  const missing = REQUIRED.filter(k => !process.env[k]);
  if (missing.length) {
    console.error(`Missing env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
  return Object.fromEntries(REQUIRED.map(k => [k, process.env[k]!])) as Record<typeof REQUIRED[number], string>;
}
```

### Report line (D-18)
```typescript
console.log(JSON.stringify({
  rows_read,
  invoices_deduped,
  staging_upserted,
  transactions_new,
  transactions_updated,
  cash_rows_excluded,         // cohort visibility
  missing_worldline_rows,     // Pitfall 2 — founder visibility
  errors: 0,
}));
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@supabase/auth-helpers-sveltekit` | `@supabase/ssr` | 2024 | N/A to loader (service-role only) but don't accidentally import the deprecated package |
| Manual JSON PATCH to `rest/v1` | `supabase-js.upsert()` | — | Use the client; it handles retries + batching idioms |
| `pg_cron` weekly scrape + ingest | Manual `npm run ingest` after out-of-band pre-join | 2026-04 (this phase) | Simpler v1; scheduled ingest deferred to Phase 5 |

**Deprecated/outdated:**
- Python loader + `pandas` + `supabase-py` — explicitly rejected in CONTEXT D-01 for forkability reasons.
- `order_id` as `source_tx_id` — rejected in CONTEXT D-04 after real-data finding (max 17 `order_id`s per invoice).

## Open Questions

1. **772 card rows with blank `wl_card_number` — accept the cohort loss or add a fallback identity?**
   - What we know: CONTEXT D-08 says NULL → cohort exclusion. Real file has 772 cases where this loses real card transactions.
   - What's unclear: Whether founder accepts this trade-off, since D-08 was likely written assuming "blank wl_card_number = cash" (which is only 3,706 of the 4,478 blanks).
   - Recommendation: Implement (a) — accept loss, surface the count in report output, let founder see it on first run and decide.

2. **Staging PK shape — natural composite or synthetic row index?**
   - What we know: CONTEXT D-03 leaves it to planner. Natural composite collides on split-bill rows (Pitfall 6).
   - What's unclear: Nothing — this is a technical choice.
   - Recommendation: Synthetic `(restaurant_id, invoice_number, row_index)`. Deterministic (assign by CSV row order within invoice), idempotent (re-running the same CSV produces the same row_index), and collision-free.

3. **Column list added to `transactions` — `gross_cents`/`net_cents` only, or also `invoice_total_eur numeric`?**
   - What we know: Phase 1 migration 0003 has `gross_cents integer NOT NULL` and `net_cents integer NOT NULL`. CONTEXT D-04 names `invoice_total_eur numeric`.
   - What's unclear: Whether to reuse existing cents columns or add parallel euro columns.
   - Recommendation: Use existing `gross_cents` / `net_cents` as source of truth; ADD `tip_cents integer NOT NULL DEFAULT 0`, `payment_method text NOT NULL`, `sales_type text NOT NULL`. No parallel euro columns. Phase 3 MVs format for display.

4. **Fixture CSV — 20 rows enough to cover all D-21 cases?**
   - Recommendation: 24+ rows to cover: (a) 3-item normal invoice, (b) 2-order split-bill invoice, (c) 1-row cash, (d) 1-row card w/ tip, (e) 1-row card w/o tip, (f) 6-row correction-pair invoice (3 positive + 3 negative), (g) 2-row TAKEAWAY invoice, (h) 1-row missing-wl_card_number card.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Loader runtime | ✓ (presumed — Phase 1 ships on it) | — | — |
| npm | Install csv-parse, date-fns-tz | ✓ | — | — |
| Supabase CLI | Apply migrations 0007–0009 to DEV | ✓ (Phase 1 uses it) | — | — |
| Supabase DEV project | Target for loader | ✓ | — | — |
| Supabase TEST project | D-21 integration test | ✓ (Phase 1 set up) | — | — |
| `orderbird_data/5-JOINED_DATA_*/ramen_bones_order_items.csv` | Source CSV | ✓ (gitignored, on founder's disk) | — | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 1.6.1 (already in `package.json`) |
| Config file | `package.json` `scripts.test` = `vitest run`; no standalone config |
| Quick run command | `npx vitest run tests/integration/ingest.test.ts` |
| Full suite command | `npm test` |
| Test DB | Supabase TEST project (separate from DEV per Phase 1 D-16) |
| Test env loader | `tests/setup.ts` — already imports `dotenv/config` + refuses DEV target |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ING-01 | Loader reads CSV from Storage and upserts into staging | integration | `npx vitest run tests/integration/ingest.test.ts -t "staging row count matches CSV"` | ❌ Wave 0 |
| ING-02 | Idempotent `(restaurant_id, source_tx_id)` upsert — re-run = zero diffs | integration | `npx vitest run tests/integration/ingest.test.ts -t "re-run produces zero diffs"` | ❌ Wave 0 |
| ING-03 | Normalization: voids filtered, tips invoice-level, gross/net correct, payment_method normalized | unit | `npx vitest run tests/unit/normalize.test.ts` | ❌ Wave 0 |
| ING-03 | Negative `invoice_total_eur` groups excluded from `transactions` | unit | `npx vitest run tests/unit/normalize.test.ts -t "correction pair filtered"` | ❌ Wave 0 |
| ING-03 | `tip_eur` / `invoice_total_eur` taken from first row (no item-count multiply) | unit + integration | `npx vitest run tests/integration/ingest.test.ts -t "tip sum equals hand-calculated"` | ❌ Wave 0 |
| ING-03 | `occurred_at` correct across DST transition (fixture row on 2025-10-26) | unit | `npx vitest run tests/unit/normalize.test.ts -t "DST transition row"` | ❌ Wave 0 |
| ING-04 | `card_hash = sha256(wl_card_number + restaurant_id)` — exact byte match | unit | `npx vitest run tests/unit/hash.test.ts` | ❌ Wave 0 |
| ING-04 | Cash rows (blank `wl_card_number`) → NULL `card_hash` | unit + integration | `npx vitest run tests/unit/hash.test.ts -t "cash returns null"` | ❌ Wave 0 |
| ING-04 | Raw `wl_card_number` never present in `transactions` table | integration | `npx vitest run tests/integration/ingest.test.ts -t "no raw PAN in transactions"` (query asserts `transactions` has no column matching wl_card_number) | ❌ Wave 0 |
| ING-04 | `pii-columns.txt` extended; CI guard 4 still green | ci | `bash scripts/ci-guards.sh` | ✅ (extend manifest only) |
| ING-05 | Founder reviewed ≥20 real rows (fixture reflects this review) | manual-gate | `cat tests/fixtures/orderbird_sample.csv \| wc -l` ≥ 21 (header + 20 rows) + UAT sign-off in phase summary | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test` (fast — <10s with small fixture)
- **Per wave merge:** `npm test && bash scripts/ci-guards.sh`
- **Phase gate:** Full suite green + `npm run ingest` executed once against DEV with the real 20,948-row CSV and founder review of the report output before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/fixtures/orderbird_sample.csv` — synthetic 24+-row fixture covering all D-21 cases + DST transition row + missing-wl_card_number card row
- [ ] `tests/unit/hash.test.ts` — SHA-256 exact-match + NULL-on-blank
- [ ] `tests/unit/normalize.test.ts` — invoice-grain reducer, correction-pair filter, payment_method normalization, DST conversion
- [ ] `tests/integration/ingest.test.ts` — end-to-end against TEST Supabase project using fixture CSV
- [ ] `supabase/migrations/0007_stg_orderbird_order_items.sql` — staging table (synthetic PK)
- [ ] `supabase/migrations/0008_transactions_columns.sql` — ALTER transactions ADD COLUMN (tip_cents, payment_method, sales_type)
- [ ] `supabase/migrations/0009_storage_bucket.sql` — Storage bucket + service-role-only read policy
- [ ] `scripts/ingest/{index,env,download,parse,hash,normalize,upsert,report}.ts` — loader implementation
- [ ] `package.json` — add `"ingest": "tsx scripts/ingest/index.ts"` script + csv-parse + date-fns-tz deps
- [ ] `pii-columns.txt` — append `wl_card_number`, `card_last4`, `card_txn_id`, `wl_card_type`, `wl_payment_type`, `wl_issuing_country`
- [ ] `.gitignore` — add `orderbird_data/` (D-14)

## Sources

### Primary (HIGH confidence)
- **Real CSV profile:** `/Users/shiniguchi/development/ramen-bones-analytics/orderbird_data/5-JOINED_DATA_20250611_20260411/ramen_bones_order_items.csv` — 20,948 rows × 29 columns, profiled directly with Python `csv.DictReader` (2026-04-14)
- **Phase 1 schema:** `supabase/migrations/0001_tenancy_schema.sql`, `0003_transactions_skeleton.sql`, `0005_seed_tenant.sql`
- **Phase 1 CI guards:** `scripts/ci-guards.sh`
- **Phase 2 CONTEXT:** `.planning/phases/02-ingestion/02-CONTEXT.md` — all D-01..D-22 locked decisions
- **REQUIREMENTS.md:** ING-01..ING-05 (note: ING-02 text says `source_tx_id = order_id`; CONTEXT D-04 overrides to `invoice_number` — CONTEXT wins)
- **npm registry:** `csv-parse@6.2.1`, `@supabase/supabase-js@2.103.0`, `date-fns-tz@3.2.0` (verified via `npm view` 2026-04-14)

### Secondary (MEDIUM confidence)
- `csv-parse` strict mode options — cross-verified against Node.js ecosystem knowledge; `columns: true` + `relax_column_count: false` is the canonical strict config
- `supabase-js.storage.from().download()` returns a `Blob` with `.text()` — standard Supabase JS client API

### Tertiary (LOW confidence)
- None — all critical claims verified against real data or official code.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions verified against npm registry today
- CSV semantics: HIGH — profiled directly from real 20,948-row file
- Architecture patterns: HIGH — derived from CONTEXT locked decisions + real-data constraints
- Pitfalls: HIGH — 6 of 7 pitfalls surfaced by direct CSV inspection (not speculation)
- Open question #1 (772 Worldline-missing rows): MEDIUM — real count is certain, but the right policy is a founder call

**Research date:** 2026-04-14
**Valid until:** 2026-05-14 (30 days — stack is stable; real data file is static until founder re-runs pre-joiner)
