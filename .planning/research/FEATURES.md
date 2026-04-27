# Feature Landscape — v1.3 External Data & Forecasting Foundation

**Domain:** SMB-restaurant POS analytics adding multi-horizon forecasting + interrupted-time-series campaign-uplift attribution on a mobile-first dashboard (Berlin ramen shop, 10 months of pre-campaign daily history, single tenant, $0/mo budget).
**Researched:** 2026-04-27
**Mode:** Ecosystem (subsequent milestone — features layered on existing v1.0–v1.2 dashboard)
**Confidence:** HIGH for table-stakes/anti-features (well-aligned with the 1484-line proposal that already verified data sources, schemas, and patterns); MEDIUM for differentiator polish-level UX patterns.

> **Existing surface (do NOT re-research):** 12-card mobile dashboard at 375px (revenue calendar with 1st/2nd/3rd/4x+ stacked bars, customer-counts calendar, retention curve, LTV histogram, cohort revenue, cohort avg LTV, item counts, KPI tiles), filter bar (inhouse/takeaway × cash/card × custom date range × day/week/month granularity), Supabase Auth + RLS + JWT-claim tenant scoping, nightly Claude Haiku insight card, Playwright Orderbird CSV ingest on GHA cron, MV refresh via `pg_cron` with `REFRESH MATERIALIZED VIEW CONCURRENTLY`.

---

## Table Stakes

Features the friend-owner expects. Missing = product is "still toy / experimental, not credible." All of these MUST ship in v1.3.

| # | Feature | Why expected (1-line for SMB owner) | Complexity | Existing dependency |
|---|---|---|---|---|
| TS-1 | **Forecast line on revenue chart** with actual line + multi-horizon SARIMAX prediction (+7d / +35d / +120d / +365d) | "Show me what next week looks like" — the basic ask the dashboard couldn't answer in v1.2 | Med | Existing `revenue_eur` MV (kpi_daily_mv) + new `forecast_daily` table |
| TS-2 | **95% confidence interval band** drawn as semi-transparent shading around the forecast line | A naked forecast line lies; the band tells her how much to trust each day | Med | LayerChart already in stack (shadcn-svelte / Tailwind v4) |
| TS-3 | **Naive same-DoW baseline as a sanity floor** (always rendered, dotted gray) | If SARIMAX can't beat "average of last 4 same-weekdays," the model has no business being there | Low | Pure rolling-window SQL, no ML |
| TS-4 | **Last-refit timestamp** visible somewhere on the card ("Last refit: 2026-04-26 03:01 UTC") | Trust-anchor: she can see the model isn't stale | Low | `pipeline_runs` audit table |
| TS-5 | **Last-7-actual-days accuracy** in the hover popup: RMSE, MAPE, bias, direction-hit-rate | This is how the friend judges "is this number believable?" — recent, scrollable, freshness ≤24h | Med | New `forecast_quality` table (already in §17 spec) |
| TS-6 | **Backtest gate (block-deploy-on-regression)** — rolling-origin CV at 4 horizons, ≥10% RMSE improvement vs naive required | Without this, every refit is a coin-flip on whether the chart got worse | Med | GHA scheduled job + `forecast_quality.evaluation_window='rolling_origin_cv'` |
| TS-7 | **Horizon toggle chips** (7d / 5w / 4mo / 1yr) in top-right of card; X-axis re-zooms | Same data, different time slice — restaurants think in weeks for ops, months for staffing, year for growth | Low | LayerChart x-domain prop |
| TS-8 | **Daily 03:00 Berlin refit** of all production models with status surfaced if a fit fails | Daily refresh cadence matches the existing pipeline; if it silently breaks, dashboard becomes a gravestone | Med | Extends existing `pg_cron` + GHA pattern |
| TS-9 | **External data ingest: Open-Meteo weather + Berlin holidays + school holidays** persisted to dedicated tables | Without weather + holiday regressors, forecasts will systematically miss every rainy Tuesday and Easter Monday | Med | New tables (`weather_daily`, `holidays`, `school_holidays`) — schemas already in §7 |
| TS-10 | **Campaign calendar admin** — at minimum a Supabase Studio SQL seed; ideally a tiny `CampaignAdminForm.svelte` | Without it, "did the campaign work?" has no campaign-window definition to answer against | Low | New `campaign_calendar` table |
| TS-11 | **Cumulative uplift since campaign launch** displayed as a single number with 95% MC CI: `actual − Track-B = +€420 (95% CI -€180 to +€1,020)` | This is the headline answer the friend started the campaign to learn — must be trivially findable | Med | `campaign_uplift_v` over Track-B counterfactual fit on pre-campaign era only |
| TS-12 | **Granularity toggle (day/week/month)** that resamples 1000-path forecast samples and re-derives CI percentiles correctly | Existing dashboard already has this toggle on every other chart; forecast must respect it; naive `Σ daily upper` overstates weekly CI by ~√7 | High | Extends existing granularity toggle (VA-12); requires `forecast_daily.yhat_samples` jsonb column |
| TS-13 | **"Forecast unavailable / pending"** empty-state when a fit fails or the 365d horizon has <2yr history | Trust-destroyer to show a fake number; pattern matches existing UI-10 sparse-data handling | Low | LayerChart + Svelte 5 conditional render |
| TS-14 | **Honest causal labeling** — only label the number "uplift" if Track-B was fit on pre-campaign era only; otherwise label "deviation from forecast" | If we lie about causality, the friend makes a wrong decision and the product loses credibility forever | Low | Schema enforcement: `forecast_daily.forecast_track='cf'` rows must have `pipeline_runs.fit_train_end < campaign_start_date` |
| TS-15 | **Last-7-days backtest cold-start UX** — UI shows "BACKTEST PENDING — gathering 7 days of evidence" until day 8 | Day-1 deploy with empty popup looks broken; explicit pending state honors §17 mechanic | Low | Conditional render on `forecast_quality` row count |

**Why this matters for an SMB restaurant owner:** Each row above is the difference between "I can make a staffing/ordering decision from this number" and "I'm guessing based on a chart whose math I don't trust."

---

## Differentiators

Features that set the product apart from generic POS-analytics dashboards (Toast, Lineup.ai, Restaurant365). Not strictly required for credibility, but each one is a "wow, my-data-team-built-this-for-me" moment.

| # | Feature | Value proposition | Complexity | Dependency / risk |
|---|---|---|---|---|
| D-1 | **Multi-method overlay toggle** (Prophet, Chronos zero-shot, NeuralProphet, ensemble median as legend chips, off by default) | Power-user intuition: "do all four models agree this Saturday will be slow, or only SARIMAX?" Disagreement is information | Med | LayerChart series toggle; mobile default = SARIMAX only (avoid spaghetti) |
| D-2 | **ITS counterfactual visualization on the chart** — Track-B dashed line during campaign window; gap to actual shaded green/red | Banking-grade causal-inference UX in a phone dashboard. Nothing in the restaurant POS market shows this. | High | Two-track architecture (§13); requires honest-labeling discipline TS-14 |
| D-3 | **Conformal CI bands at long horizons (35d/120d/365d)** | Standard SARIMAX CIs are wrong at +120d (anti-conservative). Conformal wrapping makes the band trustworthy for staffing-month decisions | Med | `statsforecast` lib; Tier C in §5 — gate behind backtest improvement |
| D-4 | **Event annotation markers** — vertical lines/shading for: campaign starts (red), federal holidays (green dashed), school holidays (teal shaded blocks), recurring events (yellow), BVG strike days (red bar) | "Why was last Wednesday weird?" answered visually without scrolling docs | Med | Already specced in §22; data tables already in TS-9 |
| D-5 | **Hover popup with per-horizon accuracy breakdown** — 6 fields (forecast value, 95% CI, horizon, last-7 accuracy, cum. deviation, last-refit) | One-tap diagnostic that no Tableau Pulse / Datadog forecast widget surfaces this densely on mobile | Med | §17 spec |
| D-6 | **"Did the campaign work?" answer surface** — a single dedicated `CampaignUpliftCard.svelte` separate from the forecast chart, headline number + CI + sparkline | Mode/Hex/Datadog all force you to read a chart to answer this; a card-as-headline answers it instantly | Low | `campaign_uplift_v` |
| D-7 | **Direction-hit-rate metric** ("model moved same direction as actual on 6 of 7 days") | More intuitive to a non-technical owner than RMSE alone; she trusts directional consistency | Low | Already in §17 |
| D-8 | **Bias-aware accuracy display** ("Bias +€42 — slightly over-forecasts") | Owners weight forecasts mentally; knowing the bias direction is more useful than the magnitude alone | Low | Already in §17 |
| D-9 | **Track-A / Track-B accuracy honesty** — Track-B accuracy slot displays "unverifiable by construction" instead of a fake RMSE | Anti-bullshit signal; signals the product is built by someone who knows ITS limits | Low | UI conditional, no DB cost |
| D-10 | **Foundation-model line (Chronos-Bolt-Tiny zero-shot)** as a free toggle | Zero-fit-cost reality check from a 2026-class Hugging Face model; useful when classical models disagree | Low | `chronos-forecasting` lib; HF inference at ingest time, ~7s for 7-day eval |
| D-11 | **Forecast accuracy panel / "model trust" page** — drill-down per model showing 12-fold RMSE, 4 horizons, win/loss vs naive, last 90d MAPE trend | Optional power-user surface for the owner's data-curious friends/advisors; not on the main dashboard | Med | `forecast_quality` already populated by §16 |
| D-12 | **Closed-day awareness** — calendar respects shop opening hours (`shop_calendar.is_open`); closed days are NaN not 0 in the forecast | Non-trivial for restaurants — Mondays often closed; competitor tools mishandle this and bias seasonality | Med | `shop_calendar` table (§15) |
| D-13 | **Audit trail for every refit** — `pipeline_runs.fit_train_end` lets the owner verify Track-B never saw campaign-era data | Forkers / regulators / paranoid analysts can prove the causal claim is honest | Low | Single audit column, already in §13 |
| D-14 | **Quarterly off-week reminder** (~October 2026, 6 months post-launch) — surfaces a banner: "Run a 1-week off-campaign window to re-anchor counterfactual?" | ITS validity decays with horizon; this discipline-as-product reminder keeps the model honest | Low | Reminders table (§15); Claude Haiku can surface in nightly insight |
| D-15 | **`revenue_comparable_eur` KPI** (raw revenue minus post-launch new-menu-item revenue) used for ITS attribution | Auto-derived from `baseline_items_v`; closes the "she added Onsen Egg + Tantan + Hell beer at the same time" confound automatically | Med | `baseline_items_v` view (§13); 7-day buffer rule for first-seen items |
| D-16 | **Mobile bottom-sheet legend with tap-to-pin tooltip** | LayerChart hover-on-touch UX; pin a date to read full popup without finger-occlusion | Med | LayerChart Tooltip.Root + Svelte 5 snippet (per memory `feedback_svelte5_tooltip_snippet`) |
| D-17 | **Granularity-aware sample-path resampling** (sum daily samples to weekly, take percentiles) | Week/month CIs are correct, not sqrt-N approximated. Few competitor tools get this right. | High | TS-12 implementation; jsonb storage of 1000-sample paths |
| D-18 | **In-narrative insight integration** — nightly Claude Haiku card mentions forecast confidence/uplift status when material | Existing INS-01 pipeline gets richer context; "your campaign is +€420 ahead of forecast at 95% confidence" reads naturally | Low | Extend existing nightly insight job to read `forecast_quality` + `campaign_uplift_v` |

---

## Anti-Features

Features the team will be tempted to add but should NOT in v1.3. Each has explicit reasoning to revisit later.

| # | Anti-feature | Why avoid in v1.3 | What to do instead | Revisit when |
|---|---|---|---|---|
| AF-1 | **Real-time / hourly forecasting** | Existing pipeline is daily; intraday adds webhook complexity + Orderbird API approval; 99% of staffing decisions are made the day before | Daily 03:00 Berlin refit; nightly accuracy roll-up | ISV Partner API approved AND owner explicitly asks |
| AF-2 | **Item-level demand forecasting** ("forecast Tantan ramen sales for Saturday") | 30+ menu items × 7 horizons × 7 models = 1500+ models nightly; sparse per-item history; Prophet ghosts; not part of the campaign-attribution question | Forecast aggregate revenue/invoices only | Once owner asks for inventory-purchase recommendations AND has ≥18 months per-item history |
| AF-3 | **Full Marketing Mix Model (PyMC-Marketing / Robyn / Meridian)** | MMM needs 3+ marketing channels with spend; the friend has 1 channel (Instagram) and no spend tracking; would be statistical theater | ITS counterfactual on pre-campaign era — single-intervention causal — exactly the right tool for 1 channel | v1.4+ when 2+ paid channels exist with documented spend |
| AF-4 | **Automated price recommendations** ("raise Tantan to €15.50") | Out of milestone scope; requires elasticity model + per-item demand (AF-2) + competitor data; high-stakes wrong answer risk | Surface aggregate trend; let owner price | Year 2+ with multi-shop benchmarks |
| AF-5 | **Customer churn predictions** ("this card_hash will not return")  | Existing v1.2 retention curve already shows aggregate churn behavior; per-customer churn prediction needs more behavioral features (time-of-day patterns, item preferences) and verges on creepy | Surface cohort retention rates and at-risk-cohort flag (ADV-02 in v2 list) | Owner asks for at-risk lists AND consents to per-customer modeling |
| AF-6 | **Deep-learning forecasters (DeepAR / TFT / N-BEATS / PatchTST)** | All require ≥2 years multi-series; this shop has 10 months single-series; would underperform SARIMAX while taking 100× compute | SARIMAX + Prophet + Chronos zero-shot covers the model-diversity argument | ≥2 years of data AND multi-shop deployment |
| AF-7 | **Multi-channel attribution (1st-touch / last-touch / Markov / Shapley)** | Requires per-customer touchpoint data which we don't collect (card hash only, no marketing-channel-id at POS) | ITS aggregate attribution is the right tool given the data | Owner integrates with email/SMS provider with attribution IDs |
| AF-8 | **Yearly seasonality in Prophet** | Only 10 months of data — Prophet will fit ghosts (random correlations interpreted as annual cycles); will degrade backtest | `yearly_seasonality=False` + manual changepoints | ≥2 full years available |
| AF-9 | **Showing 5+ forecast lines on mobile by default** | 375px screen + 5 lines + CI band = unreadable spaghetti | Mobile default: actual + SARIMAX BAU + CI band only; rest opt-in via legend | Never on phones; desktop-only acceptable |
| AF-10 | **365d forecast accuracy claims** | <2 years history; the standard 365d-horizon RMSE is structurally unreliable | Show forecast line; replace accuracy with "BACKTEST PENDING — uncalibrated" badge | ≥2 years history |
| AF-11 | **Track-B forecast accuracy claims past campaign-start cutoff** | Structurally unverifiable — there is no actual for "no-campaign world" once campaigns started | Display "unverifiable by construction" in popup accuracy slot | Never (definition-bound) |
| AF-12 | **Live event scraping (Berlin events, scraping ticketing sites)** | Hand-curated YAML for 1 shop is sufficient; live scraping = brittle pipeline + ToS risk | Hand-curated YAML in repo (§6 seed) | Multi-tenant scale (50+ shops) when manual maintenance breaks down |
| AF-13 | **Customer-holdout A/B test** | Instagram channel has no per-follower exclusion mechanism; not technically possible | ITS counterfactual on pre-campaign era — exactly why it was chosen | Never for this channel; possible if owner adds email/SMS with audience IDs |
| AF-14 | **Treating "Pop-up menu" specials as a regressor** | Friend confirmed they're stochastic ad-hoc; modeling them as structural breaks would over-fit on noise | Let the model absorb them as residual noise | Never for ad-hoc specials |
| AF-15 | **Direct browser → Anthropic API call for forecast narration** | Leaks API key; existing INS-01 already correctly routes via Edge Function | Edge Function reads forecast tables, sends to Claude Haiku, writes narrative to `insights` | Never |
| AF-16 | **Customizable / drag-and-drop forecast widget builder** | Already in v1 anti-feature list ("Customizable dashboard") — non-technical user, confusion risk | Hardcoded card layout per phase plans | Multi-tenant v2+ if validated |
| AF-17 | **CSV / PDF export of forecast data** | Owner won't re-analyze in Excel; phone is the delivery vehicle (per existing v1 anti-feature) | Phone-readable card on dashboard | Never (consistent with v1 stance) |
| AF-18 | **Push notifications for "campaign is winning/losing"** | v1 is pull-based by design; signal-to-noise of daily fluctuations would train her to ignore them | Static dashboard card + nightly Claude Haiku narrative | If validated by repeat owner request |
| AF-19 | **Per-customer feature engineering for forecasting** (e.g., "incorporate cohort-12-week retention rate as a feature") | Adds dependencies between MVs; causal model becomes harder to interpret; current SARIMAX + weather + holidays is already the strong baseline | Aggregate features only | When backtest plateaus and a clear hypothesis emerges |
| AF-20 | **Counterfactual model that includes any campaign-era data** | Breaks the ITS causal claim — would no longer be uplift, just deviation from forecast | Track-B fits on `date < campaign_start_date` only; enforced via `pipeline_runs.fit_train_end` audit | Never (definition-bound) |

---

## Mobile UX Patterns — Forecast Charts at 375px

How industry tools (Tableau Pulse, Datadog, Mode, Hex, Streamlit) handle each forecast UI element, and the recommendation for v1.3.

### Forecast line + actual line + uncertainty band

- **Tableau Pulse (2025.2):** Single combined line chart per metric; forecast section auto-distinguished via a legend label; goal-aware coloring (green if hitting goal, red if missing). Confidence band rendered as a lighter shade of the forecast color. ([Tableau Pulse Forecasting](https://www.tableau.com/blog/top-new-tableau-pulse-feature-releases-know))
- **Datadog Forecasts Monitor:** Gray uncertainty band, configurable bound width (1σ/2σ/3σ). Forecast line dashed; actual solid; vertical "now" marker. Tooltip on hover shows the bound interval. ([Datadog Forecasts](https://www.datadoghq.com/blog/forecasts-datadog/))
- **Standard pattern (UX for AI / fan charts):** Solid line for actual, dashed line for forecast, shaded fan for CI, vertical "now" line as `you-are-here` marker. ([UX for AI — Forecasting](https://uxforai.com/p/forecasting-with-line-graphs))
- **v1.3 recommendation:** Per §22 — actual = solid black, SARIMAX = solid blue, CI = light blue shade, naive = dotted gray. Vertical `today` line. Mobile default: 3 things only (actual + SARIMAX + CI). Matches industry convention.

### Multi-method overlay toggle

- **Tableau Pulse:** No explicit multi-method overlay; uses one model (Ridge/Holt-Winters auto-selected).
- **Datadog:** Single algorithm per query; users add additional queries to compare.
- **Hex / Mode notebooks:** Code-level overlays; not a UX pattern, dev-controlled.
- **v1.3 recommendation:** Bottom-sheet legend with chip toggles (Prophet, Chronos, NeuralProphet, ensemble). Default OFF on mobile to prevent spaghetti. Per memory `feedback_layerchart_mobile_scroll`, set `touchEvents: 'auto'` so vertical scroll works while horizontal pan does too.

### Horizon selector (7d / 30d / quarter / year)

- **Tableau Pulse:** Period-to-date implicit (current period auto-derived); no explicit horizon chips.
- **Datadog:** Time-range picker controls both past and future window; no decoupled horizon.
- **Mode / Hex:** Custom per-dashboard.
- **v1.3 recommendation:** Top-right chips (7d / 5w / 4mo / 1yr) per §22. Same forecast data, different X-axis slice. Default 7d. Distinct from existing date-range filter (which filters historical actuals); horizon is forecast-window-only. **Gap risk:** the existing FLT-01 custom date-range picker may visually overlap with the horizon chips on 375px — design must clearly separate "show me history from X to Y" vs "forecast me forward N days."

### Event annotation markers

- **Datadog:** Built-in event overlay; vertical line + tooltip on hover; tagged events from notebooks/monitors.
- **Tableau:** Reference lines on continuous axis; user-defined.
- **Standard fan-chart pattern (BIS):** Vertical lines for known interventions; shaded blocks for windows. ([BIS — Fan Charts](https://www.bis.org/ifc/events/ifc_8thconf/ifc_8thconf_62pap.pdf))
- **v1.3 recommendation:** Per §22 — campaign starts (red solid), federal holidays (green dashed), school holidays (teal shaded block, semi-transparent), recurring events (yellow dashed), BVG strike (red solid bar). On mobile: campaign starts ON by default; rest OFF, toggleable in legend bottom-sheet. Tap-to-pin tooltip on each marker showing event name + impact estimate.

### "Did the campaign work?" answer surface

- **Adsquare / generic attribution dashboards:** Net-visitation-uplift card with control vs exposed comparison; usually a single headline number ("Campaign drove +18% incremental visits"). ([Adsquare Attribution](https://adsquare.com/inside-adsquares-attribution-dashboard/))
- **Causality engine ITS guides:** Two-panel — pre-period trend extrapolated as counterfactual line, intervention point marked, gap shaded. ([Causality Engine — ITS](https://www.causalityengine.ai/glossary/interrupted-time-series))
- **v1.3 recommendation:** Dedicated `CampaignUpliftCard.svelte` separate from the forecast card — single headline number with 95% CI, 1-line plain-language interpretation ("Campaign is +€420 ahead of forecast — 95% CI does not cross zero, signal is real"). Drill-down panel shows the ITS chart (Track-B dashed line + actual + shaded gap). Don't bury this answer inside the multi-line forecast chart — it's a different question.

### Hover tooltip showing per-horizon accuracy

- **Datadog:** Tooltip shows current value + bound width (numeric).
- **Tableau Pulse:** Tooltip shows forecast value, period, goal-attainment status.
- **None of the surveyed competitors show backtest-RMSE-by-horizon in the tooltip.** This is genuinely differentiated UX (D-5).
- **v1.3 recommendation:** §17's 6-field popup — forecast value, 95% CI, horizon, last-7-actual-days RMSE/MAPE/bias/direction-hit-rate, cum. deviation since launch, last-refit timestamp. Tap-to-pin on mobile (per `feedback_svelte5_tooltip_snippet` memory: must use `{#snippet children}` not `let:data` on Svelte 5 LayerChart Tooltip.Root, else runtime error).

---

## Feature Dependencies

```
External-data ingest (TS-9)  ─────────┐
                                       ├──► SARIMAX/Prophet exog regressors ──► TS-1, TS-2
Existing kpi_daily_mv ─────────────────┤
                                       └──► Naive baseline (TS-3)

forecast_daily table (TS-1)  ──► forecast_quality (TS-5, D-7, D-8)
                              ──► sample-path resampling (TS-12, D-17)
                              ──► campaign_uplift_v (TS-11) ──► CampaignUpliftCard (D-6)

campaign_calendar (TS-10) ────► Track-B fit cutoff (TS-14, D-13) ──► ITS counterfactual (D-2)

forecast_daily + forecast_quality ──► hover popup (D-5)
                                  ──► backtest gate (TS-6)
                                  ──► nightly insight extension (D-18)

shop_calendar (D-12) ──► closed-day NaN handling ──► all forecast fits (TS-1)

baseline_items_v ──► revenue_comparable_eur (D-15) ──► honest ITS (TS-14)
```

**Critical path for "did the campaign work?" answer:**
TS-9 (weather/holidays) → TS-10 (campaign calendar) → D-15 (revenue_comparable_eur) → TS-14 (Track-B cutoff discipline) → TS-11 (cumulative uplift) → D-6 (CampaignUpliftCard).

Skip any node and the answer is either wrong (skip TS-14, D-15) or unanswerable (skip TS-10, TS-11).

---

## MVP Recommendation (in-milestone scope-cut order)

If the milestone runs out of time, ship in this order:

1. **TS-9** — External data ingestion (weather + holidays + school) — nothing else works without it
2. **TS-1, TS-2, TS-3, TS-7, TS-8** — SARIMAX BAU forecast + CI band + naive baseline + horizon toggle + nightly refit (the "show me next week" core)
3. **TS-13, TS-15** — Empty-state and cold-start UX so the day-1 deploy looks honest
4. **TS-10, TS-14, TS-11, D-6, D-15** — Campaign calendar + Track-B + cumulative uplift + dedicated card + revenue_comparable_eur (the "did it work?" answer the friend specifically needs)
5. **TS-5, D-5, D-7, D-8, D-9** — Last-7 accuracy + hover popup + bias/direction display + Track-B unverifiable honesty (trust layer)
6. **TS-4, TS-6, TS-12, D-13, D-17** — Last-refit display + backtest gate + granularity-aware resampling + audit trail (rigor layer)
7. **D-1, D-2, D-4, D-12** — Multi-method toggles + ITS visualization + event markers + closed-day awareness (richness)
8. **D-3, D-10, D-11, D-14, D-16, D-18** — Conformal CIs + Chronos + accuracy panel + quarterly off-week reminder + bottom-sheet pin + insight integration (polish)

**Defer to v1.4+:** Anything in the Anti-Features table.

---

## Gap Analysis — Proposal vs Table-Stakes

The proposal §5 / §17 / §22 is comprehensive. Cross-checking against industry table-stakes:

| Table-stake | Covered in proposal? | Section | Status |
|---|---|---|---|
| Forecast line | YES | §5 Tier A, §22 | covered |
| Actual line | YES | §5, §22 | covered |
| 95% CI band | YES | §5, §22 | covered |
| Naive baseline | YES | §5 Tier A #1 | covered |
| Last-refit timestamp | YES | §17 popup, §22 | covered |
| Last-7-day accuracy | YES | §17 (full spec) | covered |
| Backtest gate | YES | §16, §19 Phase 12.5 | covered |
| Horizon toggle | YES | §2 12.3, §22 | covered |
| Daily refit | YES | §2 12.2 | covered |
| External data ingest | YES | §6, §7, §2 12.1 | covered |
| Campaign calendar | YES | §2 12.4, §13 | covered |
| Cumulative uplift | YES | §2 12.4, §13, §17 | covered |
| Granularity-aware resampling | YES | §2 12.3, §18 | covered |
| Honest causal labeling | YES | §11, §13 | covered |
| Forecast empty-state | PARTIAL | §17 cold-start covered; 365d uncalibrated badge in §11 | covered |
| **Mobile-default 1-forecast simplification** | YES | §11, §22 mobile section | covered |
| **`shop_calendar` closed-day NaN** | YES | §12 risk #6, §15 | covered |
| **`revenue_comparable_eur` for ITS** | YES | §13 | covered |

**Verdict:** The proposal covers 100% of table-stakes. No gaps.

**Differentiator coverage:** §5 Tier A/B/C, §13 two-track, §17 popup, §18 sampling spec, §22 UI defaults all align with my D-1 through D-18 list. The proposal is more rigorous than typical-industry; D-12 (closed-day awareness, §15), D-14 (quarterly off-week reminder, §15), D-15 (`revenue_comparable_eur`, §13), D-9 (Track-B "unverifiable by construction" UX, §13) are unusually mature features for an SMB-restaurant tool.

**One UX gap worth flagging to roadmapper:**
The proposal does not explicitly address **how the existing FLT-01 date-range picker visually relates to the new horizon chips**. On a 375px viewport, a user could plausibly interpret the date-range picker as also controlling the forecast horizon. Phase 12.3 plan should address: either (a) hide the date-range picker on the forecast card and let horizon chips own the forecast x-axis, or (b) render both with clearly distinct visual roles. This is not a missing feature — it's a UI integration ambiguity.

**One DB-perf gap worth flagging:**
`forecast_daily.yhat_samples` jsonb at 1000 samples × 365 days × 7 models = ~125MB (per §18). Free Supabase tier is 500MB DB. Not blocking but a watch-item — cleaning up Track-B sample paths past the campaign-start cutoff (since they're never read) could halve the footprint. Phase 12.2 plan should consider a TTL/janitor.

---

## Sources

- [Tableau Pulse — Top new feature releases (2025)](https://www.tableau.com/blog/top-new-tableau-pulse-feature-releases-know) — HIGH (forecast UX in production analytics tool)
- [Tableau Pulse — About / overview](https://help.tableau.com/current/online/en-us/pulse_intro.htm) — HIGH
- [Datadog Forecasts Monitor docs](https://docs.datadoghq.com/monitors/types/forecasts/) — HIGH (uncertainty band UX)
- [Datadog — Introducing metric forecasts](https://www.datadoghq.com/blog/forecasts-datadog/) — HIGH
- [UX for AI — Forecasting with line graphs](https://uxforai.com/p/forecasting-with-line-graphs) — MEDIUM (UX-pattern article, single source)
- [Claus Wilke — Visualizing uncertainty (chapter 16)](https://clauswilke.com/dataviz/visualizing-uncertainty.html) — HIGH (textbook reference for graded error bars / fan charts)
- [BIS — The art and science of communicating uncertainty (fan charts)](https://www.bis.org/ifc/events/ifc_8thconf/ifc_8thconf_62pap.pdf) — HIGH (central-bank fan-chart conventions)
- [Causality Engine — Interrupted Time Series glossary](https://www.causalityengine.ai/glossary/interrupted-time-series) — MEDIUM (ITS dashboard pattern reference)
- [Adsquare — Attribution Dashboard](https://adsquare.com/inside-adsquares-attribution-dashboard/) — MEDIUM (campaign-uplift dashboard reference, marketing-vendor pov)
- [Toast — Restaurant sales forecasting guide](https://pos.toasttab.com/blog/restaurant-sales-forecast) — MEDIUM (SMB-restaurant table-stakes from competitor)
- [Lineup.ai — AI forecasting for restaurants](https://www.lineup.ai/) — MEDIUM (specialized SMB-restaurant forecasting product)
- [Restroworks — Best restaurant BI software 2025](https://www.restroworks.com/blog/best-restaurant-business-intelligence-software/) — MEDIUM (market overview)
- `.planning/phases/12-forecasting-foundation/12-PROPOSAL.md` §5 / §11 / §13 / §15 / §17 / §22 — HIGH (project-internal, 1484-line opinionated spec; user-vetted)
