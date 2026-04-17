---
id: 260418-1ja
type: quick
branch: dashboard-feedback-overhaul
tasks_completed: 3
files_modified: 11
files_created: 1
commits:
  - hash: f569933
    message: "feat(quick-260418-1ja): add compact EUR/int Y-axis formatters"
  - hash: af8f546
    message: "feat(quick-260418-1ja): swap Counts/Revenue order and rename 7 chart titles"
  - hash: 00a0325
    message: "fix(quick-260418-1ja): convert revenue chart to EUR and wire Y-axis formatters"
tests_added: 6
tests_updated: 3
tests_status: "176/176 unit tests green"
typecheck_status: "0 new svelte-check errors in touched files (21 pre-existing errors unchanged)"
---

# Quick Task 260418-1ja — Pass 1 Dashboard Overhaul Summary

**One-liner:** Swapped Counts/Revenue card order, renamed 7 h2 headings to user-approved strings with em-dashes, and killed the raw-cents Y-axis bug by converting stacked-series cents→EUR + wiring compact de-DE formatters into all 6 BarCharts.

## Files touched

### Created (1)
- `tests/unit/format.test.ts` — 6 permissive regex tests for `formatEURShort` / `formatIntShort` covering small, thousand, and million values.

### Modified (11)
- `src/lib/format.ts` — added `formatEURShort(eur)` and `formatIntShort(n)` using `en` locale compact output + de-DE decimal separator post-processing.
- `src/routes/+page.svelte` — swapped render order: `<CalendarCountsCard />` now appears before `<CalendarRevenueCard />`; comment markers updated to card 7 = Counts, card 8 = Revenue.
- `src/lib/components/CalendarCountsCard.svelte` — heading, import, `yAxis` formatter wiring.
- `src/lib/components/CalendarRevenueCard.svelte` — heading, cents→EUR map on every `VISIT_KEYS + cash` series key, import, `yAxis` formatter wiring.
- `src/lib/components/CalendarItemsCard.svelte` — heading, import, `yAxis` formatter wiring.
- `src/lib/components/CohortRetentionCard.svelte` — heading only (no Y-axis change; this card uses Axis component directly, already formats as %).
- `src/lib/components/CohortRevenueCard.svelte` — heading, import, `yAxis` formatter wiring.
- `src/lib/components/CohortAvgLtvCard.svelte` — heading, import, `yAxis` formatter wiring.
- `src/lib/components/LtvHistogramCard.svelte` — heading, import, new `props={{ yAxis: { format: formatIntShort } }}` attribute.
- `tests/unit/CalendarItemsCard.test.ts` — heading assertion updated to `/Items sold per period/`.
- `tests/unit/LtvHistogramCard.test.ts` — heading assertion updated to `/Customer count by lifetime revenue bucket/`.
- `tests/e2e/dashboard-happy-path.spec.ts` — `getByRole('heading')` regex updated to `/Retention rate by acquisition cohort/i`.

## Per-commit detail

### f569933 — Task 1: compact formatters (feat)
Added `formatEURShort` and `formatIntShort` to `src/lib/format.ts` alongside TDD test file `tests/unit/format.test.ts`.

### af8f546 — Task 2: card swap + heading renames (feat)
11 files changed — 16 insertions, 16 deletions. Source order swap in `+page.svelte`, 7 h2 text replacements across card components (all using U+2014 em-dash), and 3 test-assertion updates.

### 00a0325 — Task 3: cents→EUR fix + Y-axis wiring (fix)
6 files changed — 30 insertions, 9 deletions. Converted `CalendarRevenueCard.chartData` to walk every `SERIES_KEYS = [...VISIT_KEYS, 'cash']` column applying `Math.round(v / 100)`; added `yAxis: { format: ... }` to all 6 BarChart `props` objects; added a new `props` prop to `LtvHistogramCard` (had none previously).

## Verification results

1. **Unit suite:** `npm run test:unit` — 176/176 tests pass across 23 files including new `format.test.ts`, updated `CalendarItemsCard.test.ts`, and updated `LtvHistogramCard.test.ts`.
2. **Type-check (touched files):** `npm run check` — 0 new errors on the 8 Svelte/TS files edited in this task. Pre-existing error count (21 errors across `vite.config.ts`, `hooks.server.ts`, `cards.test.ts`, `dashboardStore.test.ts`, `+page.server.ts`, `CohortRetentionCard.svelte` Tooltip `let:data`) unchanged — all out of scope for this task.
3. **Grep-guard for dead heading strings:** `grep -rn -E "Cohort retention|LTV distribution|Revenue by visit|Customers by visit|Cohort total revenue|Cohort avg LTV"` in `tests/ src/lib/components/ src/routes/` returns only code comments (e.g. `// VA-09: Cohort total revenue per...`, `// VA-10: Cohort avg LTV per...`, `<!-- D-10 card 10: Cohort retention -->`). Zero user-facing h2 hits. All comment references kept intentionally per plan (identifier naming stays stable).
4. **Grep-guard for cents bug:** `grep -c "Math.round" src/lib/components/CalendarRevenueCard.svelte` returns `2` (the `Math.round(v / 100)` conversion inside the `chartData` `$derived.by`).
5. **Grep-guard for Y-axis wiring:** All 6 BarChart files show exactly 1 occurrence of `yAxis:` each (6 total), each paired with the correct formatter (`formatEURShort` on CalendarRevenue / CohortRevenue / CohortAvgLtv; `formatIntShort` on CalendarCounts / CalendarItems / LtvHistogram).

## Deviations from Plan

### Rule 1 — Bug (formatter implementation mismatched the plan's behavior goal)

**1. [Rule 1] Swapped `de-DE` → `en` locale inside the compact formatters**
- **Found during:** Task 1 RED→GREEN run.
- **Issue:** The plan proposed `new Intl.NumberFormat('de-DE', { notation: 'compact', ... })` for both formatters. On Node 25 ICU, this emits bare digits at thousands (`'15.000'`, `'5000'`) because de-DE compact only engages at millions (`'1,2 Mio.'`). That defeats the plan's whole readability goal — founder-feedback #3 was specifically "make the Y-axis readable", and a 5000 label reading `5000` is exactly what the plan is trying to eliminate.
- **Fix:** Use `new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })` for the number portion, then post-process the decimal separator from `.` to `,` to keep German readers happy, and prefix `€` for the currency variant.
- **Behavior:** `formatEURShort(5000) = '€5K'`, `formatIntShort(1500) = '1,5K'`, `formatEURShort(1_200_000) = '€1,2M'`, `formatIntShort(0) = '0'`.
- **Files modified:** `src/lib/format.ts`.
- **Commit:** f569933.
- **Downstream impact:** The plan's regex in `tests/unit/format.test.ts` allowed either `Mio.` or `M`; actual output is `M`. No test changes needed.

### No auth gates
None — pure code change. No Chrome MCP / DEV visual verification performed in this session (out of scope for a local-only executor run; plan's "push + Chrome MCP screenshot" step can be exercised by the human next time they deploy).

## DEV visual verification

**Status:** Deferred to human follow-up. This execution was CLI-only; per the plan's Step 5 the DEV push + 375×812 Chrome MCP screenshot is the final gate.

**Expected DEV behavior once deployed:**
- Calendar Counts renders directly above Calendar Revenue on `/`.
- 7 card titles read the user-approved strings (with em-dash characters).
- Calendar Revenue Y-axis labels read e.g. `€500`, `€5K`, `€1,2M` — never raw cents like `50000`.
- Calendar Counts Y-axis reads e.g. `150`, `1,5K`.
- Cohort Revenue / Cohort Avg LTV Y-axes read EUR compact.
- LTV Histogram Y-axis reads compact integers.

## Forward pointer

Pass 2 (add subtitles, restructure KPI tiles) and Pass 3 (new-vs-repeat breakdown across LTV / Cohort Revenue / Cohort AvgLTV, LTV re-bin, sticky Y-axis, retention period-0 bug) are tracked separately and explicitly out of scope here.

## Self-Check: PASSED

- [x] Files created: `tests/unit/format.test.ts` — FOUND
- [x] Commits exist:
  - `f569933` — FOUND
  - `af8f546` — FOUND
  - `00a0325` — FOUND
- [x] On correct branch: `dashboard-feedback-overhaul` (verified via `git branch --show-current`)
- [x] No `Co-authored-by: Claude` trailers in any of the 3 commits (verified via `git log --format=%B`)
- [x] All 3 tasks' verification gates passed: unit tests 176/176, svelte-check unchanged.
