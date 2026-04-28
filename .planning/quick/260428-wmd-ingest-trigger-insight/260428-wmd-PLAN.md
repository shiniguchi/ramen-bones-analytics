---
quick_id: 260428-wmd
slug: ingest-trigger-insight
date: 2026-04-28
description: Drop daily pg_cron jobs (MV refresh + generate-insight); trigger both on-demand from the ingest script when a new complete Mon-Sun week is available
status: pending
---

# Quick Task 260428-wmd — Ingest-driven insight refresh

## Why

The two daily pg_cron jobs (`refresh-analytics-mvs` at 03:00 UTC, `generate-insights` at 03:15 UTC) fire whether or not new data has arrived. Data only arrives when the user uploads a new joined CSV. The natural trigger is the ingest script itself.

Per user direction:
- Drop both daily crons.
- After a successful ingest, refresh MVs and call the Edge Function **only** when a new complete Mon-Sun week is now available compared to the latest insight's `business_date`. Otherwise, skip the LLM call (avoid LLM cost + duplicate writes).

## Tasks

### 1. New migration `supabase/migrations/0039_drop_analytics_crons.sql`

Unschedule both cron jobs idempotently (DO blocks tolerant of missing rows). Leave `public.refresh_analytics_mvs()` function and the `generate-insight` Edge Function in place — they're still callable on-demand.

**Verify:** `grep cron.unschedule supabase/migrations/0039*.sql` shows two unschedule calls.

### 2. New module `scripts/ingest/refresh.ts`

Exports `refreshAndMaybeTriggerInsight(client, supabaseUrl, serviceRoleKey, restaurantId)` which:

1. Calls RPC `public.refresh_analytics_mvs()` (refreshes both `cohort_mv` and `kpi_daily_mv`).
2. Reads `MAX(occurred_at)` from `transactions` for the tenant; converts to Berlin-local date via `date-fns-tz` `toZonedTime`.
3. Floors that date to the most recent Sunday on-or-before (DOW=0 → 0 days back; else N days back).
4. Reads `MAX(business_date)` from `insights` for the tenant.
5. If no insight yet OR the floor-to-Sunday > latest insight's business_date, POSTs `{}` to `${SUPABASE_URL}/functions/v1/generate-insight` with the service-role bearer (same auth pattern the cron used).
6. Returns a `RefreshResult` reporting `mv_refreshed`, `latest_data_date`, `latest_complete_week_ending`, `latest_insight_business_date`, `insight_triggered`, and `insight_skip_reason` for visibility.

**Verify:** `npx vitest run tests/ingest/normalize.test.ts` still passes (sanity check on date-fns-tz import side-effects); manual ingest run shows the JSON line `{"post_ingest":{...}}` with sensible values.

### 3. Wire into `scripts/ingest/index.ts`

After `printReport(report)` (real-run only — skip on dry-run), call `refreshAndMaybeTriggerInsight(...)` and `console.log(JSON.stringify({ post_ingest: result }))` so the existing JSON-per-line report contract is preserved (existing report shape unchanged for backward compat).

**Verify:** `npm run ingest` against DEV produces both the existing report line AND a new `post_ingest` line; dry-run only produces the report line.

### 4. Apply migration to DEV

`npx supabase db push` (or equivalent — confirm what the project uses). After apply, verify in DB: no rows in `cron.job` for either jobname.

**Verify:** `SELECT jobname FROM cron.job WHERE jobname IN ('refresh-analytics-mvs','generate-insights')` returns 0 rows.

### 5. Re-run ingest end-to-end

`npm run ingest` against DEV. Expected: 0 new transactions (already ingested earlier in this session), MV refresh succeeds, `latest_complete_week_ending = 2026-04-26`, `latest_insight_business_date = 2026-04-26` → `insight_triggered: false, reason: "no new complete week"`. This is the "no-op when no new week" test.

**Verify:** post_ingest JSON shows `insight_triggered: false`.

## must_haves

- `supabase/migrations/0039_drop_analytics_crons.sql` exists and unschedules both jobs.
- `scripts/ingest/refresh.ts` module exists and is invoked from `index.ts` post-report.
- Existing ingest tests still pass.
- DEV cron.job table no longer contains `refresh-analytics-mvs` or `generate-insights`.
- A second ingest run produces `insight_triggered: false` (idempotency on a stale week).

## Out of scope

- Changing the Edge Function logic (already idempotent).
- Removing migration `0017_insights_cron.sql` itself (kept for history; `0039` supersedes via `cron.unschedule`).
- Replacing the service-role bearer with a separate cron-free credential (reuses same `SUPABASE_SERVICE_ROLE_KEY` already present in `.env`).

## Pitfalls flagged

- **Timezone correctness**: `occurred_at` is UTC, business weeks are Berlin-local — must convert before flooring to Sunday. Mirror the existing `toBerlinUtc` convention in `normalize.ts` (just inverted).
- **Migration idempotency**: wrap unschedule calls in DO blocks tolerant of missing rows so the migration is safe to re-apply.
- **Dry-run preservation**: `--dry-run` must NOT mutate state (no MV refresh, no insight call). Hook gated on `!opts.dryRun`.
