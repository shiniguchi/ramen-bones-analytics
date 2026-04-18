---
quick_id: 260418-g6s
status: complete
date: 2026-04-18
commits:
  - 982b010  # Initial fix: depends() + invalidate() + async withUpdate
  - 92c585a  # Follow-up: swap invalidate() -> goto({invalidateAll:true}) — caught by Chrome MCP QA
qa_verified: 2026-04-18T09:55:00Z
qa_method: Chrome-MCP 3-scenario live QA on DEV
---

# Quick Task 260418-g6s — Range-chip SSR refetch fix

## Tasks shipped

| Commit | What shipped |
|---|---|
| `982b010` | `+page.server.ts` adds `depends('app:dashboard')`. `+page.svelte` makes `handleRangeChange` async, `withUpdate` becomes try/finally around `await fn()`. Cache-miss branch calls `await invalidate('app:dashboard')`. |
| `92c585a` | Replaces `invalidate('app:dashboard')` with `await goto(globalThis.window.location.href, { replaceState: true, invalidateAll: true, noScroll: true, keepFocus: true })`. |

## Why two commits

The debug session (`.planning/debug/range-chip-stale-cache.md`) prescribed `depends()` + `invalidate()` based on SvelteKit's standard load-dep docs. Chrome MCP QA after shipping `982b010` caught a subtle runtime bug:

- Chip click via `applyPreset` calls `$app/navigation.replaceState(url, {})` — browser URL updates, `$app/state.page.url` updates.
- Then `handleRangeChange` calls `await invalidate('app:dashboard')`.
- SvelteKit re-runs load with the **stale URL** that was active when load last ran (the initial page load, `?_cb=…`), **not** the replaceState-updated URL.
- Captured fetch payload: `/__data.json?_cb=g6s_fresh&x-sveltekit-invalidated=01&x-sveltekit-trailing-slash=1` — no `range=all`.
- Load therefore returned the same 7d slice; KPIs stayed at €502 / 21, testids at `-7d`.

Root cause of the root cause: `$app/navigation.replaceState` does **not** feed the URL back into SvelteKit's internal navigation state that `invalidate()` uses for load re-runs. Only `goto()` does.

`92c585a` swaps `invalidate` → `goto(currentHref, { replaceState: true, invalidateAll: true, noScroll: true, keepFocus: true })`. That tells SvelteKit to atomically (a) update the URL (replaceState avoids a duplicate history entry), and (b) re-run load with the CURRENT URL.

## Chrome MCP QA (2026-04-18T09:55Z, post-92c585a)

Deploy workflow `24602158775` (deploy SHA `92c585a`): **success**.

| Scenario | Expected | Observed | Verdict |
|---|---|---|---|
| **S1 — fresh load, no `?range=`** | 7d default; testids `-7d`; Revenue €502 / Tx 21 | `kpi-revenue-7d: €502`, `kpi-transactions-7d: 21` | PASS |
| **S2 — click "All" preset** | `__data.json` fetch with `range=all`; KPIs jump to full-window; chip label "All"; testids `-all` | 1 fetch, params `{ range: 'all', ... }`; `kpi-revenue-all: €203,3K`, `kpi-transactions-all: 6.896`; chip: "All Jan 1 1970 – Apr 18 2026" | PASS |
| **S3 — click "30d" after "All" (cache hit)** | ZERO additional fetches; KPIs recompute client-side; testids `-30d` | `extraFetches: []`; `kpi-revenue-30d: €20.666`, `kpi-transactions-30d: 705`; chip: "30d Mar 20 – Apr 18" | PASS |
| **S4 — console errors** | None | No runtime errors / exceptions post-deploy | PASS |

Screenshot captured showing "30d" state after All → 30d sequence (proving cache hit works). Tile delta caption also renders correctly: `▼ −4% vs prior 30d` / `▼ −5% vs prior 30d`.

## Mobile real-phone check (user-driven)

The user can re-test the original first-login scenario on their phone:
1. Log out (clear cookie).
2. Log in fresh — dashboard defaults to 7d (~€7.303 / 258 on their tenant).
3. Tap "All" chip → spinner briefly, then KPIs + charts update to full-window totals.
4. Tap "30d" → instant, no spinner.

If that passes, bug is closed. Deploy is live at `https://ramen-bones-analytics.pages.dev/`.

## Test counts

| | Before | After |
|---|---|---|
| `npx vitest run tests/unit` | 198 green | 198 green |
| `npx svelte-check --threshold error` | 17 errors baseline | 17 errors (unchanged) |

## Deviations from original plan

The debug report proposed Option A (`depends` + `invalidate`). That was the textbook SvelteKit pattern but it has a live-URL-tracking gap when paired with `$app/navigation.replaceState`. Actual shipped fix uses `goto({ replaceState, invalidateAll })` — functionally equivalent for our use case, but using the one API that SvelteKit supports for "update URL + re-run load" atomically.

The `depends('app:dashboard')` in `+page.server.ts` stays in place. It's harmless with `goto + invalidateAll: true` (invalidateAll invalidates all deps regardless), and gives a future escape hatch if we ever want to invalidate just this route without a nav.

## Follow-up memory saved

`feedback_sveltekit_replacestate_invalidate_gotcha.md` — documents the `replaceState` + `invalidate()` stale-URL trap for future chart/filter work on this codebase.
