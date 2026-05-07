---
phase: 18-weekly-counterfactual-window
plan: 07
status: complete
completed: 2026-05-07
---

# Plan 18-07 Summary: Phase-Final QA + Planning-Docs Drift Gate

## QA Results (6 rounds, all PASS)

| Round | Check | Result |
|-------|-------|--------|
| A | Schema: iso_week in CHECK, weekly_v exists, 5 models × 2 weeks | ✅ PASS |
| B | API: weekly_history non-empty, sarimax −€149.04 (spec ≈ −€149 ± €10) | ✅ PASS (±€0.04) |
| C | Hero "Week of 4月27日 – 5月3日" (not "Since April 14th"), MAD 28 pills | ✅ PASS |
| D | 2 bars, CI whiskers, gray (CI straddles 0), baseline legend | ✅ PASS |
| E | Tap bar 1 → hero switches Apr 27 → Apr 20 week | ✅ PASS |
| F | touchEvents:'auto' at line 350, page scrolls with chart in view | ✅ PASS |

## Bootstrap Spot-Check

sarimax `point_eur` for `iso_week_end = 2026-05-03`: **−€149.04**
Spec: ≈ −€149 ± €10. Delta: **€0.04** ✅

## Bug Found and Fixed During QA

**Overflow bleed (fb97843):** Tailwind `overflow-hidden` class was silently overridden by LayerChart's internal CSS (`overflow: visible` on `lc-layout-svg`). CI whiskers spanning −€2,159 to +€2,399 on a 100px chart bled ~1,600px above the container, visually overlapping the card title and other dashboard cards. Fixed by replacing the Tailwind class with `style:overflow="hidden"` (inline style wins over component-scoped CSS).

## Planning Docs

- STATE.md frontmatter: total_phases=21, completed_phases=21, total_plans=123, completed_plans=111, percent=90
- ROADMAP.md Phase 18 row: [x] 7/7 Complete 2026-05-07
- `validate-planning-docs.sh`: ✅ exit 0

## UPL-08 / UPL-09 Sign-Off

All 6 ROADMAP success criteria for Phase 18 satisfied. UPL-08 ✅ UPL-09 ✅

## Lessons Learned

1. LayerChart component-scoped CSS overrides Tailwind utilities on the same element — always use `style:prop` directives for overflow/clip on chart containers.
2. CI whisker bounds should be clamped to yDomain or container must hard-clip; unbounded CI SVG lines on a small chart are a reliable source of layout bugs.
