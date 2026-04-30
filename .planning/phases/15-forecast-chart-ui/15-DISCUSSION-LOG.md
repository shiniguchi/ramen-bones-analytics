# Phase 15: Forecast Chart UI — Discussion Log

**Date:** 2026-04-30
**Mode:** auto-recs (per `.claude/memory/feedback_follow_recs_first.md`)
**Outcome:** 15-CONTEXT.md with 13 locked decisions + 7 carry-forwards; user redirect window before planning.

## Decision Mode

User has standing instruction "follow your recs first" for decision-heavy workflows. Phase 15's gray areas were locked with inline rationale rather than per-question AskUserQuestion menus. User reviews `15-CONTEXT.md` and pushes back on any lock before `/gsd-plan-phase 15` runs.

## Pre-locked by upstream artifacts (NOT discussed)

These were NOT presented as gray areas — locked by ROADMAP/REQUIREMENTS/Phase 14 CONTEXT:

| Locked decision | Source |
|---|---|
| 5 components to ship (RevenueForecastCard, ForecastLegend, HorizonToggle, ForecastHoverPopup, EventMarker) | Phase 12 PROPOSAL §15 |
| Default visible series = 1 forecast line + naive baseline + CI band | FUI-02 |
| Horizon set 7d / 5w / 4mo / 1yr; default 7d | FUI-03 |
| Endpoint URL paths: `/api/forecast`, `/api/forecast-quality`, `/api/campaign-uplift` | FUI-07 |
| Auth via `locals.safeGetSession()` + `Cache-Control: private, no-store` | FUI-07 + Phase 11 D-03 |
| LazyMount + clientFetch deferred-fetch pattern | FUI-07 + Phase 11 D-03 |
| Hover popup field set: forecast value + 95% CI + horizon + RMSE/MAPE/bias/direction-hit-rate + cumulative deviation + last-refit | FUI-04 |
| Empty-state, stale-data badge, uncalibrated-CI badge | FUI-08 |
| Marker types and visual encoding (campaign-start red, holidays dashed green, school-holiday teal background, recurring yellow, strike red bar) | FUI-05 |
| Localhost:5173 Chrome MCP verification before DEV deploy | FUI-09 + `.claude/CLAUDE.md` localhost-first rule |
| 200 sample paths, server-side resampling | Phase 14 D-04 / D-05 / C-05 |
| Tooltip.Root + `{#snippet children}` Svelte 5 pattern | memory `feedback_svelte5_tooltip_snippet` |
| `touchEvents: 'auto'` default on `<Chart>` wrapper | memory `feedback_layerchart_mobile_scroll` |

## Gray areas presented as recommended-default decisions

| ID | Gray area | Locked decision | One-line rationale |
|---|---|---|---|
| G-01 | Card placement in scroll order | D-01 — slot 6, after InsightCard, before CalendarRevenueCard | Owner mental model: forecast (look-ahead) → calendar (look-back) |
| G-02 | CI band rendering primitive | D-02 — LayerChart `<Area>` with `y0/y1`, 15% fill | Single primitive vs. custom path math |
| G-03 | "Today" reference marker | D-03 — vertical `<Rule>` at startOfDay, gray-500, no label | Without it, actual→forecast transition is unreadable |
| G-04 | Model toggle UX surface | D-04 — horizontal-scroll chip row below chart | Mirrors HorizonToggle; one tap away vs. modal |
| G-05 | Hover popup positioning at 375px | D-05 — floating popup with auto-flip on right-edge overflow | Preserves chart visual locality vs. fixed bottom-sheet |
| G-06 | `/api/forecast` payload shape | D-06 — long-format rows + events array + last_run | Mirrors forecast_daily_mv schema; scales when models added |
| G-07 | `/api/forecast-quality` shape + empty-state | D-07 — filter to `evaluation_window='last_7_days'`; empty array on first 24h | Phase 17 backtest rows excluded; honest empty-state copy |
| G-08 | `/api/campaign-uplift` Phase 15 stub | D-08 — single `cumulative_deviation_eur` using hard-coded `2026-04-14` constant | Endpoint URL stable; Phase 16 swaps backing data |
| G-09 | Event marker data source | D-09 — fold into `/api/forecast` as sibling `events` array | One round-trip per granularity vs. 4 separate endpoints |
| G-10 | Forecast line palette | D-10 — categorical `schemeTableau10[0..4]`; naive=dashed gray-500 | No ranking implied (Phase 17 establishes that) |
| G-11 | Granularity availability per horizon | D-11 — auto-clamp (7d→day; 5w→day/week; 4mo→week/month; 1yr→month) | Mirrors Phase 10 D-17 grain clamp; 365 daily bars unreadable at 375px |
| G-12 | Localhost-first verification gate | D-12 — Chrome MCP localhost:5173 + 2 screenshots + console-log assertions per plan | Stop hook blocks turn-end without it |
| G-13 | Touch events on Chart wrapper | D-13 — default `touchEvents: 'auto'` | `'pan-x'` blocks PC trackpad vertical scroll (memory) |

## Carry-forwards (re-stated for downstream agents)

C-01 deferred-API+LazyMount (Phase 11 D-03) · C-02 server-side resampling (Phase 14 D-04) · C-03 mobile chart defaults (STATE strategic) · C-04 wrapper view only (Phase 1 D-06/07/08) · C-05 localhost-first (CLAUDE.md) · C-06 Tooltip.Root snippet contract (memory) · C-07 touchEvents 'auto' default (memory)

## Deferred to future phases

- Track-B counterfactual + `campaign_calendar` + `CampaignUpliftCard` → Phase 16
- Conformal-calibrated CI for ≥35d horizons → Phase 17 (uncalibrated-CI badge stays until then)
- ≥10% RMSE promotion gate for Chronos/NeuralProphet → Phase 17
- CI grep guard against raw `2026-04-14` literals → Phase 16 (after `campaign_calendar` lands)
- Hourly forecasts, menu-item forecasts, push notifications, CSV export, desktop layout → out of scope per CLAUDE.md / REQUIREMENTS.md

## User redirect window

CONTEXT.md is auto-decided; user reviews before `/gsd-plan-phase 15`. Most-revisable decisions (in order of subjective taste):
1. **D-01 placement** — putting forecast above calendar revenue is opinionated. If owner expects "calendar first, forecast second", flip to slot 7.
2. **D-04 chip row** — bottom-sheet alternative if 375px screen real estate becomes tight.
3. **D-08 hard-coded campaign date** — could defer the `/api/campaign-uplift` endpoint entirely to Phase 16 if user wants cleaner phase boundary; tradeoff is the hover popup loses one of its 6 fields until Phase 16.

## Outcome

Phase 15 ready to plan via `/gsd-plan-phase 15`. Optional `/gsd-ui-phase 15` for UI-SPEC.md design contract first (ROADMAP "UI hint: yes").
