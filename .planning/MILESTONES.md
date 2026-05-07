# Milestones: Ramen Bones Analytics

*History of shipped milestones. Full phase details in `.planning/milestones/`.*

---

## v1.5 — Cold-Start Trim

**Shipped:** 2026-05-07
**Phases:** 1 (Phase 19) | **Plans:** 4 | **Sessions:** 1 (single-day sprint)
**Branch:** `feature/phase-19-cold-start-trim` | **Commits:** 19 | **Files:** 31 changed (+3,248 / −1,523)

### Delivered

Eliminated the three primary cold-start bundle blockers: (1) `LazyMount loader` prop defers 9 chart-card modules + LayerChart/d3 transitive deps until scroll-into-view; (2) `/api/item-counts` + `/api/benchmark` reduce SSR `Promise.all` from 6 → 3 queries; (3) `messages.ts` 76 KB monolith split into `loadDict()` lazy cache — only `en` (~3.6 KB) ships cold. 30 async chunks in CF Pages build output.

### Key Accomplishments

1. `LazyMount.svelte` extended with `loader` prop — 9 cards converted from snippet-form to dynamic-import deferral
2. `/api/item-counts` + `/api/benchmark` created — both CalendarItems cards share one fetch; benchmark fires alongside retention on scroll
3. `messages.ts` → 5 per-locale dict files with `loadDict()` switch-case (Vite static analysis requirement)
4. SSR `Promise.all` 6→3 (exceeded PERF-02 target of 4)
5. NaN tooltip band rect fix caught in phase-final QA (CalendarCounts/RevenueCard)

### Requirements

| Req | Description | Status |
|-----|-------------|--------|
| PERF-01 | LazyMount dynamic-import deferral | ✅ |
| PERF-02 | SSR Promise.all 6→3 | ✅ (exceeded: 6→3 not 4) |
| PERF-03 | i18n bundle trim | ✅ (76 KB → 3.6 KB) |

**Archive:** `.planning/milestones/v1.5-ROADMAP.md` | `.planning/milestones/v1.5-REQUIREMENTS.md`

---

## v1.4 — Weekly Campaign Read

**Shipped:** 2026-05-07
**Phases:** 1 (Phase 18) | **Plans:** 7 | **Sessions:** 1 (single-day sprint)
**PR:** #31

### Delivered

Replaced `CampaignUpliftCard`'s cumulative-since-launch headline with a per-ISO-week (Mon–Sun) counterfactual answer plus a tap-scrubbable bar-chart history of all completed weeks since campaign launch. Friend-owner now gets "Week of Apr 27 – May 3: −€149" instead of a single decaying cumulative number.

### Key Accomplishments

1. DB: `campaign_uplift.window_kind` extended to `'iso_week'`; `campaign_uplift_weekly_v` wrapper view
2. Pipeline: `compute_iso_week_uplift_rows()` — independent bootstrap CI per 7-day slice (1000 paths, seed 100_000+k)
3. API: `/api/campaign-uplift` returns `weekly_history[]` (backwards-compat with existing `daily[]`)
4. UI: hero "Week of Apr 27 – May 3: −€149"; bar chart with CI whiskers + tap-to-scrub
5. i18n: 3 keys × 5 locales; `ModelAvailabilityDisclosure` compatibility confirmed

**Archive:** `.planning/milestones/v1.4-ROADMAP.md` | `.planning/milestones/v1.4-REQUIREMENTS.md`

---

## v1.3 — External Data & Forecasting Foundation

**Shipped:** 2026-05-06
**Phases:** 9 (Phases 12–17 + 16.1/16.2/16.3) | **PRs:** #17, #22, #26, #28, #29, #30
**Requirements:** 47 (FND-09..11, EXT-01..09, FCS-01..11, FUI-01..09, UPL-01..07, BCK-01..08)

### Delivered

Full external-signal + forecasting stack: 5-source nightly ingest (weather/holidays/school/transit/events), SARIMAX/Prophet/ETS/Theta/Naive 365-day forecasts with 1000-path CI, ITS campaign attribution (Track-B counterfactual + honest "CI overlaps zero" labeling), rolling-origin backtest gate, and event overlay on every date-axis chart.

**Archive:** `.planning/milestones/v1.3-ROADMAP.md` | `.planning/milestones/v1.3-REQUIREMENTS.md`

---

## v1.2 — Dashboard Simplification & Visit Attribution

**Shipped:** 2026-04-21
**Phases:** 4 (Phases 8–11)
**Requirements:** 13 (VA-01..13)

### Delivered

Visit-count attribution model, 7 charts (calendar revenue/counts, retention, LTV histogram, item counts, cohort revenue/LTV), filter simplification (inhouse/takeaway + cash/card), and SSR performance fix (LazyMount + deferred /api/* after CF Worker Error 1102).

---

## v1.1 — Dashboard Redesign (Partial)

**Shipped:** 2026-04-15 (Phases 6–7; Phases 8–11 superseded by v1.2)
**Phases:** 2 complete
**Requirements:** 14

### Delivered

Custom date-range picker, day/week/month toggle, filter foundation; `wl_issuing_country` + `card_type` column promotion.

---

## v1.0 — MVP

**Shipped:** 2026-04-15
**Phases:** 5 (Phases 1–5)
**Requirements:** 39

### Delivered

Multi-tenant schema + auth + RLS, Orderbird CSV ingestion, cohort/LTV/KPI materialized views, SvelteKit mobile dashboard on Cloudflare Pages, Claude Haiku insight card. Shipped to friend.
