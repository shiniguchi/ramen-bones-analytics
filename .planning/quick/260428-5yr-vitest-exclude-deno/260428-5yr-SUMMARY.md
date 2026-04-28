---
quick_id: 260428-5yr
slug: vitest-exclude-deno
date: 2026-04-28
status: complete
commits:
  - a388d43
---

# Quick Task 260428-5yr — Summary

## What changed

- **`vitest.config.ts`** — added `test.exclude: ['node_modules/**', 'dist/**', '.svelte-kit/**', 'supabase/**']`. The array fully replaces vitest's built-in exclude list, so the safe defaults are restated alongside the new `supabase/**` entry.

## Why

The 3 Deno-only Edge Function tests at `supabase/functions/generate-insight/{digit-guard,fallback,payload}.test.ts` import `std/assert` from a Deno import map (`supabase/functions/generate-insight/deno.json`). Node-vitest's default glob caught them and crashed at module load with `Cannot find package 'std/assert'`. They're meant to run via `deno test --allow-env --allow-net`.

## Verification

- `npx vitest run --reporter=dot` — 0 hits for `std/assert` and 0 references to `supabase/functions/generate-insight` in the output (down from 3 file-level failures pre-fix).
- Test summary post-fix: 306 files passed, 123 failed, 2 skipped (3189/3237 tests passing). The 123 file failures are unrelated:
  - Integration tests against missing/malformed `TEST_SUPABASE_URL` — Issue B in the parent investigation; user-action fix.
  - 16 unit test failures appear i18n-related (component tests expecting English copy that's now Japanese by default per the v1.3 rollout) — separate concern.

## Out of scope but observed during verification

While running the full suite, I noticed that integration tests exercising `runIngest` end-to-end now log:
```
{"post_ingest_error":"generate-insight call failed: 404 ..."}
```
This is from quick task 260428-wmd's post-ingest hook trying to hit the `generate-insight` Edge Function in the TEST Supabase project (which doesn't have it deployed). The try/catch I added in that quick task swallows the error so tests still pass — but the stderr noise pollutes CI logs. **Not a regression of this task** (the noise existed locally before this fix too; CI hadn't been able to reach it because Issue B blocked test execution).

Cleanest follow-up fix: gate `refreshAndMaybeTriggerInsight` on `process.env.VITEST !== 'true'` so the hook is a no-op under vitest. ~2 lines in `scripts/ingest/refresh.ts`. Worth its own quick task if user wants it.

## Commit

- `a388d43` — fix(ci): exclude supabase/** from vitest discovery
