# Phase 07 Deferred Items

## Pre-existing test failures (not caused by Phase 07 changes)

Observed during 07-02 full-suite run on 2026-04-16. Confirmed pre-existing by stashing 07-02 changes and re-running.

- `tests/integration/rls-policies.test.ts` — "tenant A sees exactly one restaurant row (its own)" returns 0. TEST project seed drift — the tenant A fixture restaurant may have been deleted or renamed.
- `tests/integration/jwt-claim.test.ts` — Gap B custom_access_token_hook claim assertion failing on TEST.
- `tests/integration/mv-wrapper-template.test.ts` — `kpi_daily_mv has a unique index` assertion — may be related to recent Phase 06 migrations on TEST that ran via 07-02's catch-up push.
- `tests/e2e/*.spec.ts` — Playwright e2e tests picked up by vitest glob but need a running dev server; out of scope for `npm run test -- --run`.
- `supabase/functions/generate-insight/*.test.ts` — Deno edge function tests, fail under vitest's Node runtime.

These are all outside Phase 07 scope. The Phase 07-specific tests (`tests/ingest/schema.test.ts`, `tests/ingest/backfill.test.ts`) are 9/9 green.
