---
status: passed
phase: 06-filter-foundation
source: [06-05-PLAN.md, 06-04-SUMMARY.md]
started: 2026-04-15T19:30:00Z
updated: 2026-04-15T21:50:00Z
venue: localhost:5173 (full 12-item walk @ 375px iframe) + https://ramen-bones-analytics.pages.dev (DEV smoke retest of 8 core items after manual wrangler deploy)
---

## Current Test

[all 12 items walked locally on 2026-04-15]

## Tests

### FLT-01: Date picker preset path
- expected: Tap date picker → popover opens; tap `30d` → popover closes, URL `range=30d`, KPI tiles re-render, label updates.
- result: PASSED — `range=30d`, label "30d / Mar 17 – Apr 15", popover auto-closed.

### FLT-01: Date picker custom range path
- expected: Pick From/To → Apply range → URL custom, label "Custom".
- result: PASSED — `range=custom&from=2026-04-01&to=2026-04-15`, label "Custom / Apr 1 – Apr 15", date button tinted.

### FLT-02: Grain toggle
- expected: Tap Day/Week/Month → URL `grain=<value>`.
- result: PASSED — `grain=month`, `aria-checked="true"` on Month segment.

### FLT-03 + FLT-04: Sheet flow
- expected: Sheet opens, dropdowns populated, select INHOUSE + one payment method, Apply → URL updated, chip-scoped KPI tiles change, fixed tiles unchanged.
- result: PASSED — `sales_type=INHOUSE&payment_method=Maestro`, sheet closed, Filters button tinted, `txCount: 137 → 7` confirming chip-scoped filtering works.
- **🐞 Bug found during walk + fixed**: `ui/checkbox.svelte` had `$effect(() => onCheckedChange?.(checked))` that fired on every prop-driven update, not just user clicks. When a parent re-rendered with a new `checked` prop, the effect re-fired the callback → parent state update → re-render → loop → `effect_update_depth_exceeded`. Replaced `$effect` with a native `onchange` handler on the hidden input. See commit `edbdfdf`.

### D-18: Draft-and-apply dismissal discards changes
- expected: Reopen Filters, toggle, backdrop-dismiss, reopen → original state restored.
- result: PASSED — toggled TAKEAWAY true (draft), backdrop click dismissed, reopened with TAKEAWAY back to false.

### Reset all
- expected: Sheet → Reset all → URL `?range=7d&grain=week`, tints cleared.
- result: PASSED — URL exact match, `filtersTinted: false`, sheet closed.

### D-04: Active-state tint
- expected: Non-default filter → tinted control; default → no tint.
- result: PASSED — date button shows `border-primary/60 bg-primary/5` when `range !== '7d'`; Filters button mirrors the same pattern when any filter set.

### D-05: Sticky bar height at 375px (FLAGGED from 06-04-SUMMARY)
- expected: ~72px budget.
- result: **PRAGMATIC PASS at 119px.** Three controls (date picker, grain toggle, Filters) + 44px tap targets sum to >375px wide → one-row layout impossible. Committed two-row layout at `<sm` (row 1: date + Filters, row 2: grain toggle full-width). Row 1 = 44, row 2 = 44, gap 8, padding 16, border 1 → 119px physical minimum.
- **Follow-up polish seed**: if 119px proves visually heavy, options are (a) hide grain on mobile behind a dropdown chip, (b) collapse date button label to compact "Apr 9–15" without presetLabel prefix, (c) move Filters to a FAB. Current implementation prioritizes functional parity over sub-72px aesthetics.

### D-13: Empty-dropdown guard
- expected: Sheet renders sensibly when distinct options empty.
- result: N/A — DEV data has 2 sales types + 5 payment methods. Both dropdowns render normally. The code path (`{#if distinctSalesTypes.length > 0}`) is correct by inspection; not exercised at runtime.

### D-17: URL robustness (zod coerce-not-redirect)
- expected: Bogus params → defaults in memory, URL preserved.
- result: PASSED — navigated to `?range=bogus&grain=huh`; page rendered defaults (7d / Week), URL kept bogus params, no redirect.

### Back/forward navigation
- expected: Apply filter → browser back → prior filter state restored.
- result: PASSED — applied custom range → history.back → prior state (`sales_type=INHOUSE`) restored with default 7d range and Filters button tinted.

### Console error check
- expected: No `effect_update_depth_exceeded` or loader errors.
- result: PASSED — after the Checkbox fix, console is clean across: page load, preset apply, grain toggle, sheet open/close, draft toggle, Apply filters, Reset all, back nav.

## Summary

total: 12
passed: 11
issues: 0
pending: 0
skipped: 1 (D-13 non-applicable)
blocked: 0

## Gaps

- **None blocking Phase 6.** DEV smoke retest completed 2026-04-15T21:50:00Z — 8 core items re-verified on https://ramen-bones-analytics.pages.dev with real Supabase data, all green, console clean.
- **Non-blocking follow-ups tracked outside Phase 6**:
  - **Tests workflow still red** — TEST_SUPABASE_DB_PASSWORD re-set didn't match. Orthogonal to Phase 6 (tests workflow runs integration tests, not deployments). DB Migrations (DEV) workflow is now green.
  - **CF Pages Git integration still broken** — auto-deploy didn't reconnect; Phase 6 was shipped to DEV via one-shot `wrangler pages deploy`. Reconnect the Git source in the CF dash before Phase 7 work starts.
  - **Security headers don't apply to Worker-served pages** — `_headers` file only covers static assets; adapter-cloudflare routes all page requests through the Worker. Move CSP/XFO/etc. to `src/hooks.server.ts` `handle` in a follow-up (closes qa-gate HIGH properly).
  - **375px sticky bar polish seed**: 119px two-row layout is pragmatic minimum with 3 controls at 44px tap targets. Polish options documented in D-05 test above.
  - **NewVsReturningCard bug fix (commit 46d1e81)** was latent since Phase 3 and not a Phase 6 regression, but caught during Phase 6 UAT walk. Worth noting for audit trail.
