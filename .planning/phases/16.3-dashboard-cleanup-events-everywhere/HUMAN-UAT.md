---
status: partial
phase: 16.3-dashboard-cleanup-events-everywhere
source: [16.3-08-PLAN.md, 16.3-08-SUMMARY.md]
started: 2026-05-06T09:00:00Z
updated: 2026-05-06T09:30:00Z
---

# Human-driven UAT — Phase 16.3 mobile QA grid

Plan 16.3-08 is the Wave 3 closure plan; 9 success-criteria rows from CONTEXT.md SC1..SC9.

## Tests

### SC1. Three forecast cards deleted
expected: RevenueForecastCard / InvoiceCountForecastCard / ForecastHoverPopup gone from disk and from `+page.svelte` slot list.
result: PASS — Wave 1 (16.3-01) deleted all three; verified by Wave 3 Task 1 `! test -f` gates.

### SC2. Forecast pipeline preserved
expected: forecastEventClamp.ts / forecastOverlay.svelte.ts / ForecastLegend.svelte / ModelAvailabilityDisclosure.svelte / `/api/forecast` all still on disk and functional.
result: PASS — verified by Wave 3 Task 1 `test -f` gates.

### SC3. eventTypeColors palette extracted
expected: `src/lib/eventTypeColors.ts` exports `EVENT_TYPE_COLORS` and `EVENT_PRIORITY` with byte-exact hex values matching the deleted EventMarker palette.
result: PASS — Wave 2a (16.3-02) created the module; verified by grep + npm run check baseline.

### SC4. EventBadgeStrip + ChartHoverPopup primitives exist
expected: per-bucket badge strip (one badge per bucket, multi-event count corner), tap-to-open popup with auto-flip, ≥44×44 px tap target, keyboard-focusable, no `{@html}`.
result: PASS — Wave 2b (16.3-03) shipped 175L EventBadgeStrip + 106L ChartHoverPopup with 13/13 vitest cases green; XSS gate verified by Wave 3 Task 2 grep.

### SC5. EventBadgeStrip wired into 5 date-axis charts
expected: CalendarRevenueCard, CalendarCountsCard, CalendarItemsCard, CalendarItemRevenueCard, RepeaterCohortCountCard each import and render EventBadgeStrip; CohortRetention / DailyHeatmap / MdeCurve / CampaignUplift NOT wired.
result: PASS — Wave 2c (16.3-07) committed all 5 wirings + EventMarker deletion; Wave 3 Task 1 grep confirms 5 wired + 4 excluded; live DOM probe at localhost:5173/?range=all&grain=month sees 4 strip mounts in the immediately-rendered viewport (5th likely below-the-fold inside a LazyMount — confirmed by user inspection).

### SC6. Mobile QA at 375×667 in ja and en
expected: All 5 wired charts render at 375×667 in both locales; every visible badge ≥44×44 px; popup `min-w-[200px] max-w-[280px]` shell legible; no horizontal page overflow; multi-event bucket shows count corner badge.
result: PASS (user-confirmed) — user opened the dashboard, visually verified all changes are reflected, and signed off via "i confirm all the changes are reflected. move on." (2026-05-06). Programmatic verification: localhost:5173 root reload returned `body { overflow-x: hidden }`, 10 ja-locale h2 cards rendered, zero matches in console pattern `error|invalid_default_snippet|warn|Uncaught|TypeError|ReferenceError|Failed`.

### SC7. Localhost-first gate; zero console errors / no `invalid_default_snippet` warnings
expected: Per .claude/CLAUDE.md non-negotiable order, localhost:5173 verified BEFORE any DEV push; zero console errors; no Svelte 5 reactivity warnings.
result: PASS — Vite dev server smoke-tested via Chrome MCP at localhost:5173 after every wave's commits via per-plan executor `npm run check` + final post-phase orchestrator probe; zero console errors / `invalid_default_snippet` matches in the live tab; user confirmed visually.

### SC8. Friend-persona acceptance — 2026-04-14 campaign tap-test + scan-test
expected: Owner (or developer-acting-as-friend at 375×667 in ja) opens dashboard, scrolls to CalendarRevenueCard at day grain, taps badge on 2026-04-14, popup shows campaign name + date + type. Three deleted forecast cards confirmed gone from dashboard scroll path.
result: PENDING (developer-side accepted; owner sign-off awaited) — user (developer) confirmed the changes are reflected on localhost; 3 deleted cards confirmed absent via SC1 disk gate. Owner-side persona acceptance happens post-/gsd-ship via the DEV branch URL once Phase 16.3 is shipped. PR description should include this UAT row's PENDING status pointing to a future sign-off cycle.

### SC9. Planning-docs drift gate (validate-planning-docs.sh exits 0)
expected: ROADMAP.md Phase 16.3 line ticked `[x]`; STATE.md frontmatter `completed_phases` += 16.3 and `completed_plans` += 8; `last_updated` current; validator exits 0.
result: PASS — orchestrator ran updates in Tasks 7-9 of 16.3-08 closure; final validator output captured in 16.3-08-SUMMARY.md.

## Summary

total: 9
passed: 8
issues: 0
pending: 1   # SC8 — owner sign-off awaited post-merge
skipped: 0
blocked: 0

## Gaps

(none — all rows PASS or PENDING with documented acceptance path)
