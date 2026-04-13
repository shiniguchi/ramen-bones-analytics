# Phase 2: Ingestion - Context

**Gathered:** 2026-04-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver an idempotent, re-runnable TypeScript loader that reads a pre-joined Orderbird CSV from Supabase Storage and writes it into two Postgres grains: item-level staging (`stg_orderbird_order_items`, 1:1 mirror of CSV) and invoice-level normalized (`transactions`, one row per `invoice_number`). Card identity is hashed before any DB write. Phase 3 analytics MVs consume from these two tables only.

**Explicitly out of scope for this phase:**
- Playwright scraper for `my.orderbird.com` — not built, not planned. CSV is produced out-of-band by the founder via Claude coworking (enrichment pipeline in a separate workflow).
- GitHub Actions cron for scraping, `storageState` session management, captcha/login-break alerting.
- Any item-level dedicated table (e.g., `transaction_items`) — staging serves item-grain queries directly.
- Analytical SQL (cohort, LTV, KPI, retention MVs) — Phase 3.
- Dashboard UI — Phase 4.
- Scheduled / webhook-triggered ingestion — v1 is manual (`npm run ingest`). Deferred to Phase 5 if needed.

</domain>

<decisions>
## Implementation Decisions

### Loader Language & Runtime
- **D-01:** Loader is **TypeScript + Node** (`npm run ingest`), not Python. Rationale: the rest of the repo is TS/Svelte; Phase 3 analytics lives in Postgres SQL (cohorts/retention/LTV via window functions + `generate_series`), Phase 4 visualization is SvelteKit. There is no pandas-shaped work in the hot path. One-stack wins for forkability — forkers don't need a Python toolchain.
- **D-02:** The loader uses `@supabase/supabase-js` with the **service_role key** (loaded from local env, never checked in). Service_role bypasses RLS — required for upserting across tenants in a multi-tenant-ready schema even though v1 has one tenant.

### Two-Grain Schema
- **D-03:** `stg_orderbird_order_items` is a **1:1 mirror of the CSV's 29 columns** plus three loader-added columns:
  - `restaurant_id uuid NOT NULL` (tenant stamp — read from env at load time)
  - `ingested_at timestamptz NOT NULL DEFAULT now()`
  - `source_file text NOT NULL` (the CSV filename / Storage object path, for audit)
  PK: composite on `(restaurant_id, invoice_number, item_name, quantity, item_gross_amount_eur)` — natural-key dedupe within an invoice. (Alternative: synthetic `row_number()` per invoice — gsd-planner to decide based on uniqueness analysis during planning.)
- **D-04:** `transactions` (Phase 1 skeleton, migration 0003) is **populated by the loader with one row per unique `invoice_number`** (invoice-grain). Columns populated by Phase 2:
  - `restaurant_id uuid` — tenant
  - `source_tx_id text` — **= `invoice_number`** (locked per discussion; invoice is the unique payment identifier across the dataset and the natural join key against GDPdU / PDFs)
  - `occurred_at timestamptz` — derived from CSV `date + time` strings, parsed as local time in `restaurants.timezone`, stored as UTC
  - `card_hash text` — hashed in loader (see D-07)
  - Additional columns needed for revenue/cohort metrics (Phase 2 migration extends the skeleton): `invoice_total_eur numeric`, `tip_eur numeric`, `payment_method text`, `sales_type text`. **gsd-planner to finalize exact column list against Phase 3 MV needs.**
- **D-05:** **Invoice-level dedup happens at load time, not query time.** For each group of CSV rows sharing an `invoice_number`, the loader takes `invoice_total_eur`, `tip_eur`, `payment_method`, `sales_type`, `occurred_at`, `card_hash` from the first row of the group (all identical across rows by Orderbird's schema — founder verified on 5+ samples including invoice 1-7 and 1-211). This guarantees Phase 3 MVs can `SUM(tip_eur)` from `transactions` without multiply-by-item-count bugs.

### CSV Quality & Parsing
- **D-06:** Loader is **strict** — any misaligned row fails the entire ingest with a loud error pointing at the CSV row. No tolerant mode, no `ingest_errors` table. If the CSV breaks, the founder fixes the pre-joiner (out-of-band Claude cowork) and re-runs. This avoids silently carrying bad data into analytics.

### Card Hashing (PII Guard)
- **D-07:** `card_hash = sha256(wl_card_number || restaurant_id::text)`, computed in the loader **before any database write**. Raw PAN / `wl_card_number` is never sent to Supabase — only the hash. `wl_card_number` is the Worldline-masked PAN (`482510xxxxxxxxx7567`), stable per physical card across visits.
- **D-08:** Cash rows (`wl_card_number IS NULL`) get `card_hash = NULL`. Cash customers are **anonymous and intentionally excluded from cohort / LTV / retention analytics** — you cannot track an anonymous cash payer across visits. This is correct behavior, not a gap. `kpi_daily_v` still counts cash revenue; only identity-dependent metrics (cohort, LTV, repeat rate) drop cash transactions.
- **D-09:** `card_last4`, `wl_card_number`, `wl_card_type`, `wl_payment_type`, `wl_issuing_country`, and `card_txn_id` are stored **only in staging** (`stg_orderbird_order_items`) — never in `transactions`. The CI guard 4 `pii-columns.txt` manifest is extended to list these six columns. Any migration that references both `card_hash` and any listed PII column in the same statement fails the build (D-14 guard 4 from Phase 1).

### Void / Refund / Correction Semantics
- **D-10:** **Cancellations are already filtered by the pre-joiner** — 262 cancelled orders in GDPdU, 0 leaked into `ramen_bones_order_items.csv`. Loader trusts this and does not re-filter cancellations.
- **D-11:** **Correction pairs** (positive + negative line items within the same invoice, e.g., waiter voided and re-rang items on invoice 1-211 on 2025-06-19 — known 3-row case: Kimchi +5/−5, Ramen +15/−15 twice) stay in `stg_orderbird_order_items` for audit but are **filtered from `transactions`** via `WHERE invoice_total_eur >= 0` at the dedup step. Net revenue effect is €0 within the invoice, so this is mathematically safe.
- **D-12:** **Tip semantics:** `tip_eur` is invoice-level, repeated on every item row of the same invoice. The loader takes the tip from the first row of each invoice group (see D-05). Phase 3 **must never `SUM(tip_eur)` over raw `stg_orderbird_order_items` rows** — always query `transactions` for tip totals. This rule also applies to `invoice_total_eur`. Founder verified across 5 samples.

### CSV Source & Delivery
- **D-13:** CSV lives in a **private Supabase Storage bucket** (name TBD by gsd-planner, suggest `orderbird-raw`). Service_role has read access; `authenticated` and `anon` have no access.
- **D-14:** The `orderbird_data/` directory is added to `.gitignore` (it currently appears as untracked in `git status`) — no CSV, XLSX, XML, or PDF export is ever committed to the repo. Security + forkability: forkers see the code, not the data. The loader reads the Storage bucket object, not a local path.
- **D-15:** Migration adds the Storage bucket + its policy (service_role-only read) so forkers get it on `supabase db push`.

### Ingest Trigger
- **D-16:** v1 ingest is **manual**: `npm run ingest` from the founder's laptop. Workflow:
  1. Run the pre-joiner locally (out-of-band Claude cowork) to produce an updated CSV.
  2. Upload the CSV to the Supabase Storage bucket via Dashboard or CLI.
  3. Run `npm run ingest` — loader downloads the latest object, parses, hashes, upserts both tables.
- **D-17:** The loader is **fully idempotent**: re-running against the same CSV produces zero diffs. Upsert natural key on `transactions` = `(restaurant_id, source_tx_id)` where `source_tx_id = invoice_number`. Staging uses `(restaurant_id, invoice_number, item_name, quantity, item_gross_amount_eur)` or a synthetic row index (gsd-planner to lock based on uniqueness analysis).
- **D-18:** Loader output: prints a summary (`X rows read, Y invoices deduped, Z new transactions, W updated, 0 errors`) and exits 0. Non-zero exit on any error.

### Environment & Secrets
- **D-19:** Loader reads credentials from environment variables (or a `.env` file gitignored):
  - `SUPABASE_URL` — the target project (DEV for v1)
  - `SUPABASE_SERVICE_ROLE_KEY` — service_role
  - `ORDERBIRD_CSV_BUCKET` — Storage bucket name
  - `ORDERBIRD_CSV_OBJECT` — latest CSV object path (or loader auto-picks latest by modified time)
  - `RESTAURANT_ID` — UUID of the one v1 tenant (from `0005_seed_tenant.sql`)
- **D-20:** Loader refuses to run if any env var is missing (fail fast, loud error).

### Testing
- **D-21:** Vitest integration test that runs the loader against a fixture CSV (~20 rows covering: normal invoice, split-bill same-order, cash transaction, card transaction, correction pair, tip > 0, tip = 0, INHOUSE + TAKEAWAY sales types). Asserts:
  - Staging row count matches input row count
  - `transactions` row count = unique invoice count (minus negatives)
  - `SUM(tip_eur)` from `transactions` matches hand-calculated fixture total (tips are NOT multiplied by item count)
  - Card hashes are consistent and match `sha256(wl_card_number || restaurant_id)`
  - Cash rows have NULL `card_hash`
  - Re-running the loader produces zero diffs (idempotency)
- **D-22:** The fixture CSV lives in `tests/fixtures/orderbird_sample.csv` (small, sanitized, safe to commit because it's synthetic test data — not real customer rows).

### Claude's Discretion
- Exact column list added to `transactions` beyond the locked minimum (D-04) — gsd-planner chooses against Phase 3 MV needs.
- Whether to use CSV streaming (`csv-parse/sync` vs `csv-parser` stream) — decide based on file size (20K rows is small enough for sync).
- Whether to use `supabase-js` `upsert()` in batches (500-row chunks is a reasonable default) or build a SQL RPC.
- Directory structure for the loader code (e.g., `scripts/ingest/` vs `src/ingest/`).
- Whether to add a `--dry-run` flag (recommended for founder confidence).
- Exact staging table PK shape (natural composite vs synthetic `(invoice_number, item_order_in_invoice)`).
- Exact error messages and log format.

### Folded Todos
None — no pending todos matched this phase.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 1 Prior Art (schema + CI guards)
- `.planning/phases/01-foundation/01-CONTEXT.md` — all D-01..D-16 from Phase 1. Critical: D-04 (JWT restaurant_id claim), D-07 (REVOKE on MVs), D-09 (tenant-timezone business_date), D-14 guard 4 (card_hash / PII join ban), D-16 (separate TEST project).
- `supabase/migrations/0001_tenancy_schema.sql` — `restaurants`, `memberships`, RLS.
- `supabase/migrations/0003_transactions_skeleton.sql` — the skeleton `transactions` table Phase 2 extends (PK `(restaurant_id, source_tx_id)`, `occurred_at timestamptz`, `card_hash text`, RLS policy `tx_tenant_read`).
- `supabase/migrations/0005_seed_tenant.sql` — the v1 tenant row (Europe/Berlin).
- `pii-columns.txt` — Phase 2 extends this with Worldline/card detail column names.
- `scripts/ci-guards.sh` — Phase 2 migrations must pass all 5 guards unchanged.

### Project Docs
- `CLAUDE.md` — tech stack constraints, forbidden packages (`@supabase/auth-helpers-sveltekit`), data freshness policy (daily refresh), security constraints (card-hash only, never PAN), multi-tenant readiness rule.
- `.planning/REQUIREMENTS.md` — ING-01..05 (the five requirements this phase must satisfy).
- `.planning/ROADMAP.md` — Phase 2 success criteria (5 criteria, all flow from ING-01..05).

### Data Shape (pre-joiner output — reference, not committed to repo)
- `orderbird_data/5-JOINED_DATA_20250611_20260411/ramen_bones_order_items.csv` — 20,948 rows × 29 columns, 2025-06-11 → 2026-04-11. **This file is referenced for planning only — not read by the loader (loader reads from Supabase Storage). It will be gitignored per D-14 before Phase 2 ships.**
- Pre-joiner findings (from founder's Claude cowork session, captured here as the canonical source of truth since there's no separate doc): 262 cancellations filtered upstream; 3 negative-amount rows are correction pairs in invoice 1-211 on 2025-06-19 (net €0); `tip_eur` is invoice-level repeated per row; `invoice_total_eur` is invoice-level repeated per row; `sales_type` has stray numeric values in some rows (CSV parsing fragility → loader is strict).

### External Library Docs
- `@supabase/supabase-js` — service_role client, `storage.from().download()`, `from().upsert()`.
- `csv-parse` (or equivalent) — strict CSV parser with column-count validation.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `tests/helpers/supabase.ts` — `adminClient()` factory uses `TEST_SUPABASE_*` env. Phase 2 loader needs a similar factory pattern for `SUPABASE_*` (DEV) env.
- `tests/setup.ts` — DEV-safety assert pattern (refuses to run tests against DEV). Phase 2 loader needs the inverse: it MUST run against DEV (that's the whole point), so the assert direction flips but the env-load pattern copies.
- `scripts/ci-guards.sh` — existing guard 4 scans migrations and src for forbidden `card_hash` + PII joins. Phase 2 extends the `pii-columns.txt` manifest but does not modify the guard script.
- Migration numbering convention (`0001_`, `0002_`, ...) — Phase 2 continues at `0007_` and onward.

### Established Patterns
- **Migration per discrete change** — one SQL file per concern (tenancy / auth hook / transactions / MV template / seed / test helpers). Phase 2 likely: `0007_transactions_columns.sql`, `0008_stg_orderbird_order_items.sql`, `0009_storage_bucket.sql`.
- **`security definer` functions revoked from public + granted only to `service_role`** — Phase 2 may need one for the dedup/upsert path if done in SQL, or may skip entirely and do all dedup in TS.
- **Idempotent SQL via `where not exists` / `on conflict do update`** — Phase 2 loader uses `upsert()` with `onConflict` for idempotency.
- **Vitest integration tests write real rows to TEST project and assert via RPC helpers** — Phase 2 test follows this pattern.

### Integration Points
- `transactions` (migration 0003) — Phase 2 extends with additional columns via a new migration (0007 or similar). Existing RLS policy `tx_tenant_read` continues to work — no policy change needed.
- `pii-columns.txt` — Phase 2 writes six new lines (Worldline + card_last4 + card_txn_id column names).
- `scripts/ci-guards.sh` — no changes needed; the guard reads the manifest dynamically.
- `.github/workflows/tests.yml` — the Phase 2 migrations land in `supabase/migrations/` and get applied to the TEST project automatically before vitest runs.
- **New**: `scripts/ingest.ts` (or `src/ingest/index.ts`) — the loader entry point. Wired into `package.json` as `npm run ingest`.

</code_context>

<specifics>
## Specific Ideas

- Loader output is a CLI summary (rows read / invoices deduped / rows inserted / rows updated / errors) — founder wants to watch the first few runs succeed and will trust automation after that.
- The founder's pre-joiner "cowork" is the authoritative source for CSV semantics. If the loader finds a row shape that contradicts D-10..D-12, the loader fails loudly and the founder fixes the pre-joiner — not the loader.
- Dry-run flag (`npm run ingest -- --dry-run`) is recommended for founder confidence but left to Claude's discretion.

</specifics>

<deferred>
## Deferred Ideas

- **Scheduled ingest (cron / pg_cron)** — deferred to Phase 5 forkability. v1 is manual.
- **Event-triggered ingest (Supabase Storage webhook → Edge Function)** — deferred to Phase 5.
- **Playwright scraper for `my.orderbird.com`** — deferred indefinitely. Pre-joiner replaces it.
- **`transaction_items` normalized table** — deferred. Staging serves item-grain queries directly. If Phase 3/4 hits a perf wall, revisit.
- **Tolerant CSV parser with `ingest_errors` quarantine table** — deferred. Strict parser + upstream fix is the v1 posture.
- **Multi-file ingest / historical backfill** — v1 processes one CSV object per run. If the founder needs to load multiple historical CSVs, they run the loader multiple times with different `ORDERBIRD_CSV_OBJECT` values.
- **DATEV XML / Worldline export ingestion** — v1 reads only `ramen_bones_order_items.csv` (the pre-joiner's output). The DATEV and Worldline raw exports feed into the pre-joiner, not into Supabase directly.
- **Ingest UI / drag-drop upload page in the dashboard** — deferred.

</deferred>

---

*Phase: 02-ingestion*
*Context gathered: 2026-04-14*
