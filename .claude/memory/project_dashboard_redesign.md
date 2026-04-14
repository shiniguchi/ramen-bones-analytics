---
name: Dashboard redesign direction (post-v1.0)
description: Owner wants a chart-heavy redesign after v1.0 — dropdown date filter, global grain selector, attribution charts, per-cohort retention
type: project
---

Owner signalled a post-v1.0 dashboard redesign during Phase 4 UAT walkthrough on 2026-04-15. The v1.0 chip-bar + KPI-tile layout is a stepping stone, not the endpoint.

**What the redesign wants** (captured verbatim in `.planning/backlog/dashboard-redesign.md`):
- Dropdown date range filter replacing the 5 fixed chips
- Global day/week/month grain selector applied across all cards (not just cohort)
- Replace most KPI tiles with time-series charts: cohort customer count, first-timer-vs-repeater attribution by user count + revenue sum + revenue avg, per-cohort retention (weekly + monthly)
- Richer visit-frequency card with return-timing breakdown
- Brainstorm additional aggregations (weekday × hour heatmap, seasonality, item mix, etc.)

**Why:** Phase 4 delivered a working mobile reader but the owner's feedback during UAT shifted the mental model from "snapshot KPIs" to "visual attribution trends". Plain number tiles don't answer the questions the owner actually wants to ask.

**How to apply:**
- Do NOT patch this into v1.0 — ship v1.0 first, capture user reaction, then run `/gsd:new-milestone` (v1.1 Dashboard Redesign) after Phase 5 Insights & Forkability
- When planning v1.1, read `.planning/backlog/dashboard-redesign.md` as the requirements source
- Gaps E (NVR empty) and F (LTV sparse) from 04-VERIFICATION.md should be fixed inside the redesign, not as isolated patches — their fixes will likely be superseded by the new chart structure
- Preserve all v1.0 invariants: mobile-first 375px, daily refresh, free-tier, multi-tenant RLS, zero console errors
