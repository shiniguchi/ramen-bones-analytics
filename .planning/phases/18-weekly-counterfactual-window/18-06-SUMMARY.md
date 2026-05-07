---
phase: 18-weekly-counterfactual-window
plan: 06
status: complete
completed: 2026-05-07
commits:
  - eba5000  # Task 1: i18n keys + CampaignUpliftCard wiring
  - 1241dc3  # Task 2: ModelAvailabilityDisclosure_compatibility test
---

# Plan 18-06 SUMMARY — i18n uplift_week_label + bar chart caption/axis keys × 5 locales

## What was built

Three new i18n keys added to all 5 locale blocks (`en`, `ja`, `de`, `es`, `fr`) in
`src/lib/i18n/messages.ts` and wired into `CampaignUpliftCard.svelte`:

| Key | EN | JA |
|-----|----|----|
| `uplift_week_label` | `Week of {start} – {end}` | `{start} – {end} の週` |
| `uplift_bar_chart_caption` | `Weekly revenue lift since campaign launch` | `キャンペーン開始後の週次売上リフト` |
| `uplift_history_x_axis_label` | `Week` | `週` |

`de` / `es` / `fr` blocks got placeholder = EN with `v1.4 polish backlog item filed` comment
per PATTERNS §7 convention. `MessageKey` TypeScript type auto-extended from `en` block —
enforces parity at compile time.

## Wiring

- Hero date label: `t(locale, 'uplift_week_label', { start, end })` using
  `formatHeadlineWeekRange(week, locale).split(' – ')` to extract start/end
- Bar chart caption: `<p data-testid="uplift-bar-chart-caption">` added above x-caption
- X axis label: `<p data-testid="uplift-sparkline-x-caption">` uses `uplift_history_x_axis_label`

## Test results

- `CampaignUpliftCard.test.ts`: 17/17 pass (16 existing + 1 new compatibility test)
- `ModelAvailabilityDisclosure.test.ts`: 6/6 pass (no regression)
- `npm run check`: 0 errors (7 pre-existing TS errors unchanged)

## New test: ModelAvailabilityDisclosure_compatibility

Verifies that the disclosure panel (`uplift-details-trigger` → `uplift-details-panel`) still
opens and renders `dim-point-estimate` + `anticipation-buffer-note` when the payload has both
`weekly_history` rows AND `campaigns[0].rows` (cumulative_since_launch). Back-compat gate
for the Plans 04+05 rewrite. `ModelAvailabilityDisclosure` is NOT embedded inside
`CampaignUpliftCard`'s panel (it lives in CalendarRevenueCard/CalendarCountsCard), so the
smoke assertion tests the panel content directly.

## Drift discovered

None. `FIXTURE_WEEKLY_NORMAL` already had `campaigns[0].rows: [baseHeadlineRow]` with
`window_kind: 'cumulative_since_launch'` from Plan 04 — no fixture augmentation needed.

## Localhost QA

Verified via Playwright mock injection (fetch override + both cache instances cleared):

**JA locale** (Playwright):
- `uplift-week-headline-range`: "5月4日 – 5月10日 の週" — template rendered, no `{start}`/`{end}` leakage
- `uplift-bar-chart-caption`: "キャンペーン開始後の週次売上リフト"
- `uplift-sparkline-x-caption`: "週"
- Bar chart: 3 bars (Apr 20, Apr 27, May 4) rendered, `cf-computing` absent

**EN locale** (unit test line 486-487):
- `uplift-week-headline-range` matches `/May\s+4/` and `/May\s+10/` — 17/17 pass

Visual verification: PASS (JA Playwright + EN unit tests)
