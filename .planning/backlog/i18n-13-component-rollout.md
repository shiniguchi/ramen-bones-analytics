---
type: backlog
captured: 2026-05-04
source: Phase 16 wave 4 close — owner Chrome MCP localhost review
target_phase: resume `feature/i18n-and-ux-260422` OR v1.4 polish
priority: medium
status: captured
---

# Finish i18n rollout — 13 components still untranslated

Owner feedback (2026-05-04):

> "why don't you align the languages?"

## Context

Per `.claude/memory/project_i18n_rollout_260422.md` (2026-04-22):

> i18n rollout status (branch `feature/i18n-and-ux-260422`, 2026-04-22) — static UI scaffold + multi-locale Haiku pipeline (migrations 0037/0038) landed; DEV push + regen + 13 remaining components outstanding

The dashboard currently shows mixed Japanese + English copy:

- **Japanese (already wired through `t(page.data.locale, ...)`):** filter chips (全期間, 日/週/月), insight card (先週の売上は前週比11%増加), KPI tile labels (売上 · 全期間, 取引件数 · 全期間), calendar-counts/revenue titles (期間別取引件数 — 来店回数別 / 期間別売上 — 来店回数別), cohort retention copy
- **English (untranslated, hardcoded):** "Revenue forecast" heading + "Tomorrow through next year — actuals vs. SARIMAX BAU." subtitle + "取引件数の予測" mixed lookalike, **CampaignUpliftCard** entirely English ("Did the Apr 14, 2026 campaign work?", "CI overlaps zero — no detectable lift", "Counterfactual fits on data ≥7 days before the campaign start"), forecast model legend chips (SARIMAX, Prophet, ETS, Theta, Naive (DoW), Chronos, NeuralProphet), event-marker tooltips (if any)

## What needs to happen

1. Identify the 13 remaining components (audit `t(page.data.locale, ...)` coverage vs hardcoded English strings)
2. Add message keys for each English string to `src/lib/i18n/messages.ts`
3. Run the multi-locale Haiku translation pipeline (migrations 0037/0038 already shipped)
4. Wire each component through `t(...)`
5. Localhost Chrome MCP verification at 375×667 in both `ja` and `en` locales

## Acceptance

- All UI copy on the main dashboard renders in the user's selected locale
- No mixed Japanese + English on a single screen
- CampaignUpliftCard renders Japanese copy when locale=ja (the headline "CI overlaps zero — no detectable lift" needs particularly careful Japanese phrasing — see also `campaign-uplift-card-plain-language.md` backlog)

## Source

Branch `feature/i18n-and-ux-260422` (current state per memory). Re-base on top of feature/phase-16-its-uplift-attribution after Phase 16 ships, then resume the rollout.
