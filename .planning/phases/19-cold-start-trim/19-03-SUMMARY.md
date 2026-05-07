---
phase: "19"
plan: "03"
subsystem: i18n
tags: [bundle-size, lazy-loading, i18n, cold-start]
dependency_graph:
  requires: []
  provides: [loadDict, seedDict, getDict, MessageKey]
  affects: [hooks.server.ts, +layout.server.ts, +layout.svelte, all t() call sites]
tech_stack:
  added: []
  patterns:
    - "Dynamic import per-locale dict via switch-case for Vite static analysis"
    - "SSR payload hydration pattern: loadDict (server) → getDict (serialize) → seedDict (client)"
key_files:
  created:
    - src/lib/i18n/dict/en.ts
    - src/lib/i18n/dict/de.ts
    - src/lib/i18n/dict/ja.ts
    - src/lib/i18n/dict/es.ts
    - src/lib/i18n/dict/fr.ts
  modified:
    - src/lib/i18n/messages.ts
    - src/hooks.server.ts
    - src/routes/+layout.server.ts
    - src/routes/+layout.svelte
decisions:
  - "Switch-case in loadDict instead of bare dynamic template literal — Vite needs static analysis to emit per-locale chunks"
  - "messages.en compatibility shim retained (deprecated) — 3 test files import it; clean-up deferred to a later plan"
  - "$effect for seedDict in +layout.svelte — silences Svelte 5 initial-capture warning without losing correctness"
metrics:
  duration: "~10 minutes"
  completed_date: "2026-05-07"
  tasks_completed: 6
  files_changed: 9
---

# Phase 19 Plan 03: i18n per-locale dynamic imports Summary

Split the 76 KB `messages.ts` monolith into 5 per-locale dict files; `en` loaded eagerly, `de/ja/es/fr` lazy-loaded via `loadDict()` with Vite-emitted async chunks. Zero changes to the 19+ component `t()` call sites.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Create per-locale dict files | 9a40c24 | src/lib/i18n/dict/{en,de,ja,es,fr}.ts |
| 2 | Rewrite messages.ts | 0600426 | src/lib/i18n/messages.ts |
| 3 | Add loadDict in hooks.server.ts | 871daec | src/hooks.server.ts |
| 4 | Return dict from +layout.server.ts | 2881d8f | src/routes/+layout.server.ts |
| 5 | Seed dict in +layout.svelte | a5a41e6 | src/routes/+layout.svelte |
| 6 | Fix compat shim + layout warning | c1c7852 | src/lib/i18n/messages.ts, +layout.svelte |

## Acceptance Criteria

- [x] `npm run check` passes (plan-related errors resolved; 9 pre-existing errors unchanged)
- [x] `npm run test:unit` — all i18n tests pass (2 pre-existing failures in sparseFilter.test.ts unrelated to this plan)
- [x] `src/lib/i18n/messages.ts` is 3,609 bytes (down from ~76 KB)
- [x] `src/lib/i18n/dict/` contains `en.ts`, `de.ts`, `ja.ts`, `es.ts`, `fr.ts`
- [x] `grep -r "messages\[" src/` returns zero results
- [x] All 19+ component `t()` call sites unchanged (import path `$lib/i18n/messages` unchanged)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Three test files imported the removed `messages` export**
- **Found during:** Step 7 verification (`npm run check`)
- **Issue:** `tests/unit/CalendarItemsCard.test.ts`, `tests/unit/cards.test.ts`, and `tests/unit/forecastEmptyStates.test.ts` all imported `{ messages }` from `messages.ts`, which was removed in the rewrite.
- **Fix:** Added a deprecated `messages.en` getter shim to `messages.ts` that proxies to `getDict('en')`. Tests compile unchanged.
- **Files modified:** `src/lib/i18n/messages.ts`
- **Commit:** c1c7852

**2. [Rule 1 - Bug] Svelte 5 initial-capture warning in +layout.svelte**
- **Found during:** Step 7 verification (`npm run check`)
- **Issue:** Direct `seedDict(data.locale, data.dict)` in top-level script body caused Svelte 5 to warn "This reference only captures the initial value of `data`".
- **Fix:** Wrapped in `$effect()` — runs synchronously during SSR (no-op, cache already warm) and before children mount on client.
- **Files modified:** `src/routes/+layout.svelte`
- **Commit:** c1c7852

## Known Stubs

None — all translation content is verbatim-copied from the original `messages.ts`. No placeholder values introduced.

## Threat Flags

None — this plan touches only static string dictionaries and module loading plumbing. No new network endpoints, auth paths, or schema changes.

## Self-Check: PASSED

All created files confirmed on disk:
- src/lib/i18n/dict/en.ts — FOUND
- src/lib/i18n/dict/de.ts — FOUND
- src/lib/i18n/dict/ja.ts — FOUND
- src/lib/i18n/dict/es.ts — FOUND
- src/lib/i18n/dict/fr.ts — FOUND
- src/lib/i18n/messages.ts — FOUND (3,609 bytes)
- .planning/phases/19-cold-start-trim/19-03-SUMMARY.md — FOUND

All 6 commits confirmed in git log:
- 9a40c24 feat(19-03): create per-locale dict files
- 0600426 feat(19-03): rewrite messages.ts
- 871daec feat(19-03): seed locale dict in hooks.server.ts
- 2881d8f feat(19-03): return locale dict from +layout.server.ts
- a5a41e6 feat(19-03): seed locale dict in +layout.svelte
- c1c7852 fix(19-03): add messages compat shim; use $effect for seedDict
