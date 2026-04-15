---
phase: 05-insights-forkability
plan: 04
subsystem: dashboard-ui
tags: [wave-2, sveltekit, insight-card, ci-guard]
requires:
  - public.insights_v wrapper view (05-01)
  - InsightCard.test.ts RED scaffold (05-02)
provides:
  - "InsightCard.svelte text-only card component"
  - "+page.server.ts insights_v fan-out query + is_yesterday derivation"
  - "+page.svelte card stream with InsightCard prepended"
  - "ci-guards Guard 1 extension forbidding raw .from('insights') from src/"
affects:
  - "Closes INS-03 (latest insight visible on dashboard)"
  - "Flips 8 InsightCard Vitest tests from RED to GREEN"
  - "Locks future plans out of raw insights table access"
tech_stack:
  added: []
  patterns:
    - "JWT-filtered wrapper view consumed via Promise.all fan-out"
    - "Berlin-localized today derivation for is_yesterday flag (Intl.DateTimeFormat en-CA)"
    - "Conditional card rendering ({#if data.latestInsight}) — silent absence on no row"
key_files:
  created:
    - src/lib/components/InsightCard.svelte
    - .planning/phases/05-insights-forkability/05-04-SUMMARY.md
  modified:
    - src/routes/+page.server.ts
    - src/routes/+page.svelte
    - scripts/ci-guards.sh
decisions:
  - "Timezone hardcoded to Europe/Berlin (single-tenant v1) instead of reading session.user.app_metadata.timezone — load function uses locals.supabase, not session, and Berlin is the project default. Multi-tenant rework deferred."
  - "insightP query uses .then() error swallow only (no .catch()) — matches the pattern that compiles cleanly under current supabase-js types, unlike pre-existing freqP/nvrP/retentionP/ltvP which carry .catch() TS errors out of scope of this plan."
  - "Guard 1 regex addition uses literal \\.from\\(['\\\"]insights['\\\"]\\) — matches raw quoted form only, leaves insights_v untouched."
metrics:
  duration: ~5min
  completed: 2026-04-15
  tasks: 2
  files: 5
requirements: [INS-03]
---

# Phase 5 Plan 04: InsightCard UI Wire-up Summary

**One-liner:** Ships the user-visible InsightCard — SvelteKit SSR loader fetches the latest row from `insights_v`, prepends a passive text-only card above the revenue tiles, and extends Guard 1 to keep raw `insights` table access out of `src/`.

## What Shipped

### `src/lib/components/InsightCard.svelte` (NEW, 40 lines)

- `<section role="article">` outer wrapper with the standard card chrome (`rounded-xl border border-zinc-200 bg-white p-4`)
- `<h2 class="text-xl font-semibold leading-tight text-zinc-900">` headline
- `<p class="mt-2 text-sm leading-normal text-zinc-700">` body
- Conditional `<span>From yesterday</span>` (text-zinc-500 caption) above headline when `insight.is_yesterday`
- Conditional `<span>· auto-generated</span>` below body when `insight.fallback_used`
- Svelte 5 runes (`$props()`), no icons, no animations, no interactivity — passive card per UI-SPEC

### `src/routes/+page.server.ts` (modified)

- New `insightP` Promise queries `insights_v` (`id, business_date, headline, body, fallback_used`) ordered desc, `limit(1).maybeSingle()` — the only row the dashboard ever needs
- Added as the 13th entry in the existing `Promise.all` fan-out; existing 12 queries untouched
- Post-await, computes `todayBerlin` via `Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' })`
- Builds `latestInsight = { headline, body, business_date, fallback_used, is_yesterday: business_date !== todayBerlin }` or `null`
- Returned as new top-level `latestInsight` field; per-card error isolation via `.then()` swallow + `console.error`

### `src/routes/+page.svelte` (modified)

- Imports `InsightCard`
- Prepends `{#if data.latestInsight}<InsightCard insight={data.latestInsight} />{/if}` as the first child of the `<main>` card stream — above the three fixed revenue tiles
- Sticky chip bar + FreshnessLabel stay above `<main>`, unchanged

### `scripts/ci-guards.sh` (modified — Guard 1 extended)

Before:
```
grep -rnE "from[[:space:]]+['\"]?transactions['\"]?|\.from\(['\"]transactions['\"]\)|\bstg_orderbird_order_items\b|\b[a-z_]+_mv\b" src/
```

After (added `\.from\(['\"]insights['\"]\)` alternation):
```
grep -rnE "from[[:space:]]+['\"]?transactions['\"]?|\.from\(['\"]transactions['\"]\)|\.from\(['\"]insights['\"]\)|\bstg_orderbird_order_items\b|\b[a-z_]+_mv\b" src/
```

`insights_v` is left untouched because the literal pattern requires the closing quote+paren immediately after `insights`.

## Vitest Result

```
Test Files  1 passed (1)
Tests       8 passed (8)
```

All 8 InsightCard.test.ts cases — headline/body render, From-yesterday label (positive + negative), auto-generated chip (positive + negative), text-zinc-900/700 contrast, role=article — flip from RED to GREEN. INS-03 closed.

## Negative Guard Test

Created `src/scratch.ts` containing `supabase.from('insights').select()`, ran the extended Guard 1 grep — matched (would fail CI). Deleted scratch file. Confirmed `supabase.from('insights_v').select()` does NOT match.

## Type Check

`svelte-check` post-change: 12 errors (all pre-existing in unrelated files: hooks.server.ts claims typing, freqP/nvrP/retentionP/ltvP `.catch()` on PromiseLike, CohortRetentionCard layerchart default, NvrShaped union mismatch). Pre-change baseline: 12 errors. **Zero new TS errors introduced by 05-04.** Out-of-scope per the executor scope-boundary rule (these belong to other Phase 5 parallel plans / Phase 4 follow-up).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | InsightCard.svelte (TDD GREEN flip) | e5689d4 | src/lib/components/InsightCard.svelte |
| 2 | +page.server loader + +page.svelte stream + ci-guard extension | fb8a93b | src/routes/+page.server.ts, src/routes/+page.svelte, scripts/ci-guards.sh |

## Deviations from Plan

**1. [Rule 3 — Blocking] Dropped `.catch()` from insightP**

- **Found during:** Task 2 type-check
- **Issue:** The plan's pattern of chaining `.then(...).catch(...)` on a supabase query produces a TS error: `Property 'catch' does not exist on type 'PromiseLike<...>'`. Pre-existing `freqP`/`nvrP`/`retentionP`/`ltvP` already carry this exact error (12 baseline errors).
- **Fix:** Used `.then(...)` with internal error logging only — semantically equivalent (errors yield `null` either way) and TS-clean.
- **Files modified:** src/routes/+page.server.ts
- **Commit:** fb8a93b

**2. [Rule 1 — Bug fix] Hardcoded Berlin timezone instead of `session.user.app_metadata.timezone`**

- **Found during:** Task 2 implementation
- **Issue:** The plan's snippet referenced `session.user.app_metadata?.timezone`, but the existing load function does not destructure `session` at all — it uses `locals.supabase` directly. Following the snippet verbatim would crash at runtime with "session is not defined".
- **Fix:** Hardcoded `'Europe/Berlin'` (project default for v1 single-tenant). When multi-tenant lands, this becomes a one-line change to read from the JWT custom claim.
- **Files modified:** src/routes/+page.server.ts
- **Commit:** fb8a93b

## Known Stubs

None. The card has a real data source (`insights_v`) and is hidden when the source returns no rows — no placeholder/empty rendering.

## Self-Check: PASSED

- FOUND: src/lib/components/InsightCard.svelte
- FOUND: src/routes/+page.server.ts
- FOUND: src/routes/+page.svelte
- FOUND: scripts/ci-guards.sh
- FOUND: .planning/phases/05-insights-forkability/05-04-SUMMARY.md
- FOUND commit: e5689d4 (Task 1)
- FOUND commit: fb8a93b (Task 2)
- VERIFIED: 8/8 InsightCard vitest tests green
- VERIFIED: zero new TS errors (12 pre-existing baseline maintained)
- VERIFIED: Guard 1 negative test trips on raw insights, ignores insights_v
