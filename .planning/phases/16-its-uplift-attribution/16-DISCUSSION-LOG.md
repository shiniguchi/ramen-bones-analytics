# Phase 16: ITS Uplift Attribution — Discussion Log

**Date:** 2026-05-01
**Mode:** default + recs-first (per `.claude/memory/feedback_follow_recs_first.md`)
**Outcome:** All 4 gray-area defaults locked without per-question discussion.

---

## Context loaded

- ROADMAP.md Phase 16 entry — 6 success criteria, 7 requirements (UPL-01..07)
- REQUIREMENTS.md UPL-01..UPL-07 (lines 193-199)
- 12-PROPOSAL.md §7 SQL sketches for `campaign_calendar`, `baseline_items_v`, `kpi_daily_with_comparable_v`, `feature_flags`, `campaign_uplift_v`
- 12-PROPOSAL.md §11 honest framing rule + §13 ITS validity assumptions
- 12-CONTEXT.md decisions D-01, D-03, D-12, D-13, D-14
- 14-CONTEXT.md decisions D-04, D-05, D-09, D-12, D-15-D-18
- 15-CONTEXT.md decisions D-08, D-09, D-12, D-13, D-15, D-16, C-12, C-13
- 11-CONTEXT.md D-03 (deferred-API + LazyMount)
- STATE.md milestone position + strategic decisions
- All 14 memory files loaded

## Codebase scout

- `src/routes/api/forecast/+server.ts:163-170` — events array source (currently 4 types; needs `campaign_start` source from `campaign_calendar`)
- `src/routes/api/campaign-uplift/+server.ts` — Phase 15 stub; URL stable through Phase 16 per Phase 15 D-08
- `src/lib/forecastConfig.ts` — single source of `CAMPAIGN_START` literal; Phase 16 retires it via `campaign_calendar` lookup
- `src/lib/components/EventMarker.svelte` — already ships with all 5 marker types including `campaign_start`; auto-renders red 3px line; slotted in both forecast cards
- `src/lib/forecastEventClamp.ts:25` — `campaign_start` priority 5 (highest); progressive disclosure correct
- `src/routes/+page.svelte:286-312` — placement slot for `<CampaignUpliftCard />` between `InvoiceCountForecastCard` and `DailyHeatmapCard`
- `scripts/forecast/run_all.py` + per-model fit modules — extension target for `--track={bau,cf,both}` flag
- `tools/its_validity_audit.py:53` — `NOISE_ITEMS` already filters Pop up menu; D-02's `baseline_items_v` generalizes the same logic
- 6 forecast-related migrations already in place (0050-0057); Phase 16 adds 0058-0063 range

## Domain statement

Ship a single dedicated `CampaignUpliftCard` answering "did the 2026-04-14 campaign work?" via Track-B counterfactual fits on pre-campaign era only, with cumulative `actual − Track-B` per campaign window, 95% Monte Carlo CIs (1000 bootstrap resamples from 200 stored sample paths), and honest "CI overlaps zero" labeling.

## Locks (not discussed)

- `campaign_calendar` schema (12-PROPOSAL §7)
- 7-day anticipation buffer (`TRAIN_END = campaign_start − 7d`)
- `pipeline_runs.fit_train_end` audit column
- `revenue_comparable_eur` baseline-comparable strategy (excludes Onsen EGG / Tantan / Hell beer per ITS audit)
- `forecast_track='cf'` already in schema (Phase 14 migration 0050)
- 5 BAU models get CF counterparts
- RLS / wrapper-view / REVOKE pattern
- "CI overlaps zero" honest labeling
- `EventMarker` already ships with `campaign_start` type (Phase 15)
- All Phase 12-15 carry-forwards (C-01 through C-13)

## Gray areas presented + recommended defaults

### A — CampaignUpliftCard placement & visualization
**Default locked:** Slot between `InvoiceCountForecastCard` and `DailyHeatmapCard`. Hero number + inline cumulative-uplift sparkline (LayerChart Spline + low-opacity Area CI band) + tap-to-pin tooltip explaining 7d anticipation buffer. Mobile-first KISS.
**Why:** Forecast cluster mental model (revenue → tx count → did campaign cause it?). Per-week bars / actual-vs-CF side-by-side are heavier than 375px wants.

### B — EventMarker rollout for campaign markers
**Default locked:** Wire `campaign_start` events into `/api/forecast`'s events array sourced from `campaign_calendar`. Existing `EventMarker.svelte` (already in both forecast cards) auto-picks-up. Do NOT extend into `CalendarRevenueCard` / `CalendarCountsCard`.
**Why:** Phase 15 deliberately kept calendar overlays to forecast lines + CI bands only; EventMarker assumes time-scale forecast card layout. Minimal-change principle.

### C — `revenue_comparable_eur` exposure
**Default locked:** New view `kpi_daily_with_comparable_v` extending `kpi_daily_mv`, backed by `baseline_items_v` (12-PROPOSAL §7 lines 787-825 with `tenant_id → restaurant_id` rename).
**Why:** `kpi_daily_mv` shape is load-bearing for the entire dashboard (immutable contract); the comparable column is a Track-B-only concern; views are cheaper than dedicated MVs at 1-tenant scale.

### D — Off-week reminder mechanism + UX surface
**Default locked:** Introduce `feature_flags` table now per Phase 12 PROPOSAL §7 sketch (Phase 17 extends for backtest gates — no schema regret). 2026-10-15 reminder fires by inserting `pipeline_runs` row with `status='reminder'` AND surfacing as one line in next nightly InsightCard narrative.
**Why:** Banner-on-dashboard too pushy for single-owner UX; pure log invisible. InsightCard pipeline already handles arbitrary text injection (Phase 5). `feature_flags` table is forward-compatible with Phase 17 promotion-gate rows.

## User override gate

Asked once via AskUserQuestion (multiSelect):
- "Which of A/B/C/D do you want to override or discuss further? Leave all unselected to lock the recommended defaults and proceed to CONTEXT.md."

**Response:** Empty multiSelect → all 4 defaults accepted. Proceeded directly to write CONTEXT.md.

## Claude's discretion items (locked)

- Sample-path count for Track-B: 200 (Phase 14 D-04 consistency); 1000-MC-CI satisfied via bootstrap resampling inside `cumulative_uplift.py`
- `counterfactual_fit.py` orchestration: extend `run_all.py` with `--track={bau,cf,both}` flag (KISS)
- Track-B granularity: daily-only fit; sum daily uplift to weekly/monthly windows in `campaign_uplift_v`
- `naive_dow_uplift_eur` UI surfacing: divergence-warning state only (sign disagreement OR >50% magnitude divergence); hidden from card otherwise
- Migration numbering: 0058-0063 range
- Cron schedule: `cumulative_uplift.py` as additional step inside existing `forecast-refresh.yml` weekly workflow (no new cron file)
- New CI Guard 9 (raw-revenue Track-B forbid) + Guard 10 (CAMPAIGN_START literal forbid in `src/`)

## Deferred ideas (carried to backlog)

- Admin form for `campaign_calendar` writes — v1.4
- EventMarker on calendar overlays — future phase if user demand emerges
- Conformal interval calibration for uplift CI — Phase 17
- Rolling-origin CV backtest gate for CF — Phase 17
- BSTS / CausalImpact retro — out of scope (12-PROPOSAL §6 row 10)
- Quarterly auto-rearming of off-week reminder — manual flip until v1.4
- Multi-campaign UI selector — schema-ready; UI deferred until friend runs more campaigns
- Naive-DoW divergence threshold tuning — first-pass; refine after smoke test

---

*Discussion completed in single turn via recs-first style. CONTEXT.md is the canonical record.*
