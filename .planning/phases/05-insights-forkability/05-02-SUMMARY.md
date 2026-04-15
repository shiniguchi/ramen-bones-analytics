---
phase: 05-insights-forkability
plan: 02
subsystem: test-scaffold
tags: [wave-0, red-tests, nyquist]
requires: []
provides:
  - "Deno test harness for generate-insight Edge Function"
  - "Vitest RED test for InsightCard component"
  - "Shell RED stub for forker dry-run"
affects:
  - "05-03 (edge-fn impl) will flip deno tests GREEN"
  - "05-04 (InsightCard impl) will flip vitest GREEN"
  - "05-05 (forker walkthrough) will flip fork-dryrun.sh GREEN"
tech_added: []
patterns:
  - "RED-first Wave 0 scaffolding (mirrors Phase 3 03-01)"
  - "Deno.test + std/assert for Edge Function unit tests"
key_files:
  created:
    - supabase/functions/generate-insight/deno.json
    - supabase/functions/generate-insight/digit-guard.test.ts
    - supabase/functions/generate-insight/payload.test.ts
    - supabase/functions/generate-insight/fallback.test.ts
    - src/lib/components/InsightCard.test.ts
    - scripts/fork-dryrun.sh
  modified: []
decisions:
  - "InsightCard.test.ts lives at src/lib/components/ (per plan frontmatter), not tests/unit/ — colocated with component it targets"
  - "payload.test.ts uses Deno.test.ignore for the integration shape test — defers live-DB assertion to 05-03"
metrics:
  duration: "~6min"
  completed: "2026-04-15"
  tasks: 2
  files: 6
requirements: [INS-01, INS-02, INS-03, INS-05, INS-06]
---

# Phase 5 Plan 02: Wave 0 RED Test Scaffold Summary

Authored the Nyquist Wave 0 RED test scaffold for Phase 5 — 6 files across Deno (Edge Function unit tests), Vitest (Svelte component test), and a shell stub (forker dry-run). Every test imports or calls a production artifact that does not yet exist, making each file RED by construction. Downstream plans 05-03 / 05-04 / 05-05 flip these tests GREEN as their definition of done.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Deno test scaffold (3 test files + deno.json) | 69115d5 | `deno.json`, `digit-guard.test.ts`, `payload.test.ts`, `fallback.test.ts` |
| 2 | InsightCard.test.ts + fork-dryrun.sh | d86c1ef | `InsightCard.test.ts`, `fork-dryrun.sh` |

## RED State Confirmed

- `digit-guard.test.ts` imports `./digitGuard.ts` → module does not exist (8 tests)
- `payload.test.ts` imports `./payload.ts` type → module does not exist (1 active test + 1 ignored)
- `fallback.test.ts` imports `./fallback.ts` → module does not exist (5 tests)
- `InsightCard.test.ts` imports `$lib/components/InsightCard.svelte` → component does not exist (8 tests)
- `scripts/fork-dryrun.sh` exits 1 with "NOT YET IMPLEMENTED" message

Total: 22 active test cases staged to flip GREEN across 05-03/04/05.

## Deviations from Plan

None - plan executed exactly as written.

## Downstream Unlock

- **05-03** (Edge Function impl): creates `digitGuard.ts`, `payload.ts`, `fallback.ts` → flips 14 Deno tests GREEN
- **05-04** (InsightCard impl): creates `InsightCard.svelte` → flips 8 vitest cases GREEN
- **05-05** (forker walkthrough): implements fork-dryrun.sh checks → exit 0

`05-VALIDATION.md` `wave_0_complete` can now be flipped to `true`.

## Self-Check: PASSED

- FOUND: supabase/functions/generate-insight/deno.json
- FOUND: supabase/functions/generate-insight/digit-guard.test.ts
- FOUND: supabase/functions/generate-insight/payload.test.ts
- FOUND: supabase/functions/generate-insight/fallback.test.ts
- FOUND: src/lib/components/InsightCard.test.ts
- FOUND: scripts/fork-dryrun.sh (executable)
- FOUND commit: 69115d5
- FOUND commit: d86c1ef
- CONFIRMED: no production modules (digitGuard.ts, fallback.ts, payload.ts, InsightCard.svelte) exist
