---
task: 260424-mdc
title: MDE (Minimum Detectable Effect) line chart card on dashboard
branch: quick-260424-mde
status: complete
completed: 2026-04-24
commits:
  - 66926c2  # feat(mde): pure MDE math helpers + unit tests
  - e612519  # feat(mde): add MdeCurveCard to dashboard with reactive σ/n₁
---

# mdc — MDE line chart card — SUMMARY

## What shipped

A new **MdeCurveCard** on the dashboard plots the minimum per-day lift
(€/day average) a marketing campaign must produce to be statistically
significant, for campaign windows of 1…14 days. σ and n₁ are derived
live from `getFiltered()` daily revenue via `$derived.by`, so the curve
re-draws on every range / sales_type / is_cash / day-of-week filter change.

Below `MDE_MIN_BASELINE_DAYS = 7` or σ = 0 the card renders `EmptyState`
with heading = card title and body = "Need ≥ 7 days of baseline data".

**Mounted** between `CalendarRevenueCard` and `CalendarItemsCard` in
`src/routes/+page.svelte` (immediately after the revenue bar chart — the
user sees the revenue and then asks "what lift could I detect?").

## Files

### New (3)
- `src/lib/mde.ts` — pure math: `MDE_Z_ALPHA_HALF`, `MDE_Z_BETA`, `MDE_C`,
  `MDE_MAX_CAMPAIGN_DAYS`, `MDE_MIN_BASELINE_DAYS`, `dailyRevenuesEUR`,
  `sampleStd`, `harmonicMean`, `mdeAt`, `mdeCurvePoints`. Zero Svelte
  imports; imports `DailyRow` type from `$lib/dashboardStore.svelte`.
- `src/lib/mde.test.ts` — 13 Vitest cases covering Bessel-corrected std,
  harmonic mean, the Step-3 PDF sanity check (σ=222, n₁=20, n₂=4 → MDE≈340),
  curve monotonicity, cents→€ same-date rollup, 14-point curve shape.
- `src/lib/components/MdeCurveCard.svelte` — LayerChart Chart+Svg+Spline
  with dashed vertical reference at n₂=7 and `{#snippet children({ data })}`
  Tooltip.Root (honors `feedback_svelte5_tooltip_snippet`). Chart
  `tooltipContext={{ mode: 'bisect-x', touchEvents: 'auto' }}` (honors
  `feedback_layerchart_mobile_scroll`). Self-subscribes via `getFiltered()`.

### Edited (3)
- `src/routes/+page.svelte` — added import + `<MdeCurveCard />` between
  `<CalendarRevenueCard />` and `<CalendarItemsCard />`. No `LazyMount`
  wrapper (store-derived, no network fetch to defer).
- `src/lib/emptyStates.ts` — added `'mde-curve'` entry routing heading→
  `mde_title` and body→`mde_empty`.
- `src/lib/i18n/messages.ts` — added 5 keys × 5 locales
  (`mde_title`, `mde_caption`, `mde_tooltip_day`, `mde_tooltip_mde`,
  `mde_empty`). EN copy used as placeholder for de/ja/es/fr, matching the
  recent i18n rollout cadence (polish later).

### Not edited
- `src/lib/components/EmptyState.svelte` — no change needed. The component
  already looks up copy via `emptyStates[card]`, so adding the `'mde-curve'`
  key to `emptyStates.ts` is the whole integration surface. The plan's
  "edit EmptyState.svelte" step was unnecessary given the current
  table-driven implementation.

## Verification

| Gate                  | Result | Notes                                                             |
|-----------------------|--------|-------------------------------------------------------------------|
| `npm run test` (mde)  | PASS   | 13 / 13 green                                                     |
| `npm run test` (full) | PARTIAL — 8 pre-existing unit-test failures in InsightCard + sparseFilter; identical to main (verified via `git stash`). Scope boundary: out-of-scope for this task. |
| `npx tsc --noEmit`    | PASS (scoped) — 0 errors in new/edited files; 8 pre-existing errors in `hooks.server.ts`, `vite.config.ts`, `tests/unit/cards.test.ts` remain (unrelated). |
| `npm run build`       | PASS   | adapter-cloudflare build ✓ in 10.92s                              |

## Formula + sanity check

```
n_eff(n₁, n₂) = 2·n₁·n₂ / (n₁ + n₂)             ← harmonic mean
MDE(n₂)       = σ · √( C · (n₁ + n₂) / (2·n₁·n₂) )
C             = 2·(z_{α/2} + z_β)²  ≈ 15.68        (α=0.05 two-tailed, 80% power)
```

Closed-form sanity at σ=222, n₁=20, n₂=4:
`222 × √(15.68 × 24 / 160) = 222 × √2.352 ≈ 340.5 €/day` — matches the
founder's Step-3 teaching PDF.

## Deviations from plan

### [Rule 3 — scope trim] `EmptyState.svelte` was NOT edited

**Found during:** Task 2 implementation.
**Reason:** The component is table-driven — it reads heading/body keys from
`emptyStates[card]` and renders via `t()`. Adding the `'mde-curve'` entry
to `emptyStates.ts` is the complete integration. Modifying `EmptyState.svelte`
would have been dead-code noise. Plan text said "Add a branch…" — the
actual codebase doesn't branch, it table-lookups.
**Impact:** Zero functional change; plan's intent satisfied.

### [Rule 3 — key reuse] EmptyState heading reuses `mde_title`

**Reason:** Plan specified exactly 5 new i18n keys. EmptyState needs both a
heading and a body; the 5 keys include `mde_empty` (body) but no dedicated
heading. Routed heading→`mde_title` ("Minimum detectable lift"), body→
`mde_empty`. Adding a 6th key would have exceeded the plan's budget.
**Impact:** Empty state reads naturally
("Minimum detectable lift" / "Need ≥ 7 days of baseline data to draw the curve.").

## Known stubs

None. The card renders real data from `getFiltered()` the moment n₁ ≥ 7;
no placeholder fallback. EN strings are placeholders for de/ja/es/fr —
explicitly tracked as "polish later" by the i18n rollout pattern
(see memory `project_i18n_rollout_260422`), not a stub in the
data-wiring sense.

## Post-execution QA (deferred per plan)

Visual verification was NOT performed during this executor run:

1. **No local dev server is running** (no listener on localhost:5173).
2. **Project CLAUDE.md protocol** targets DEV (Cloudflare Pages), not local
   Vite — "Always verify against DEV (never local only)".
3. **Plan explicitly defers visual QA** to the "Post-execution QA
   (done after merge/push)" section — run after `quick-260424-mde` is
   pushed and the DEV deploy completes.

The verdict for visual verification is therefore **PARTIAL** (DEV deploy
not yet performed). Build-gate green + unit-gate green + tsc-gate green
on the new/edited files are the strongest pre-deploy evidence available.

Post-deploy QA checklist (from plan, unchanged):

1. Push `quick-260424-mde`; wait for DEV deploy.
2. Chrome MCP: open DEV dashboard at 375 px; screenshot the card.
3. Change range chip (7d → 30d → all) → curve shifts (σ and n₁ change).
4. Apply Mon-only DOW filter → caption `n1` drops; if n₁ < 7 the
   EmptyState shows.
5. DevTools console → zero LayerChart warnings (especially
   `invalid_default_snippet`).

## Self-Check: PASSED

Verified files exist on disk:
- `src/lib/mde.ts` ✓
- `src/lib/mde.test.ts` ✓
- `src/lib/components/MdeCurveCard.svelte` ✓

Verified commits on branch `quick-260424-mde`:
- `66926c2` — feat(mde): pure MDE math helpers + unit tests ✓
- `e612519` — feat(mde): add MdeCurveCard to dashboard with reactive σ/n₁ ✓

## Follow-up commits (same session, after interactive review)

- `34f686e` — docs(quick-260424-mdc): PLAN + SUMMARY + STATE (orchestrator-side
  artifact commit from the gsd-quick workflow).
- `a809d53` — feat(dashboard): chart descriptions in 5 locales + MDE polish +
  heatmap Monday-first.
  * MDE render bugs fixed: Chart now uses explicit `xScale={scaleLinear()}` +
    `xDomain={[1, 14]}` and the main Spline gets explicit `data/x/y` props.
    Root cause: LayerChart auto-inference stretched the x range 14× the plot
    width, and the no-prop Spline aliased the 2-point reference Spline's
    series state (both failure modes collapsed the curve to a single vertical
    line at x=237).
  * Caption gained μ (baseline daily mean) alongside σ. Description paragraph
    added under the title citing **Welch's t-test**.
  * Card moved from between Revenue/Items calendars to the BOTTOM of the
    dashboard (decision-support — consulted after primary KPIs).
  * 7 chart cards (heatmap, calendar counts/revenue/items/item-revenue,
    cohort retention, repeater) gained a description paragraph under the
    title in all 5 locales. 4 cards had their `*_subtitle` key swapped to
    `*_description` carrying richer copy; 3 cards without subtitles got a
    new `<p>`.
  * DailyHeatmapCard Sunday-row alignment: LayerChart's `<Calendar>` uses
    d3-time's `timeWeek` hardcoded (Sunday-start), so Sundays visually landed
    in the same column as the Mon-Sat that follow. Patched: Sunday cells
    shift one cell left (clamped at 0) so Mon-Sun weeks align Monday-first.
- `0d9776b` — feat(hooks): localhost-qa-gate Stop hook + CLAUDE.md callout +
  MDE tick polish.
  * New `.claude/hooks/localhost-qa-gate.js` Stop hook (CJS, ~160 LOC):
    parses the session transcript, blocks turn-end when any Edit/Write/
    MultiEdit touched a frontend file without a subsequent
    `mcp__claude-in-chrome__navigate` to localhost. Loop-protected via
    `stop_hook_active`.
  * `.claude/CLAUDE.md` gained a bold "🚨 Exception — Frontend / UI changes:
    LOCALHOST FIRST" block carving out the one exception to the repo's
    "always work against DEV" default.
  * MDE x-axis ticks fixed: `integerTicks(14)` emitted `[0, 3, 6, 9, 12, 14]`
    which d3 formatted as `"0.0", "3.0" …` with an offscreen tick at 0.
    Now explicit `ticks={[1, 4, 7, 10, 14]} format={v => String(v)}`, tick
    `7` aligns exactly with the dashed reference line at x=237.2.
- `<PR cleanup>` — `/review-pr` holistic alignment: deleted 4 orphan
  `*_subtitle` i18n keys (20 lines removed across 5 locales) that were
  left dead after the description swap. Kept `src/lib/trendline.ts`
  `integerTicks` intact (still used by CalendarItemsCard).

## Final QA (post-cleanup, via Chrome MCP on localhost:5173)

- range=all: n₁=234, σ=€354, μ=€899. Curve renders 14 path commands
  monotonically descending; dashed reference at x=237.2 aligns with
  tick 7.
- range=all + days=3,4,5 (Wed-Fri): n₁=126, σ=€208, μ=€727. MDE(14) ≈ €164
  — within 3 % of an external Welch's-t calculation (n₁=119, σ=€203,
  MDE(14) = €161).
- range=30d + days=1 (Mon only) → n₁ drops below 7 → EmptyState renders
  with the localized mde_empty copy.
- Heatmap Sunday row rightmost cell: x=616 (was 630). Sun 19 now visually
  aligns with Mon 13-Sat 18, not Mon 20-Fri 24.
- JA locale live-verified: title/description/caption all in Japanese
  with "Welchのt検定".
- Console across 5 navigations: zero runtime errors.
