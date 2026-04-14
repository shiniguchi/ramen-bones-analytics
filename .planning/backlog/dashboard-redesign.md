---
type: backlog
captured: 2026-04-15
source: Phase 4 iPhone UAT walkthrough feedback (owner)
target_phase: new milestone after v1.0 — "Dashboard Redesign"
status: captured
---

# Dashboard Redesign — owner feedback (verbatim)

Captured during Phase 4 closeout. This is a direction change, not a Phase 4 fix. Treat as input for `/gsd:discuss-phase` on a new phase after v1.0 ships.

## Raw feedback

1. **Drop-down date range filter** — replace the 5 fixed chips with a dropdown. Consider custom range support.

2. **Global data-granularity selector** — day / week / month applied across all cards, not just the cohort chart.

3. **Charts over KPI tiles** — fewer "big number" panels, more time-series visualisations:
   - First-acquisition-date cohort customer count (new customers acquired per period)
   - User count split by **first-timer vs repeater**, with repeaters broken down by visit count (attribution stack)
   - Same split, by **revenue sum**
   - Same split, by **revenue avg ticket**
   - **Retention curve per cohort** — both weekly AND monthly views

4. **Visit frequency card needs more detail**
   - Surface **when** repeat visitors came back (inter-visit timing distribution, or return-day histogram)
   - May overlap with #3.2 (repeater attribution with visit count)

5. **Brainstorm other interesting totals/attributions** — owner is open to suggestions. Starter ideas:
   - Revenue by weekday × hour (heatmap) — finds dead hours
   - Ticket-size distribution (histogram) — small/medium/large bands
   - Item-mix Pareto (top sellers) if POS line-items are available
   - Seasonality curve (weekly totals over all history)
   - Party-size vs avg-ticket scatter (if covers data exists)
   - New-customer acquisition source, if tagged
   - Weekend vs weekday revenue split
   - Cohort LTV trajectory (cohort-segmented LTV curve)

## Constraints to preserve

- Mobile-first at 375px (same as v1.0)
- Daily refresh (same pg_cron cadence)
- Free-tier budget (same)
- Multi-tenant RLS still applies
- **Must not regress existing Phase 4 invariants**: D-19a (chip-scoped vs chip-independent card split), freshness signal, zero console errors

## Known bugs to fix as part of this redesign

(From Phase 4 UAT walkthrough — see 04-VERIFICATION.md gaps E and F)

- **NVR card always empty** — "No sales recorded in this window" on every range, including `range=all` with 6,842 transactions present. Likely bad query or wrong empty-state trigger in `NewVsReturningCard.svelte` / loader.
- **LTV chart only shows 3 weeks of bars** (2026-03-09 / 03-16 / 03-23) on `range=all` despite "Based on 10 months of history" caveat. Likely `ltv_mv` is sparse or the chart truncates its window.

## Next steps

After v1.0 ships to the friend (Phase 4 + Phase 5 Insights complete):
1. `/gsd:new-milestone` (v1.1 — Dashboard Redesign)
2. `/gsd:discuss-phase` with this file as input
3. `/gsd:plan-phase` → `/gsd:execute-phase`
