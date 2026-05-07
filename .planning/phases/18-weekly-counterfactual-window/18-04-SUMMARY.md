---
phase: 18-weekly-counterfactual-window
plan: "04"
subsystem: frontend
tags: [svelte, frontend, hero-rewrite, weekly-counterfactual, decision-A, tdd]
dependency_graph:
  requires:
    - 18-03 (/api/campaign-uplift returns weekly_history[])
  provides:
    - CampaignUpliftCard hero reads weekly_history instead of cumulative row
    - data-testid="uplift-week-headline-range" on hero date label
    - selectedWeekIndex $state declared for Plan 05 tap-to-scrub
  affects:
    - 18-05 (bar chart — reads weekly_history, taps set selectedWeekIndex)
    - 18-06 (i18n uplift_week_label key wires into formatHeadlineWeekRange call site)
tech_stack:
  added: []
  patterns:
    - Decision A maturityTier from weeks-since-launch (NOT n_days)
    - WeeklyHistoryPoint type + weekly_history Payload extension
    - formatHeadlineWeekRange via Intl.DateTimeFormat (zero bundle cost)
    - divergenceWarning disabled on per-week reads (Claude Discretion)
    - TDD RED/GREEN gate sequence maintained
key_files:
  modified:
    - src/lib/components/CampaignUpliftCard.svelte
    - tests/unit/CampaignUpliftCard.test.ts
decisions:
  - "Decision A (LOCKED): maturityTier sourced from Math.floor((today - campaign.start_date) / 7 days). Per-week rows always have n_days=7 which would always resolve to 'early' under the old n_days-based derivation — Decision A fixes this by anchoring tier to elapsed campaign duration."
  - "Decision A option (b) drop-tiering rejected: existing 7-key i18n set already translated for en+ja; richer copy variation in early weeks benefits the friend-owner without new i18n work."
  - "divergenceWarning disabled on per-week reads (Claude Discretion): per-week rows have naive_dow_uplift_eur=null by construction (Plan 02/PATTERNS §2c). The divergence cross-check was meaningful for cumulative rows; it is not meaningful per-week. Hardcoded false; divergence-warning element absent from DOM."
  - "i18n key uplift_week_label wiring deferred to Plan 06: Plan 04 renders 'Week of {range}' directly using formatHeadlineWeekRange(); Plan 06 swaps to t(locale, 'uplift_week_label', {range}) once key exists across all locales."
  - "layerchart_contract test skipped (not deleted): Plan 05 replaces Spline+Area with Bars; marking it.skip with comment prevents pre-Plan-05 failure without losing the intent."
metrics:
  duration: "~20min"
  completed: "2026-05-07"
  tasks_completed: 1
  files_modified: 2
---

# Phase 18 Plan 04: CampaignUpliftCard Hero Rewrite Summary

Hero of `CampaignUpliftCard.svelte` rewritten to consume `weekly_history` from the Plan 03 API payload. Decision A (locked in plan frontmatter) anchors maturity tier to chronological weeks-since-launch instead of `n_days` (which is always 7 for completed ISO weeks). New `data-testid="uplift-week-headline-range"` renders "Week of Apr 27 – May 3" date range on the hero. All existing `data-testid`s preserved.

## What Was Built

### Task 1 (TDD RED): weekly_history hero contract tests — commit `81ea4db`

Added to `tests/unit/CampaignUpliftCard.test.ts`:

- `FIXTURE_WEEKLY_NORMAL`, `FIXTURE_WEEKLY_EMPTY`, `FIXTURE_WEEKLY_NEGATIVE_LIFT`, `FIXTURE_WEEKLY_CI_STRADDLES_ZERO` — 4 new weekly-history-aware fixtures
- `weekly_history` field added to existing fixtures (`FIXTURE_HEADLINE_NORMAL` etc.) for back-compat
- 4 new test cases (RED):
  1. `weekly_history.at(-1) hero pick when selectedWeekIndex=null`
  2. `data-testid="uplift-week-headline-range" renders week date range`
  3. `Decision A — maturity tier from weeks-since-launch, not n_days`
  4. `empty weekly_history → cf-computing empty state (no hero number, no range)`
- `layerchart_contract` test marked `it.skip` (Plan 05 replaces Spline+Area with Bars)
- 3 tests RED (confirmed failing before implementation)

### Task 2 (TDD GREEN): CampaignUpliftCard rewrite — commit `eca9696`

Changes to `src/lib/components/CampaignUpliftCard.svelte`:

- **New `WeeklyHistoryPoint` type**: `iso_week_start`, `iso_week_end`, `model_name`, `point_eur`, `ci_lower_eur`, `ci_upper_eur`, `n_days: 7`
- **`Payload` extended**: `weekly_history: WeeklyHistoryPoint[]` field added
- **`selectedWeekIndex = $state<number | null>(null)`**: declared for Plan 05 tap-to-scrub bar interaction
- **`headline` $derived rewritten**: reads `data.weekly_history.filter(w => w.model_name === 'sarimax')`, picks `idx = selectedWeekIndex ?? arr.length - 1`, returns `{ campaign, week, weeks: sarimaxWeeks }`
- **`ciOverlapsZero`**: reads `headline.week.ci_lower_eur / ci_upper_eur`
- **`divergenceWarning = $derived(false)`**: disabled — per-week rows have `naive_dow_uplift_eur=null` (Plan 02/PATTERNS §2c); Claude's Discretion documented in code comment and SUMMARY
- **`maturityTier` (Decision A LOCKED)**:
  ```typescript
  // Decision A (Plan 18-04 LOCKED): maturity tier sourced from chronological weeks since
  // campaign launch — NOT from headline.week.n_days, which is always 7 for completed weeks.
  // Rejected option (b) drop-tiering because the existing 7-key i18n set provides richer
  // copy variation in the first 1-2 weeks.
  const weeksSinceLaunch = Math.floor((Date.now() - parseISO(campaign.start_date).getTime()) / (7 * 24 * 60 * 60 * 1000));
  if (weeksSinceLaunch < 2) return 'early';
  if (weeksSinceLaunch < 4) return 'midweeks';
  return 'mature';
  ```
- **`heroKey` matrix**: structurally unchanged; reads `headline.week.point_eur` (not `row.cumulative_uplift_eur`)
- **`heroVars`**: `weeks: weeksSinceLaunch` (not `Math.floor(n_days / 7)`)
- **`isCIOverlap`**: reads `headline.week.point_eur`
- **`formatHeadlineWeekRange()`**: new helper using `Intl.DateTimeFormat(locale, {month:'short', day:'numeric'})` — zero bundle cost
- **Hero date label** (new):
  ```svelte
  <span class="text-sm text-zinc-600 block mb-1" data-testid="uplift-week-headline-range">
    Week of {formatHeadlineWeekRange(headline.week, page.data.locale)}
  </span>
  ```
  Plan 06 wires the `uplift_week_label` i18n key into this call site.
- **Secondary plain line**: reads `headline.week.point_eur / ci_lower_eur / ci_upper_eur`
- **Disclosure panel**: shows weekly point estimate + CI; `{#if divergenceWarning}` block always suppressed
- **Preserved unchanged**: sparkline `data.daily.map`, `Tooltip.Root {#snippet children(...)}` form, `touchEvents:'auto'`, `ModelAvailabilityDisclosure` (not present in this file — lives on +page.svelte), all existing `data-testid`s

Also updated pre-existing tests to align with new weekly_history behavior:
- `shows hero number when CI does not overlap zero` → asserts on `880` (last weekly point) + `hero-uplift` testid
- `shows plain-language hero + isCIOverlap testid when CI overlaps zero` → uses `FIXTURE_WEEKLY_CI_STRADDLES_ZERO`, asserts `Probably not measurable yet`
- `shows divergence warning inside disclosure panel` → updated to verify divergence-warning is absent on per-week reads (correct per-week behavior); disclosure panel + anticipation note still verified

## Decision A Rationale (verbatim from plan)

> The existing function maps `n_days < 14 → early`, `< 28 → midweeks`, else `mature`. With per-week reads, `n_days = 7` always for fully-completed weeks, so every weekly hero would resolve to `early` → `uplift_hero_too_early`. Wrong.
>
> **Decision A — picked: option (a)** — derive `maturityTier` from **chronological weeks since campaign launch** (`Math.floor((today - campaign.start_date) / 7days)`). Thresholds stay (`<2 weeks → early`, `<4 weeks → midweeks`, `≥4 weeks → mature`). This preserves the 3-tier matrix the cumulative version used and keeps all 7 i18n keys in play.
>
> **Decision A — rejected: option (b)** drop maturity tiering entirely. Reason: the existing 7-key i18n set is already translated for `en`+`ja`, and the friend-owner benefits from "too early to tell" copy variation in the first 1–2 weeks. Keeping the matrix means richer copy without new i18n work.

In-code comment verbatim:
```typescript
// Decision A (Plan 18-04 LOCKED): maturity tier sourced from chronological weeks since
// campaign launch — NOT from headline.week.n_days, which is always 7 for completed weeks.
// Rejected option (b) drop-tiering because the existing 7-key i18n set provides richer
// copy variation in the first 1-2 weeks.
```

## Test Results

```
Test Files  1 passed (1)
      Tests  12 passed | 1 skipped (13)
   Start at  10:22:02
   Duration  8.84s
```

12/13 tests pass; 1 skipped (`layerchart_contract` — Plan 05 target).

4 new tests GREEN:
1. `weekly_history: hero reads from weekly_history.at(-1) when selectedWeekIndex is null` — PASS
2. `weekly_history: data-testid="uplift-week-headline-range" renders week range for last ISO week` — PASS
3. `Decision A — maturity tier reads from weeks-since-launch, NOT n_days` — PASS
4. `weekly_history: empty weekly_history → uplift_hero_too_early empty-state copy` — PASS

Preserved tests:
- `tooltip_snippet_contract` — PASS
- `touch_events_contract` — PASS
- `sparkline_data_contract` — PASS
- `shows skeleton during fetch` — PASS
- `shows plain-language CF computing message when campaigns array is empty` — PASS
- All others — PASS

## Localhost QA

Playwright MCP tools not available in executor environment. Dev server responsive at http://localhost:5173 (HTTP 303 — normal auth redirect).

**Checkpoint emitted for human-verify:** user to confirm visual rendering, console clean, `uplift-week-headline-range` in DOM, disclosure panel toggles.

## Deviations from Plan

### Claude's Discretion 1: Divergence warning disabled on per-week reads

- **Found during:** Implementation of `divergenceWarning` $derived
- **Issue:** Per-week rows have `naive_dow_uplift_eur=null` by construction (Plan 02/PATTERNS §2c). The divergence cross-check (sarimax vs naive_dow sign/magnitude) is only meaningful for cumulative rows; per-week rows never have a naive_dow value to compare against.
- **Fix:** `divergenceWarning = $derived(false)` — permanently suppressed for per-week reads. The `{#if divergenceWarning}` block in the template still exists but never renders. The plan noted this as an acceptable Claude's Discretion path ("GUARD this derivation to fall back to `null`... OR: simpler — disable the divergence warning entirely on per-week reads and document").
- **Files modified:** `src/lib/components/CampaignUpliftCard.svelte`, `tests/unit/CampaignUpliftCard.test.ts`
- **Commit:** `eca9696`

### Auto-update: Pre-existing tests aligned with weekly_history behavior

- **Found during:** GREEN phase test run
- **Issue:** 3 pre-existing tests (`shows hero number when CI does not overlap zero`, `shows plain-language hero + isCIOverlap testid when CI overlaps zero`, `shows divergence warning`) were asserting on cumulative-row behavior. Adding `weekly_history` to fixtures caused the hero to read from weekly_history instead, breaking these assertions.
- **Fix:** Updated the 3 tests to assert on the correct weekly_history behavior. The test *intent* is preserved; the *expected values* updated to match the Plan 04 hero source.
- **Files modified:** `tests/unit/CampaignUpliftCard.test.ts`
- **Commit:** `eca9696`

## Known Stubs

- `formatHeadlineWeekRange()` renders "Week of Apr 27 – May 3" directly (English hardcoded prefix "Week of"). The `uplift_week_label` i18n key is pending Plan 06, which will replace the literal prefix with `t(locale, 'uplift_week_label', {range: ...})`.

## Threat Surface Scan

- T-18-09 (Tampering — malformed weekly_history): Mitigated by `data?.weekly_history?.length` optional-chain guard on headline derivation. `selectedWeekIndex` bounds-checked against `sarimaxWeeks.length`.
- T-18-10 (XSS via week label): `iso_week_start` / `iso_week_end` come from server-side date math in Plan 03; rendered through `Intl.DateTimeFormat` (text-only output). No `{@html}` usage.
- No new threat surface introduced beyond what the plan's threat model covers.

## TDD Gate Compliance

- RED gate: `test(18-04): RED — weekly_history hero contract (UPL-08 UPL-09)` — commit `81ea4db`
- GREEN gate: `feat(18-04): CampaignUpliftCard hero rewrite — weekly_history + Decision A (UPL-08 UPL-09)` — commit `eca9696`

Both gates present in git log. Sequence: RED before GREEN. Compliant.

## Self-Check: PASSED

- `src/lib/components/CampaignUpliftCard.svelte` — FOUND, contains `weekly_history`, `WeeklyHistoryPoint`, `selectedWeekIndex`, `uplift-week-headline-range`, `formatHeadlineWeekRange`, `Decision A`
- `tests/unit/CampaignUpliftCard.test.ts` — FOUND, contains `FIXTURE_WEEKLY_NORMAL`, `FIXTURE_WEEKLY_EMPTY`, `weekly_history`, Decision A test
- Commit `81ea4db` — FOUND (RED gate)
- Commit `eca9696` — FOUND (GREEN gate)
- 12/13 tests pass (1 skipped), exit 0
- TypeScript check: 7 pre-existing errors only (no new errors from Plan 04 files)
