---
phase: 11-ssr-perf-recovery
plan: 03
subsystem: ssr-observability
wave: 3
depends_on: [11-01, 11-02]
tags:
  - phase-11-ssr-perf-recovery
  - observability
  - documentation
dependency-graph:
  requires:
    - "11-01 (earliestBusinessDate query stabilizes line numbers)"
    - "11-02 (Promise.all shrunk to 6 promises — LITERAL_COUNT target)"
  provides:
    - "Dev-only SSR fan-out timing log surfacing query count + elapsed ms"
    - "Inline CF Pages Free-tier tripwire comment for next reviewer"
  affects:
    - "src/routes/+page.server.ts"
tech-stack:
  added: []
  patterns:
    - "import.meta.env.DEV guard for tree-shakable dev-only instrumentation"
key-files:
  created: []
  modified:
    - "src/routes/+page.server.ts"
decisions:
  - "D-06 (dev-only SSR timing log, import.meta.env.DEV-gated)"
  - "D-07 (inline CF Pages Free-tier limits tripwire comment)"
  - "LITERAL_COUNT hard-coded as 6 rather than computed from promises.length (Wave 3 ordering makes this deterministic; alternative requires a second array declaration that can drift)"
metrics:
  duration: "~8 min"
  completed-date: "2026-04-21"
---

# Phase 11 Plan 11-03: SSR Observability + CF Pages Tripwire Summary

Added D-06 (dev-only SSR fan-out timing log) and D-07 (CF Pages Free per-request budget comment) to `+page.server.ts`. Pure defense / observability — no behavior change, no runtime cost in production (tree-shaken via `import.meta.env.DEV`).

## What changed

### `src/routes/+page.server.ts` — Part A: CF Pages Free tripwire comment

Inserted immediately after `depends('app:dashboard');` (before `parseFilters`):

```diff
 export const load: PageServerLoad = async ({ locals, url, depends }) => {
   depends('app:dashboard');
+  // ---------------------------------------------------------------------
+  // CF Pages Free-tier per-request budget:
+  //   • 50 subrequests (each fetchAll page = 1 subrequest)
+  //   • 50 ms CPU time on the Worker thread
+  // If you add a new query here, count the pages it adds (for fetchAll:
+  // ceil(row_count / 1000)). If total might exceed ~40 in a hot window,
+  // move the new query to /api/* and fetch it client-side via LazyMount
+  // (see Plan 11-02 for the established pattern).
+  // Phase 11 root cause: `.planning/debug/cf-pages-ssr-cpu-1102.md`
+  // ---------------------------------------------------------------------
   // Phase 6 FLT-07: parseFilters is the ONLY place filter params are read.
   const filters = parseFilters(url);
```

### `src/routes/+page.server.ts` — Part B: dev-only SSR timing log around the 6-promise fan-out

```diff
   // SSR subrequest count: 6 here + freshness + earliest-business-date = 8
   // total, well under CF Pages Free 50-request ceiling.
+  // D-06: dev-only SSR timing log. Tree-shaken out of production builds
+  // (import.meta.env.DEV === false). Surfaces in `npm run dev` console
+  // and in `wrangler pages dev` preview; never runs on deployed CF Pages.
+  const __ssrT0 = import.meta.env.DEV ? Date.now() : 0;
   const [
     dailyRows,
     priorDailyRows,
     latestInsightRow,
     itemCounts,
     benchmarkAnchors,
     benchmarkSources
   ] = await Promise.all([
     dailyRowsP,
     priorDailyRowsP,
     insightP,
     itemCountsP,
     benchmarkAnchorsP,
     benchmarkSourcesP
   ]);
+  if (import.meta.env.DEV) {
+    // LITERAL_COUNT is hard-coded rather than `promises.length` because
+    // the array is already destructured above; re-referencing the source
+    // array would require a second Promise.all declaration that can drift.
+    // If Plan 11-02 ever changes this shape, update this number in the
+    // same diff. Current state: 6 promises post-Plan 11-02.
+    const promises = 6;
+    // eslint-disable-next-line no-console
+    console.info(
+      `[ssr-perf] Promise.all: ${promises} queries, ${Date.now() - __ssrT0}ms`
+    );
+  }
```

## Verification

### Acceptance-criteria greps

```
$ grep -n "CF Pages Free-tier per-request budget" src/routes/+page.server.ts
20:  // CF Pages Free-tier per-request budget:

$ grep -n "50 subrequests" src/routes/+page.server.ts
21:  //   • 50 subrequests (each fetchAll page = 1 subrequest)

$ grep -n "50 ms CPU time" src/routes/+page.server.ts
22:  //   • 50 ms CPU time on the Worker thread

$ grep -n "Phase 11 root cause" src/routes/+page.server.ts
27:  // Phase 11 root cause: `.planning/debug/cf-pages-ssr-cpu-1102.md`

$ grep -n "ssr-perf" src/routes/+page.server.ts
246:      `[ssr-perf] Promise.all: ${promises} queries, ${Date.now() - __ssrT0}ms`

$ grep -nE "const promises = 6" src/routes/+page.server.ts
243:    const promises = 6;

$ grep -c "import\.meta\.env\.DEV" src/routes/+page.server.ts
3
```

All acceptance criteria pass.

### Production build + tree-shake

```
$ npm run build
✓ built in 12.16s
Using @sveltejs/adapter-cloudflare
  ✔ done

$ grep -r "ssr-perf" .svelte-kit/output/server/ 2>/dev/null
(no matches)
```

Tree-shake confirmed — the `[ssr-perf]` string is absent from the production bundle, so D-06 adds zero runtime cost on deployed CF Pages.

### Dev-mode timing log surfaces with count = 6

The timing log fires every SSR load in dev (via `npm run dev` or vitest with a simulated env). Each of the 10 pageServerLoader tests exercised the loader, and the vitest stdout captured the timer output on every run:

```
[ssr-perf] Promise.all: 6 queries, 0ms
[ssr-perf] Promise.all: 6 queries, 0ms
... (one per test that invokes load)
[ssr-perf] Promise.all: 6 queries, 13ms
```

`6 queries` matches LITERAL_COUNT and the post-11-02 Promise.all shape exactly.

### Tests + CI guards

```
$ npm test -- tests/unit/pageServerLoader.test.ts --run
 Test Files  1 passed (1)
      Tests  10 passed (10)

$ bash scripts/ci-guards.sh
# Guard 1 fails on src/lib/cohortAgg.ts (pre-existing, comment-only false positive
# already documented in 11-02 deferred-items.md). Verified pre-existing by
# stashing 11-03's change and re-running — same Guard 1 failure without my edit.
# Guard 6 (no-dynamic-sql): clean
# Guard (migration drift): OK
```

### Protected files untouched

`git status` confirms the 6 user-uncommitted files carry only the pre-existing `M` marks from before this plan started:

```
 M src/lib/components/CalendarCountsCard.svelte      (pre-existing)
 M src/lib/components/CalendarItemRevenueCard.svelte (pre-existing)
 M src/lib/components/CalendarItemsCard.svelte       (pre-existing)
 M src/lib/components/CalendarRevenueCard.svelte     (pre-existing)
 M src/lib/dashboardStore.svelte.ts                  (pre-existing)
 M tests/unit/CalendarCards.test.ts                  (pre-existing)
 M src/routes/+page.server.ts                        (THIS PLAN — only file touched)
```

## Wave 3 ordering eliminated the original merge ambiguity

The original plan flagged a potential merge conflict with Plan 11-02 because the timing wrapper touches the Promise.all block that 11-02 also restructures. Wave 3 ordering — running this plan strictly after 11-02 has landed — resolved this cleanly:

- Plan 11-02 landed the final 6-promise fan-out (commit `7b93a76`).
- Plan 11-03 wraps that stable block with `__ssrT0` + post-await `console.info`.
- `LITERAL_COUNT = 6` is therefore deterministic at edit time, not speculative — no "pre-11-02 = 11, post-11-02 = 6" branching, no brittle `promises.length` fallback.

If Plan 11-02 is ever revised to change the promise count, the LITERAL_COUNT update is a one-line diff in the same commit, which the inline comment documents explicitly.

## Deviations

None. Plan executed as written. Only observed environmental note:

- **Pre-existing CI Guard 1 failure on `src/lib/cohortAgg.ts`** (comment-only false positive, documented in `deferred-items.md` from 11-02). Verified pre-existing by stashing 11-03's edit and re-running — Guard 1 fails identically without this plan's change. Out of scope per Rule 4 (not caused by this task's code changes).

## Deferred Issues

None introduced by this plan. Pre-existing deferred items (see `deferred-items.md`) remain unchanged:
- CI Guard 1 false positive on `src/lib/cohortAgg.ts` comments
- 16 failing tests elsewhere in the suite tied to user's uncommitted Calendar* work

## Self-Check: PASSED

- File exists: `src/routes/+page.server.ts` — verified (grep matches on lines 20–27, 221, 237, 243, 246)
- Commit: will record hash after final commit completes
- Tree-shake verified: `grep -r "ssr-perf" .svelte-kit/output/server/` → no matches
- Dev-mode log verified: vitest stdout shows `[ssr-perf] Promise.all: 6 queries, <N>ms`
- Tests: 10/10 pageServerLoader tests pass
