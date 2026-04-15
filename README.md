# Ramen Bones Analytics

A free, forkable, mobile-first analytics web app that turns Orderbird POS transactions
into banking-grade growth metrics (cohorts, retention, LTV) for non-technical restaurant
owners.

**V1 tenant:** one ramen shop (the founder's friend). Architecture is multi-tenant-ready
from day 1 so any restaurant owner can fork or self-host.

## Stack

- **Frontend:** SvelteKit 2 + Svelte 5 runes, Cloudflare Pages (`adapter-cloudflare`)
- **Backend:** Supabase Postgres + Edge Functions + `pg_cron`
- **Auth:** `@supabase/ssr` (cookie-based SSR). Never `@supabase/auth-helpers-sveltekit`.
- **Extraction:** Python 3.12 + Playwright, hosted on GitHub Actions cron
- **Insights:** Claude API via Supabase Edge Function, triggered by `pg_cron` → `pg_net`

See `CLAUDE.md` for the full tech-stack rationale and "What NOT to Use" list.

## Forker quickstart — Phase 1: Supabase + migrations

1. Fork and clone this repo.
2. Create two Supabase projects: `rba-dev` and `rba-test`.
3. Copy `.env.test.example` → `.env.test` and fill in the TEST project's URL, anon key,
   and service-role key.
4. `npm install`
5. Apply migrations to DEV:
   `supabase login && supabase link --project-ref <dev-ref> && supabase db push`
6. Apply migrations to TEST: repeat `supabase link` + `supabase db push` against the
   TEST project ref.
7. In **both** Supabase projects: Authentication → Hooks → Custom Access Token Hook →
   select `public.custom_access_token_hook`. See
   [`docs/reference/auth-hook-registration.md`](docs/reference/auth-hook-registration.md)
   for the exact dashboard steps. Without this step, RLS will deny every query silently.
8. `npx vitest run` — all Phase 1 integration tests should go green against the TEST
   project.
9. `bash scripts/ci-guards.sh` — all four CI guards should exit 0.
10. Create your first user via the Supabase Dashboard → Authentication → Users, and
    insert a row into `public.memberships` linking that user to the seeded restaurant
    (see `supabase/migrations/0005_seed_tenant.sql`).
11. Push to a branch on GitHub; the `CI Guards`, `Tests`, and `DB Migrations (DEV)`
    workflows run automatically.

## Forker quickstart — Phase 2: Load data

The v1 ingest is CSV-driven. No Orderbird scraper yet.

1. Produce a pre-joined CSV using Claude co-working (see `orderbird_data/README.md`) OR drop an existing one at:
   ```
   orderbird_data/5-JOINED_DATA_YYYY-MM-DD/ramen_bones_order_items.csv
   ```
2. Provision your tenant row (v1 has no signup UI per D-19):
   ```sql
   INSERT INTO public.restaurants (id, name, timezone)
   VALUES (gen_random_uuid(), 'Your Restaurant', 'Europe/Berlin')
   RETURNING id;
   ```
   Copy the returned UUID — you'll need it for memberships and `RESTAURANT_ID` in `.env`.
3. Stage the CSV into Supabase Storage and run the loader:
   ```bash
   npx tsx scripts/ingest/upload-csv.ts <path-to-csv> orderbird-raw dev/ramen_bones_order_items.csv
   npm run ingest
   ```
4. Verify: `psql "$SUPABASE_DB_URL" -c "SELECT COUNT(*) FROM public.transactions;"` returns > 0.

## Forker quickstart — Phase 3: Analytics SQL

1. Apply migrations 0010–0013 (cohort_mv, kpi_daily_mv, leaf views, refresh cron):
   ```bash
   supabase db push
   ```
2. Enable the `pg_cron` extension via Supabase Dashboard → Database → Extensions → pg_cron → Enable.
3. Verify the nightly refresh job is scheduled:
   ```sql
   SELECT jobname, schedule FROM cron.job WHERE jobname = 'refresh-analytics-mvs';
   -- expect: 0 3 * * *
   ```
4. Force a first refresh: `SELECT refresh_analytics_mvs();`

## Forker quickstart — Phase 4: Mobile dashboard

1. Fork this repo, clone locally.
2. Connect the forked repo to Cloudflare Pages:
   - Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git
   - Build command: `npm run build`
   - Build output: `.svelte-kit/cloudflare`
3. In the CF Pages project, Settings → Environment variables, set every var in `.env.example` under `# --- destination: cf pages project env ---`.
4. Push to `main` — CF Pages builds and deploys.
5. Create your user via Supabase Dashboard → Authentication → Users.
6. Link user to tenant via memberships row (adjust IDs):
   ```sql
   INSERT INTO public.memberships (user_id, restaurant_id, role)
   VALUES ('<auth-user-id>', '<restaurant-id>', 'owner');
   ```
7. Visit your CF Pages URL, sign in, see the dashboard.

## Forker quickstart — Phase 5: Nightly insights

1. Get an Anthropic API key: https://console.anthropic.com/settings/keys
2. Set the Supabase secrets:
   ```bash
   supabase secrets set ANTHROPIC_API_KEY="sk-ant-..."
   supabase secrets set SUPABASE_SERVICE_ROLE_KEY="<your-service-role-jwt>"
   ```
3. Deploy the Edge Function:
   ```bash
   supabase functions deploy generate-insight --no-verify-jwt
   ```
4. Note the function URL printed by `deploy` — looks like `https://<ref>.supabase.co/functions/v1/generate-insight`.
5. Store URL + bearer in Supabase Vault (Dashboard → Database → Vault):
   - Secret `generate_insight_url` = full function URL
   - Secret `generate_insight_bearer` = your service_role JWT (same as `SUPABASE_SERVICE_ROLE_KEY`)
6. Apply migrations 0016 + 0017:
   ```bash
   supabase db push
   ```
7. Verify the insights cron is scheduled:
   ```sql
   SELECT jobname, schedule FROM cron.job WHERE jobname = 'generate-insights';
   -- expect: 15 3 * * *
   ```
8. Smoke-test the function manually (optional — the cron will fire at 03:15 UTC):
   ```bash
   curl -X POST "<function-url>" \
     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
     -H "Content-Type: application/json" -d '{}'
   ```
9. Verify: `SELECT business_date, substring(headline, 1, 40), fallback_used FROM public.insights ORDER BY generated_at DESC LIMIT 1;` returns a row.
10. Reload your dashboard — the insight card renders at the top.

## Forker quickstart — Ship

1. LICENSE: this repo ships MIT by default (see `LICENSE`). Keep it or replace with your org's license.
2. Flip your fork to public on GitHub if it isn't already.
3. Add topics: `analytics`, `restaurant-analytics`, `sveltekit`, `supabase`, `cloudflare-pages`, `forkable`, `pos-integration`.
4. Add a one-line description: "Free, forkable, mobile-first analytics for restaurant owners. Turns Orderbird POS transactions into banking-grade cohort/retention/LTV metrics."
5. Run the dry-run smoke check:
   ```bash
   ./scripts/fork-dryrun.sh
   ```
   Exit 0 means every required file, migration, and env-var documentation is in place.

## Phase 4 handoff (SvelteKit wiring)

Phase 1 validates session persistence at the `supabase-js` `setSession` layer only.
Phase 4 copies the reference files in `docs/reference/` into `src/` and re-validates
FND-06 end-to-end through an actual browser refresh via `@supabase/ssr` cookie
hydration:

- `docs/reference/hooks.server.ts.example` → `src/hooks.server.ts`
- `docs/reference/+layout.server.ts.example` → `src/routes/+layout.server.ts`
- `docs/reference/login/` → `src/routes/login/`

## What Phase 1 does NOT include

- Dashboard UI (Phase 4)
- Orderbird scraper (Phase 2)
- Analytics SQL — cohorts, retention, LTV (Phase 3)
- Claude nightly insights (Phase 5)

Phase 1 is pure infrastructure: tenancy schema, auth hook, RLS, materialized-view
wrapper template, CI guards, and the integration test harness.

## Ingestion

Phase 2 ships a CSV loader that reads an Orderbird export from Supabase Storage and upserts it into `public.stg_orderbird_order_items` (raw line items) + `public.transactions` (deduped, card-hash-scoped customer rows).

### Prerequisites

Env vars (see `.env.example`):

- `SUPABASE_URL` — DEV or PROD Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — service-role key (server-only, never commit)
- `RESTAURANT_ID` — tenant UUID from `supabase/migrations/0005_seed_tenant.sql`
- `ORDERBIRD_CSV_BUCKET` — typically `orderbird-raw`
- `ORDERBIRD_CSV_OBJECT` — object path inside the bucket, e.g. `dev/ramen_bones_order_items.csv`

PII note: the CSV contains card PANs and must never hit the repo. See `docs/reference/pii-columns.txt` for the hashed-only columns the loader persists.

### How to run

```bash
# Stage CSV into Supabase Storage (one-off)
npx tsx scripts/ingest/upload-csv.ts ./orderbird_data/.../ramen_bones_order_items.csv orderbird-raw dev/ramen_bones_order_items.csv

# Dry-run: prints the report without touching DB
npm run ingest -- --dry-run

# Write mode: upserts staging + transactions
npm run ingest
```

### Report fields

The loader emits a single JSON line on stdout:

| Field                    | Meaning                                                                     |
| ------------------------ | --------------------------------------------------------------------------- |
| `rows_read`              | Raw CSV lines parsed (one per Orderbird line item)                          |
| `invoices_deduped`       | Unique positive-total invoices destined for `transactions`                  |
| `staging_upserted`       | Rows written to `stg_orderbird_order_items` (= `rows_read` in write mode)   |
| `transactions_new`       | Net-new invoice rows inserted this run                                      |
| `transactions_updated`   | Existing invoices touched by the upsert path                                |
| `cash_rows_excluded`     | Cash line items excluded from card-hash customer tracking                   |
| `missing_worldline_rows` | Card rows where the Orderbird worldline join failed — **monitor this**     |
| `errors`                 | Parse/upsert errors (should always be `0`)                                  |

If `missing_worldline_rows` grows meaningfully run-over-run, Worldline is silently dropping card references. Founder should investigate the POS export before we trust customer cohorts.

### Idempotency guarantee

Re-running `npm run ingest` on the same CSV is a no-op at the row-count level: `transactions_new=0`, physical row counts unchanged. The natural key `(restaurant_id, source_tx_id)` plus a 2-day overlap window drives the upsert. See `.planning/phases/02-ingestion/02-04-REAL-RUN.md` for a verified real-data run.

### Semantic reference

`tests/ingest/fixtures/README.md` documents the 11 semantic scenarios the loader handles (split bills, negative invoices, missing worldline joins, etc.) and is the source of truth for the founder-facing interpretation.

## Project docs

- `.planning/PROJECT.md` — vision and non-negotiables
- `.planning/REQUIREMENTS.md` — FND-01..FND-08 acceptance criteria
- `.planning/ROADMAP.md` — five-phase roadmap
- `CLAUDE.md` — tech-stack rationale and forbidden patterns
