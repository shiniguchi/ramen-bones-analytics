---
quick_id: 260428-wmd
slug: ingest-trigger-insight
date: 2026-04-28
status: complete
commits:
  - d3d0f9d
  - af3f051
---

# Quick Task 260428-wmd — Summary

## What changed

- **`supabase/migrations/0040_drop_analytics_crons.sql`** (new) — idempotently unschedules `refresh-analytics-mvs` (was migration 0013, daily 03:00 UTC) and `generate-insights` (was migration 0017, daily 03:15 UTC). The underlying SECURITY DEFINER function and the `generate-insight` Edge Function stay intact and on-demand callable.
- **`scripts/ingest/refresh.ts`** (new) — exports `refreshAndMaybeTriggerInsight(client, supabaseUrl, serviceRoleKey, restaurantId)`:
  1. Calls RPC `public.refresh_analytics_mvs()` to refresh `cohort_mv` + `kpi_daily_mv`.
  2. Reads `MAX(occurred_at)` from `transactions` for the tenant; converts UTC → Berlin local via `date-fns-tz` `toZonedTime`.
  3. Floors that date to the most recent Sunday on-or-before (DOW=0 → 0 days back, else N days back).
  4. Reads `MAX(business_date)` from `insights` for the tenant.
  5. POSTs `{}` to `${SUPABASE_URL}/functions/v1/generate-insight` (service-role bearer) **only** when the floor-to-Sunday is strictly newer than the latest insight's `business_date`.
  6. Returns a `RefreshResult` with `mv_refreshed`, `latest_data_date`, `latest_complete_week_ending`, `latest_insight_business_date`, `insight_triggered`, and `insight_skip_reason`.
- **`scripts/ingest/index.ts`** — after `printReport(report)` (real-run only; gated `!opts.dryRun` via the existing branching), wraps the new hook in try/catch so a refresh/insight failure does **not** unwind the load-bearing upsert. Existing `IngestReport` shape unchanged for backward compat; new info goes on a separate `{post_ingest:{...}}` JSON line.

## Why

The two daily pg_cron jobs fired regardless of whether new data had arrived. Data only arrives via CSV upload. Ingest-driven refresh aligns the trigger with the actual data event and skips the LLM call when no new full Mon-Sun week is available compared to the latest insight.

## Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors in new files |
| `npx vitest run tests/ingest/{normalize,idempotency,loader,backfill,hash}.test.ts` | **34/34 pass** |
| `npm run ingest` against DEV (re-run) | `transactions_new: 0`, `mv_refreshed: true`, `latest_complete_week_ending: 2026-04-26`, `latest_insight_business_date: 2026-04-26`, `insight_triggered: false`, reason `"no new complete week"` ✓ |
| `npm run ingest -- --dry-run` | Only the existing report line — no `post_ingest` line ✓ |

## How the new trigger behaves

- **Same week**: ingest re-runs (e.g. user re-uploads same CSV) → `insight_triggered: false`, reason `"no new complete week"`. No LLM cost.
- **New full week available** (e.g. user uploads CSV containing data through next Sunday): `insight_triggered: true`, Edge Function fires, new insight row written for the new `business_date`.
- **Mid-week ingest**: data through Wednesday → `latest_complete_week_ending` = the previous Sunday. If that Sunday is already covered by an insight, no trigger.
- **Failure isolation**: hook is wrapped in try/catch; `post_ingest_error` line is logged but the upsert success is preserved.

## Migration deployment path

Migration `0039` will land on DEV automatically when the branch merges to `main` via `.github/workflows/migrations.yml`. After it applies, `cron.job` will no longer contain rows for `refresh-analytics-mvs` or `generate-insights`. The DEV verification above used the live ingest path **without** applying the migration — the cron jobs remained scheduled but didn't fire mid-day, so the test of the on-demand path was clean.

## Out of scope

- Changing the Edge Function's internal logic.
- Removing migration `0017_insights_cron.sql` (kept for history; `0039` supersedes it via `cron.unschedule`).
- Forwarding `post_ingest` JSON to a metrics sink (just stdout for now).

## Commit

- `d3d0f9d` — feat(ingest): drive MV refresh + insight regen from ingest, drop daily cron
- `af3f051` — chore(db): renumber drop-analytics-crons migration 0039 → 0040 (Phase 12 reserves 0039)
