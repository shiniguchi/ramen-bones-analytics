# Pitfalls Research — v1.3 External Data & Forecasting Foundation

**Domain:** Restaurant POS forecasting + Interrupted Time Series uplift attribution on a multi-tenant Supabase + SvelteKit + GHA cron stack
**Researched:** 2026-04-27
**Confidence:** HIGH on forecasting/ITS modeling pitfalls (extensively documented in literature + verified against §11–§20 of `12-PROPOSAL.md`); MEDIUM on chart UI specifics (LayerChart 2.x mobile perf is empirically known but not benchmarked at this exact marker count); HIGH on external-data ToS gotchas (verified directly with Open-Meteo terms 2026-04-27).

This document is a red-team checklist for plan-phase (defensive code) and verify-phase (acceptance criteria). Each pitfall maps to the sub-phase that must prevent it (12.0–12.5).

---

## Critical Pitfalls

### Pitfall 1: Prophet auto-enables yearly seasonality on 10 months of data and fits ghost cycles

**What goes wrong:**
Prophet's `yearly_seasonality='auto'` flag turns yearly seasonality ON when ≥1 year of data is present and OFF otherwise (per Prophet's documented behavior). With 10 months of data (2025-06-11 → 2026-04-13), `'auto'` will leave it OFF — but this milestone runs daily refits, and on **2026-06-11 the data crosses the 1-year threshold** and Prophet silently flips yearly seasonality ON. With ~12 months of data, that's exactly one cycle — Prophet's own docs say yearly fits cleanly only when ≥2 cycles are present. The result: a Fourier yearly cycle fit to noise, baked into 365d forecasts, with zero log warning.

**Why it happens:**
Prophet's `'auto'` heuristic is designed for the median user with 2+ years; it does not differentiate between "one full cycle" (still bad) and "many cycles" (good). Engineers paste `Prophet()` with no kwargs and trust the defaults.

**How to avoid:**
1. In `prophet_fit.py`, **explicitly set `yearly_seasonality=False`** until `len(history) >= 730`. Do NOT use `'auto'`.
2. Per D-09 / §2 12.2-03 / §11: gate the flip via a data-volume check inside `prophet_fit.py`:
   ```python
   YEARLY_THRESHOLD_DAYS = 730  # 2 full cycles, not 1
   yearly = len(history) >= YEARLY_THRESHOLD_DAYS
   m = Prophet(yearly_seasonality=yearly, weekly_seasonality=True, daily_seasonality=False)
   ```
3. Use `seasonality_prior_scale` regularization (default 10 → consider 1.0) when you do enable it the first time, so the new yearly term is regularized hard against picking up noise.

**Warning signs:**
- Prophet 365d forecast shows wavy seasonality that doesn't match raw revenue's visible cadence
- Backtest RMSE at 120d/365d horizon for Prophet jumps after 2026-06-11
- `plot_components` shows a yearly panel with amplitude > weekly panel (wrong for restaurant data — weekly DoW dominates)

**Phase to address:**
Phase 12.2 (`12-2-03-PLAN.md` — Prophet fit). Verify-phase: assert `yearly_seasonality is False` in unit test until calendar passes 2027-06-11. Update flag and re-baseline at that point.

---

### Pitfall 2: SARIMAX exog leakage — using actual weather at training time but only forecast weather at scoring time

**What goes wrong:**
SARIMAX requires the exogenous regressor matrix to be present at predict time, with the **same shape and same semantic meaning** as at training time. The natural mistake: train using `weather_daily` rows where `is_forecast = false` (actuals), then at predict time pass `weather_daily` rows where `is_forecast = true` (Open-Meteo's 7d forecast — noisy). The model has now learned coefficients calibrated to perfect weather (actuals) but is being scored against imperfect weather (forecasts). Errors don't compound linearly — they bias the forecast in the same direction as Open-Meteo's systematic bias.

**Why it happens:**
The `weather_daily` schema in §7 has `is_forecast boolean` but no enforced separation in the fit/predict join. Engineers join on `date` and forget the actual/forecast distinction.

**How to avoid:**
1. **Train on the same flavor of weather you'll predict against.** Either:
   - (Preferred) Train on Open-Meteo's *historical reanalysis* (which is what the archive endpoint returns — already the actual-actual). Predict against the 7-day forecast endpoint. The 16d→365d gap fills with climatological norms. The semantic boundary is consistent: "weather model output" both at train and predict.
   - (Alternative) Train on actuals, but at predict time pass Open-Meteo forecasts AND inject Gaussian noise calibrated to Open-Meteo's RMSE-vs-actuals to widen the SARIMAX CI honestly.
2. Document `exog_signature` (already in `forecast_daily` schema §7) with a hash of the exog matrix's source flavor, so cross-version comparisons are detectable.
3. **For target_date > today + 16d**, the regressor is climatological norm by necessity (Open-Meteo only forecasts 16d; D-09 specifies fallback to DoW × month historical mean). Document this as a separate exog flavor and validate the SARIMAX coefficients on that flavor of training data too.

**Warning signs:**
- 7d-horizon backtest RMSE >> 35d-horizon backtest RMSE (suspicious — long horizons should be worse, not better)
- Forecast bias correlates with Open-Meteo's known bias on temperature (typically warm-skewed in winter)
- Hover popup shows MAPE on actual-day eval much better than backtest MAPE (training-time leakage signature)

**Phase to address:**
Phase 12.2 (`12-2-02-PLAN.md` — SARIMAX fit). Verify-phase: in `test_smoke_per_model.py`, assert that the exog matrix used during `fit()` and the one used during `forecast()` come from the same `weather_source_flavor` (archive vs forecast vs climatology). Log `exog_signature` per fit.

---

### Pitfall 3: ITS counterfactual fit on declining pre-period extrapolates the decline → counterfactual undercuts actual → false positive lift

**What goes wrong:**
The pre-campaign era (2025-06-11 → 2026-04-13) has a declining revenue trend (per `tools/its_validity_audit.py` 2026-04-27 audit + the fact that the friend launched a campaign at all). SARIMAX trained on this period will project continued decline. After 2026-04-14, even if the campaign does NOTHING and actual revenue just stays flat (mean-reversion, end of seasonal trough, weather improving), `actual − Track-B` is positive because Track-B kept declining. The friend sees "+€420 cumulative uplift" — but the campaign caused €0 of it; the trend extrapolation is the entire signal.

**Why it happens:**
ITS literature (PMC4460815) is explicit: the assumption "without intervention, the pre-trend continues unchanged" can fail when the pre-trend is itself an unsustainable decline (mean-reverting to a floor). On 10 months of declining data, you cannot distinguish secular decline from seasonal trough; SARIMAX picks linear/AR drift and runs with it.

**How to avoid:**
1. **Run the ITS validity audit (`tools/its_validity_audit.py`) on every campaign** (per §15 + §2 12.0). Confirm pre-period trend is genuinely structural, not a tail of a seasonal cycle.
2. **Use `revenue_comparable_eur` (per §13)** — strips out items launched ≥7 days before campaign — to make the apples-to-apples comparison cleaner. New menu items inflate post-period; baseline-items-only Track-B inherits the same item set as actual, neutralizing one degree of freedom.
3. **Show the uncertainty honestly:** §17 mandates that Track-B accuracy column shows "unverifiable by construction" not a fake RMSE. Extend that to the uplift card: when Track-B's CI band overlaps zero, label "no detectable lift" not "+€X uplift."
4. **Cross-check with a flat counterfactual:** also compute uplift vs the simple naive same-DoW pre-campaign mean (no trend). If that uplift is positive but SARIMAX uplift is much larger, flag the gap as "trend-extrapolation contribution" in the popup.
5. **Quarterly off-week re-anchoring (D-11b) starts 2026-10:** schedule the first off-week 6 months post-launch to give the counterfactual a fresh anchor point, per §11 + §12.

**Warning signs:**
- Cumulative uplift grows linearly with campaign duration (hint: that's the trend extrapolation, not a campaign signal — a real campaign effect should plateau or decay)
- Naive-DoW-baseline uplift << SARIMAX-Track-B uplift (the gap is your bias)
- Pre-period RMSE on Track-B is much higher than post-period in-sample fit (model is over-extrapolating)

**Phase to address:**
Phase 12.4 (`12-4-01-PLAN.md` — Track-B counterfactual). Validation: `campaign_uplift_v` must include `naive_dow_uplift_eur` as a sanity check column. Verify-phase: red-team the first campaign by computing both SARIMAX and naive uplift, flag the divergence.

---

### Pitfall 4: Concurrent intervention contamination (3 new menu items launched at campaign start, hour change, etc.)

**What goes wrong:**
ITS validity collapses if any other intervention coincides with the campaign launch on 2026-04-14. The 2026-04-27 audit (per §2 12.0) already flagged: 3 new items (`Onsen EGG`, `Tantan`, `Hell beer`) launched at the campaign window; if the friend ALSO changed prices, hours, staff, or outdoor seating, those changes are absorbed into the campaign's measured uplift and cannot be untangled post-hoc.

**Why it happens:**
Restaurant owners launch initiatives in bundles (new menu + campaign + spring weather + outdoor seating). Each individually drives revenue; the model attributes 100% to the one labeled "campaign."

**How to avoid:**
1. **`tools/its_validity_audit.py` is mandatory weekly** (per §2 12.0). Audit checks: prices stable (per-item median price diff), customer behavior fundamentals (avg party size, ticket size on baseline items), new-item arrivals, hour changes (last-tx-time per DoW shift detection).
2. **`baseline_items_v` already handles new-item bias** (§7, §13) — Track-B fits on `revenue_comparable_eur`, not raw revenue. This is non-negotiable per §11: "If anyone shortcuts and uses raw revenue for uplift, the estimate is biased low."
3. **Hours change detection:** add a `shop_calendar.hours_open` history check to the audit. If `hours_open` shifted within ±21d of campaign start, flag and adjust the regressor.
4. **Price change detection:** weekly query `select item_name, price, count(*) from stg_orderbird_order_items group by item_name, price order by 1, 2` — if any item has 2+ recent prices, surface in audit.

**Warning signs:**
- Audit script flags a price change, hours change, or new item within 14d of campaign start
- Per-item revenue share shifts post-campaign in ways the campaign creative doesn't explain
- ATV (avg ticket value) jumps step-wise on campaign start (suggests a price change, not a volume effect from marketing)

**Phase to address:**
Phase 12.0 (commit `tools/its_validity_audit.py`) + Phase 12.4 (campaign_uplift_v reads only `revenue_comparable_eur` for Track-B). Verify-phase: audit must be in green status before any uplift number is shown to the friend.

---

### Pitfall 5: External-data refresh fails silently → forecast runs against stale weather → user sees fresh-looking but stale prediction

**What goes wrong:**
The pipeline is `external-data 02:30 UTC` → `forecast-refresh 03:00 UTC` (per §8 + D-09b). If `weather_fetch.py` fails at 02:30 (Open-Meteo 5xx, network blip, exec timeout), `forecast-refresh.yml` at 03:00 will happily run with whatever's in `weather_daily` (yesterday's forecast for today, possibly a week stale). The chart shows a "fresh" forecast (run_date = current_date) but it was conditioned on stale exog. The user trusts the forecast freshness badge; the forecast is silently degraded.

**Why it happens:**
GHA workflows are independent jobs — `forecast-refresh.yml` doesn't check whether `external-data-refresh.yml` succeeded. The `pipeline_runs` audit table (§14, §15) exists to catch this but only if forecast scripts read it before running.

**How to avoid:**
1. **`forecast-refresh.yml` must check `pipeline_runs`** for a successful `weather_fetch` row in the last 36h (the freshness SLO from §14). If not, fail loud, don't run.
2. **Implement the §14 freshness SLO with UI signaling:** chart shows "weather data: stale (last fetched [date])" badge if >36h old.
3. **Climatological norm fallback** (D-09b, §14): if weather is stale, fill the regressor matrix with the DoW × month historical mean. This is degraded but not silent — `exog_signature` records the fallback flavor and the popup shows "uncalibrated weather inputs."
4. **Cron job dependency check** in `forecast-refresh.yml`:
   ```yaml
   - run: python scripts/forecast/check_upstream_fresh.py
     # exits non-zero if pipeline_runs lacks fresh weather/holidays/events rows
   ```

**Warning signs:**
- `pipeline_runs` shows a `weather_fetch` failure but `forecast_fit` success on the same night
- `forecast_daily.exog_signature` shows climatology flavor on a date Open-Meteo should have covered
- Stale freshness badge surfaced in UI 2+ consecutive days

**Phase to address:**
Phase 12.5 (`12-5-01-PLAN.md` — alerting). Verify-phase: deliberately fail `weather_fetch.py` in CI; assert `forecast_fit` either skips or runs with `exog_signature='climatology'` (never silently mis-conditioned).

---

### Pitfall 6: Backtest "fair comparison" violation — SARIMAX gets regressors, naive doesn't, and we pat ourselves on the back

**What goes wrong:**
Per §16, SARIMAX gets exog regressors (weather, holidays, is_campaign), and naive same-DoW gets nothing. SARIMAX wins the backtest by 15% RMSE — but is it the model architecture that won, or just the regressors? You cannot deploy SARIMAX claiming "model superiority" when the comparison is unfair. Worse: when forecasts at 35d/120d/365d horizons require climatological-norm regressors (because Open-Meteo only forecasts 16d), the SARIMAX advantage shrinks dramatically — the model is being scored against a regressor matrix it never trained on.

**Why it happens:**
Default rolling-origin CV harnesses use whatever exog is convenient. The "fair" version (§16) adds significant code: regressor-on naive baseline, climatology-flavor at long horizons, fold-by-fold exog flavor matching.

**How to avoid:**
1. **§16 is the gate:** "fair_rmse(M, H) = rolling-origin CV RMSE with M fit on [train data including all available regressors]; fair_rmse(naive, H) = rolling-origin CV RMSE of naive same-DoW-mean (no regressors, that's the floor)." But also report a **regressor-aware naive**: naive-DoW + holiday flag (DoW × is_holiday segmentation). This is the *fair* baseline. SARIMAX must beat that, not just the unflavored naive.
2. **Multi-horizon gate:** §16 explicitly limits gating to 7d and 35d. Do NOT gate at 120d/365d — they're exploratory until ≥2 years data. UI badges "BACKTEST PENDING" or "UNCALIBRATED."
3. **Climatology-flavor exog must train the model.** If predict-time exog comes from climatology beyond day 16, then 60% of the forecast is conditioned on climatology — the model must have seen that flavor in training. Bake into rolling-origin folds: each fold's predict step gets the same exog flavor that production gets at that horizon.
4. **What if naive is unbeatable?** If revenue is genuinely flat and naive-DoW + holiday segmentation gets MAPE 8%, SARIMAX may not improve materially. **The gate becomes "ship the simpler model"** — that's the right answer. Don't move the goalposts. Promote naive-DoW-with-holiday as the production model and skip Prophet/SARIMAX UI lines until the data warrants them.

**Warning signs:**
- SARIMAX gate passes 7d but fails 35d (or vice versa) — pick the production target carefully
- Naive baseline RMSE close to noise floor (RMSE / mean(actual) < 0.1) — model improvements likely unfair gains from over-fitting CV folds
- SARIMAX fit with all regressors only beats SARIMAX fit with NO regressors by <2% (the regressors aren't earning their complexity)

**Phase to address:**
Phase 12.5 (`12-5-01-PLAN.md` — backtest gate). Verify-phase: gate must report both `fair_rmse_naive_unflavored` and `fair_rmse_naive_with_holidays`; production model must beat the higher of the two.

---

### Pitfall 7: Closed-day handling biases the seasonal fit (NaN vs zero vs drop)

**What goes wrong:**
Pre-2026-02-03, the shop is closed Mon/Tue. Post-Mar 2, hours expanded. The model sees a discontinuous time index. Three wrong choices:
- **Drop closed days entirely** → SARIMAX/Prophet lose the equally-spaced time series assumption; weekly seasonality fits to a 5-day cycle that's not actually weekly.
- **Fill closed days with 0 revenue** → Mean revenue collapses 28%; weekly seasonality term over-fits the Mon=0/Tue=0 spike; Wed-Sun mean shifts.
- **Fill closed days with imputed values** → Imputation noise leaks into seasonal estimate.

**Why it happens:**
Time series libraries (statsmodels SARIMAX, Prophet) assume regular time index. Restaurant data is fundamentally irregular due to closures. Each library has different conventions: Prophet accepts `y=NaN` and skips; SARIMAX errors on NaN; pandas resample fills forward by default.

**How to avoid:**
1. **§12.6 + §15 already ruled this:** `y=NaN` for closed days; `shop_calendar.is_open` binary regressor encodes the signal. Prophet handles `y=NaN` natively (skips fitting on missing y). SARIMAX requires a different recipe: pass `y_fit = revenue.where(is_open)` — let SARIMAX impute via state-space (it does this gracefully).
2. **Predict step must zero-out closed days:** at score time, if `shop_calendar.is_open=false` for `target_date`, force `yhat=0` regardless of model output (model produces a non-zero "what would have been" prediction; product UX is "zero revenue on closed days"). Store the predicted-counterfactual separately for ITS use; show 0 on the chart.
3. **Future closed-day forecast:** `shop_calendar` (per §15) must be populated 365d forward with `is_open` derived from "last 8 weeks pattern + public holidays". Without this, 365d forecast assumes shop open every day — over-predicts annual revenue by ~12%.
4. **Regime-shift handling (Mon/Tue close → open):** add `shop_calendar.is_open_pattern_id` or use Prophet's `add_changepoints` at the regime-shift dates (2026-02-03, 2026-03-02 per §3 D-07). SARIMAX needs explicit dummy regressors for the regime windows.

**Warning signs:**
- Mean weekly revenue (model) ≠ mean weekly revenue (raw data) by >5%
- Forecast for a known-closed future day (e.g., Christmas Day) returns non-zero yhat
- Mon/Tue forecast post-regime-shift looks suspiciously low (model still pulled by the old closed-day pattern)

**Phase to address:**
Phase 12.2 (`12-2-02-PLAN.md` — SARIMAX fit, `12-2-03-PLAN.md` — Prophet fit) + Phase 12.1 (`shop_calendar` table populated). Office-hours topic #7 explicitly named this. Verify-phase: assert `forecast_daily.yhat = 0` for any `target_date` where `shop_calendar.is_open = false`.

---

### Pitfall 8: Chronos zero-shot underperforms naive on this short series — and we ship it anyway because it's a "foundation model"

**What goes wrong:**
Chronos-Bolt-Tiny is a foundation model trained on a broad time-series corpus. On benchmark datasets it outperforms statistical baselines (Amazon's published results). On a 10-month single-series with strong DoW seasonality and weather coupling, it may **underperform** naive-DoW-with-holidays because:
- Chronos doesn't natively use the German-holiday/weather covariates (Chronos-Bolt-Tiny is univariate; only Chronos-2 covariate variant takes covariates per §13)
- The model was not trained on European restaurant data
- Zero-shot transfer is weakest when the target series is short and idiosyncratic

If we ship Chronos as a chart line without checking the §16 gate, the friend sees a wildly wrong forecast and loses trust in the whole product.

**Why it happens:**
Foundation-model hype + behind-feature-flag scaffold (D-08) + "let's just see" attitude.

**How to avoid:**
1. **D-08 already feature-flags Chronos.** Per §3, `FORECAST_ENABLED_MODELS=sarimax,prophet,naive_dow` is the default. Chronos is opt-in.
2. **§16 gate applies to Chronos before promotion:** must beat naive-DoW + holidays by ≥10% RMSE on 7d/35d. If it doesn't, keep it disabled.
3. **Use Chronos-2 covariate variant**, not vanilla Chronos-Bolt-Tiny — vanilla is univariate and discards weather/holiday signal. The proposal table §13 already accounts for Chronos-2 with covariates.
4. **Show the gate result in the legend:** the legend chip for Chronos should display its 7d-RMSE-vs-naive ratio so the user knows *why* Chronos is on/off the chart.

**Warning signs:**
- Chronos forecast line wildly diverges from SARIMAX/Prophet (especially on holidays — proof it's not using the holiday signal)
- Hover popup MAPE for Chronos > MAPE for naive baseline
- Gate workflow logs Chronos failed promotion but feature flag is still on for some tenant

**Phase to address:**
Phase 12.2 (`12-2-04-PLAN.md` — Chronos behind flag) + Phase 12.5 (gate enforces flag). Verify-phase: feature_flags table cannot have `forecast.chronos.enabled='true'` unless `forecast_quality` shows a passing 7d-horizon row in the last 7 days.

---

### Pitfall 9: Mobile chart spaghetti — 5 forecast lines + CI band + 7 event markers + 1y horizon = unreadable on iPhone SE

**What goes wrong:**
At 1-year horizon on a 375px-wide phone, the chart has ~365 data points along x-axis — that's <1px per day. Add 5 forecast methods × 1 actual line = 6 overlapping curves. Add CI shade. Add ~10 federal holidays + Frauentag + ~6 school holiday blocks (shaded background) + ~8 recurring events + estimated 4-6 BVG strike days + N campaign-start markers (each as vertical lines). Result: a chart where the user can't see the actual revenue line through the noise. LayerChart 2.x SVG markers compound — each marker is a separate DOM node; 30+ markers on a phone slows pan/zoom interaction noticeably.

**Why it happens:**
"Show everything" is the easy default. UI clutter creep is a known phenomenon in dashboard development; phones amplify it.

**How to avoid:**
1. **§22 mandates default UI:** "actual revenue line + SARIMAX BAU forecast + 95% CI band. Nothing else." Default horizon = 7d. Default markers = campaign start days only. Everything else is opt-in.
2. **Mobile (≤640px) collapses further (per §22):** "actual + sarimax_bau combined into one CI-shaded curve, legend collapsed into bottom-sheet, tap-to-pin." This is non-negotiable for the friend's first 30 seconds on the dashboard.
3. **Server-side aggregation for sample paths (per §18):** never ship 1000 sample paths × 365 days × 5 models = 1.8M floats to the phone. Aggregate to mean + p2.5 + p97.5 server-side; ship 3 numbers per (model, target_date) = ~5500 floats, well within mobile JSON budget.
4. **At 1y horizon, downsample to weekly buckets** in the chart layer. The user is making a yearly-vibe judgment, not a per-day decision. 52 points × 6 lines is readable.
5. **Event markers: progressive disclosure.** Show campaign-start vertical lines always. Holidays/school-blocks/strikes appear only when zoomed to ≤90d. Recurring events appear only when zoomed to ≤30d.
6. **Tap-to-pin for hover popup** (per §22): mobile has no real hover; tap pins the popup, second tap dismisses.

**Warning signs:**
- Chrome MCP screenshot at iPhone SE 375px shows >2 lines visible by default
- Pan/zoom interaction lag >200ms
- Chart bundle JS payload >50KB (sample paths leaked to client)

**Phase to address:**
Phase 12.3 (`12-3-04-PLAN.md` — Mobile QA). Verify-phase per §19 12.3: "mobile (iPhone SE 375w): only 1 line shown by default + CI band; legend collapses to bottom-sheet on tap."

---

### Pitfall 10: Anticipation effects in pre-campaign era — the friend told regulars before launch, so pre-period revenue is already biased upward

**What goes wrong:**
Track-B counterfactual is fit on `[2025-06-11 .. 2026-04-13]`. If the friend hinted at the campaign in conversation with regulars in the last 1-2 weeks before 2026-04-14, those regulars came in early in anticipation. Pre-period revenue's last 7-14 days are inflated, the SARIMAX trend term picks up an upswing, the counterfactual now over-projects → uplift estimate is **understated** (true campaign effect is bigger than measured) or in the worst case shows negative.

**Why it happens:**
ITS literature (PMC4460815) names this "anticipation" or "transition period" bias. It's the dual of trend extrapolation (Pitfall 3). Marketing campaigns don't have crisp boundaries — friends/regulars hear about it informally.

**How to avoid:**
1. **Verify with the friend in office hours (per §4 topic 1):** "Did you tell anyone about the April 14 campaign before April 14? If yes, when did you start mentioning it?" Use that date as the actual `cutoff_date` for Track-B, not the campaign launch date.
2. **Buffer the cutoff:** default Track-B cutoff = `campaign_start_date - 7 days`. The 7-day buffer absorbs informal pre-announcement effects. (This is symmetric with the §13 baseline-items 7-day buffer for new menu items — same principle, different domain.)
3. **Sensitivity analysis:** fit Track-B at multiple cutoff dates (`-14d`, `-7d`, `-1d`, `+0d`) and report uplift under each. If the estimate is robust across cutoffs, ship. If it swings >20%, flag as anticipation-sensitive.
4. **Show the 7-day buffer in the UI** (small footnote on uplift card): "counterfactual fit on data through 2026-04-07 (1 week before campaign launch)."

**Warning signs:**
- Last 14 days of pre-period have higher mean revenue than weeks 14-28 prior (could be anticipation OR seasonal recovery — distinguish via prior-year comparison if data allows; here, no prior year, so be conservative)
- Sensitivity analysis shows uplift estimate halves when cutoff moves from `-1d` to `-14d`

**Phase to address:**
Phase 12.4 (`12-4-01-PLAN.md` — Track-B fit). Verify-phase: `pipeline_runs.error_msg` for every CF refit must record the `fit_train_end` date; sensitivity analysis log at `tests/forecast/cutoff_sensitivity.md`.

---

### Pitfall 11: Open-Meteo "non-commercial" ToS — Ramen Bones is OSS but the friend operates a for-profit restaurant

**What goes wrong:**
Open-Meteo's terms (verified 2026-04-27 at https://open-meteo.com/en/terms) restrict the free tier to "non-commercial use." Examples of non-commercial use: private/non-profit websites, personal home automation, public research at public institutions, educational content. Examples of commercial use: websites/apps with subscriptions or advertisements, integration into commercial products or promotional activities, undisclosed research at commercial entities.

**The boundary problem for Ramen Bones:**
- The OSS repo itself is non-commercial.
- A solo restaurant owner forking it for their own use → arguably "personal home automation" / non-commercial.
- The current single-tenant deployment for a Berlin ramen restaurant → the restaurant is a for-profit business that *uses* the dashboard to make money decisions. This is a gray area Open-Meteo's terms don't cleanly cover.
- Future: a third-party operator running Ramen Bones as a SaaS for multiple restaurants → unambiguously commercial; would breach free-tier terms.

**Why it happens:**
"Free API + open-source app" creates the assumption that the friend's downstream use is also free. ToS clauses are often skimmed.

**How to avoid:**
1. **Ship Bright Sky as fallback today, not later** (D-01 + §6). Bright Sky uses DWD public-domain data — no commercial restriction. Wire `weather_fetch.py` to read a `WEATHER_PROVIDER` env var (`open-meteo` | `brightsky`); default to `brightsky` for the production deployment.
2. **README must document the boundary:** "Self-hosted forks for personal/single-restaurant use → Open-Meteo free tier is acceptable per Open-Meteo's stated examples. Commercial SaaS hosting → switch to Bright Sky or buy Open-Meteo's commercial subscription (~€10/mo per Open-Meteo's commercial pricing page)."
3. **Telemetry-free:** if Open-Meteo's free-tier terms ever shift toward "no commercial integration of any kind," the cost of switching is one env var. Test the Bright Sky path in CI weekly so the fallback doesn't bitrot.

**Warning signs:**
- Production logs hit Open-Meteo's 10K req/day limit (only happens at scale, but signals the ToS conversation is overdue)
- Open-Meteo's terms page changes wording (subscribe to changelog or watch the URL via headlessly-monitoring CI)

**Phase to address:**
Phase 12.1 (`12-1-02-PLAN.md` — weather fetcher) must default to Bright Sky for any deployment marked production. Verify-phase: assert that `WEATHER_PROVIDER=brightsky` is set in DEV and PROD env, `open-meteo` only in local dev.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skip `tools/its_validity_audit.py` weekly run | Saves 5 min of analyst time | First missed concurrent intervention biases every uplift number until caught — could be months | Never. Per §2 12.0 it's mandatory. |
| Hand-curated `recurring_events.yaml` without a Sept 15 reminder cron | One less migration | Oct 2026 rolls around; YAML is silently empty for 2027; Berlinale/CSD/Marathon vanish from event regressors; SARIMAX coefficients drift quietly | Acceptable for v1 only with §15's `recurring-events-yearly-reminder` pg_cron job committed |
| Run forecast cron without checking `pipeline_runs` upstream success | One fewer dependency in workflow | Stale-weather forecasts shipped silently; user trust eroded after the first "weird" Wednesday | Never |
| Sum Prophet `yhat_lower`/`yhat_upper` for weekly/monthly CI aggregation | Saves keeping `yhat_samples` jsonb | Posterior summation ≠ percentile of summed samples; CI is wrong by ~30% at weekly bucket | Never. §11: "Do not sum Prophet's `yhat_lower`/`yhat_upper`." Use sample paths + percentile (§18). |
| Show all forecast lines on mobile by default | "Power users will love it" | Friend opens app, sees spaghetti, never opens again. v1 success depends on this user. | Never. §22 mandates default = 1 line on mobile. |
| Train SARIMAX with `is_campaign=0` for all rows (skip Track-A entirely) | Half the model count | Lose the BAU forecast — chart only shows counterfactual; uplift card is the only chart artifact; user has no "what's next week's revenue?" answer | Never. §13 requires both tracks. |
| Use floats for revenue | Faster Python math | Currency rounding errors at €0.01 scale compound; reconciliation with Orderbird tax reports fails | Never. §20 mandates `numeric(12,2)`. |
| Skip the §16 gate, ship SARIMAX based on "feels right" | 1 week saved | First time SARIMAX misses a weekend by €500 the friend asks why; we have no defensible answer | Acceptable in 12.2 *exploratory* phase only — must ship gate before friend sees uplift attribution UI |
| Single-cutoff Track-B (no sensitivity analysis) | Faster CF fit | Anticipation effect (Pitfall 10) silently inflates/deflates uplift; no defensible response when challenged | Acceptable for V1 demo only if §17 hover popup honestly displays "anticipation uncertainty: not measured" |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| **Open-Meteo** | Use `archive-api` for historical AND `forecast` for future, pretend they're the same dataset | They're different reanalysis flavors. Tag every `weather_daily` row with `source` (`archive` vs `forecast` vs `climatology`); SARIMAX uses one consistent flavor at fit and predict |
| **Open-Meteo** | UTC-returned times treated as Berlin local | Convert at fetcher boundary (§20 rule 2): all `date` columns are Europe/Berlin civil date, conversion happens once in `weather_fetch.py`, never in SQL |
| **Open-Meteo** | Forecast at 02:30 UTC = previous-day midnight Berlin → off-by-one for early-AM transactions | Cron runs UTC; `weather_fetch.py` requests Berlin-local `date` explicitly via `timezone=Europe/Berlin` parameter (Open-Meteo supports this) |
| **`python-holidays`** | `holidays.Germany(years=2026)` (no state) → no Frauentag | Must specify `state="BE"` for Berlin. Verified in §6: returns 9 federal + Frauentag (March 8). Test: `assert date(2026,3,8) in holidays.Germany(state='BE', years=2026)` |
| **`ferien-api.de`** | Single API call returns the year — assumed fresh forever | School holiday dates are politically set per year; the API is updated annually. Re-fetch quarterly minimum, not just at launch. |
| **BVG RSS** | Parse only `<item>` titles; miss strike severity | Title says `Streik` but body has details (which line, how long). Parse both; store body in `transit_alerts.body` per §7. |
| **BVG RSS** | Multiple alerts on the same date treated as 1 event (or summed twice) | Per `transit_alerts.alert_id = hash(title+date)` (§7), a single date can have multiple alerts (M-Bahn + S-Bahn). Aggregation to "is there a strike today" lives in a view layer that takes `bool_or` per `affected_date`, not raw count. |
| **BVG RSS URL** | Hard-coded URL never checked; URL changes silently | §12 risk #1: "BVG RSS URL not yet verified." Phase 12.1 acceptance test must `curl -fsS [URL]` and parse XML; CI step that fails the build if the feed format changes. |
| **Supabase RLS + service role** | Use service role key in browser-side fetcher (terrible — leaked to client) | Service role key only in GHA workflow secrets (`secrets.SUPABASE_SERVICE_ROLE_KEY`). Browser uses anon key + JWT. RLS policies on every new table per §7. |
| **pg_cron MV refresh** | Schedule MV refresh every 5 min while writes are landing | §11 (CLAUDE.md stack section): use `REFRESH MATERIALIZED VIEW CONCURRENTLY`; schedule with margin (overlapping refreshes can deadlock per pg_cron + REFRESH literature). Forecast MV refresh runs after `forecast_fit.py` completes, not on a fixed schedule. |
| **GHA cron drift** | `cron: '30 2 * * *'` interpreted as Berlin local | GHA runs UTC always. 02:30 UTC = 04:30 CEST (summer) / 03:30 CET (winter). DST shift in October means the "Berlin morning hour" of the cron drifts; document and don't depend on it. |
| **Anthropic API key** | Imported into a SvelteKit `+server.ts` for some "quick demo" | Per CLAUDE.md stack: only Supabase Edge Functions hold the Anthropic key. Insight job triggered by pg_cron via `pg_net`. Browser/SSR never see the key. |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Ship 1000 sample paths × 365d × 5 models = 1.8M floats per chart load | Mobile bundle bloat, JSON parse stall, scroll lag | Aggregate server-side to mean + 2 quantiles in a view (`forecast_daily_summary_v`); ship ~5K floats max. §18 retains samples in `forecast_daily.yhat_samples` for server-side resampling at week/month bucket — never ships to client | Breaks on phone at horizon=1y, granularity=daily. Threshold: when chart payload >100KB |
| `forecast_daily.yhat_samples` jsonb column at 1000 samples × 365d × 7 models per night | DB rows balloon, MV refresh slows, `pg_dump` size explodes | §18: "JSON column adds ~50KB per row × 365 days × 7 models = ~125MB total. OK for V1; revisit at scale." At 50 tenants → 6GB. Move to Parquet column / Supabase storage / drop sample retention to 100 paths | Breaks at ~10 tenants on Supabase free tier (500MB DB limit) |
| LayerChart SVG markers — 30+ markers (holidays + strikes + events + campaigns at 1y) | Pan/zoom lag on mobile, layout thrash | Progressive disclosure (Pitfall 9 prevention): show campaign markers always, holidays only at ≤90d zoom, etc. Test with 100 markers in dev to surface ceiling early | Breaks at 50+ visible markers on iPhone SE per local benchmark; avoid by zoom-gating |
| pg_cron MV refresh + concurrent forecast write | Deadlock; one of the queries cancels with `40P01` | §16/§5 stack pitfall: use `REFRESH MATERIALIZED VIEW CONCURRENTLY` + unique index; schedule MV refresh with 5+ min buffer after upstream writes complete | Breaks on first night where weather fetch is slow (>15min) and forecast write overlaps |
| Run all 5 models nightly when 4 don't beat naive | GHA minutes burn (free tier still high but watch cumulative); cold-start path lengthens | Gate (§16) disables underperforming models from nightly fit. Track-B can use a smaller model set than Track-A | Breaks when GHA monthly minutes pass 1500/month (per §21 tripwire) |
| Refit 7 days × 5 models (last_7_eval) for prophet with `mcmc_samples=300` | 7 × 30s = 3.5 min per model per night | §17 explicitly: "only run last-7 with mcmc disabled, accept Gaussian CIs for the per-day predictions" | Breaks at first nightly job exceeding 6h GHA limit; mcmc disabled keeps total <10min |
| In-page chart re-renders on every horizon toggle | Visible flash, lost zoom state | Compute server-side once (forecast paths for 365d), slice client-side; horizon toggle is pure x-axis re-zoom, not a refetch | Breaks at first user complaint about losing scroll position |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| `forecast_daily` RLS policy missing → tenant A reads tenant B's predictions | Cross-tenant data leak | §7 schema: `create policy forecast_daily_tenant_read on forecast_daily for select using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);` Required on every new table per CLAUDE.md constraints |
| Service role key committed to git in a `.env` checked into repo | Anyone who clones the repo has prod write access | `.gitignore` enforces `.env*`; `gitleaks` action in CI; service role key only in GHA workflow secrets |
| Open-Meteo / ferien-api / BVG fetchers run unauthenticated → log injection via crafted RSS | RSS body field gets stored in DB, surfaces in UI, XSS | Strip HTML tags + length-cap + allow-list character class on `transit_alerts.title/body` before insert. Svelte's `{@html}` is forbidden in event-marker rendering — use `{title}` (auto-escaped) |
| `campaign_calendar` admin form (12.4-00) accepts arbitrary tenant_id via JS | Insert campaign for another tenant | Server-side `+page.server.ts` ignores client tenant_id, derives from `event.locals.session.user.tenant_id` |
| `feature_flags` table mutated client-side by toggling Chronos | User enables an experimental model without backtest gate | RLS update policy: `for update using (false)`; flag mutations only via Supabase Edge Function with role check |
| `pipeline_runs.error_msg` contains raw SQL including JWT/secrets when forecast fit fails | Secret leakage in audit log | Sanitize error messages: regex strip `eyJ` (JWT prefix) and `supabase.co` keys before insert |
| Backtest workflow has `permissions: write-all` to write `backtest_report.md` | Workflow could push code, manipulate other artifacts | Scoped `permissions: contents: write` only on the backtest job |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Show "+€420 cumulative uplift" without a CI band | Friend treats it as gospel; campaign fails to show effect; she doubts the dashboard not the model | Always show CI: "+€420 (95% CI -€180 to +€1020)" — when CI overlaps zero, the chart label switches to "no detectable lift yet" instead of a number |
| Hover popup shows accuracy from 12-fold rolling-origin CV (3 weeks old) | "Why does this model say 18% MAPE but yesterday's forecast was off by 50%?" | §17 mandates last-7-actual-days metric, recomputed nightly. Distinct from §16 gate. Both shown, labeled clearly. |
| 365d forecast on chart with no "uncalibrated" badge | User makes capacity-planning decisions based on a backtest-pending forecast | §11 + §22: show "BACKTEST PENDING — ≥2 years data needed for reliable annual forecast" badge until 2027-06-11 minimum |
| Track-B counterfactual labeled "forecast" in UI | User thinks the dashed line is a prediction; it's actually "what would have happened without the campaign" | Label `forecast_track='cf'` lines as "counterfactual (no-campaign world)" with a small ⓘ tooltip; default OFF on mobile |
| Forecast updates silently overnight while user is asleep — they wake up to a different chart with no diff | Trust erosion: "did I imagine yesterday's forecast?" | Show "last refit: 2026-04-26 03:01 UTC" badge always; on user's first visit of the day, brief overlay "forecast updated overnight; tap to compare with yesterday's run" (defer feature) |
| Closed-day shown as 0 revenue + a forecast prediction line dipping to 0 | Visually misleading — looks like a catastrophic dropout | Hide forecast line on closed days; show a subtle vertical hatched band labeled "closed" |
| Timezone footnote buried in settings → friend looks at 03:00 forecast time and is confused | "Why does it say my 03:01 UTC refresh — is it morning?" | Display all timestamps in Europe/Berlin civil time in the UI (per §20 rule 2). Server stores UTC; conversion is at render boundary. |
| Hover popup latency >300ms on slow phone | User taps marker, popup appears late, taps again to dismiss, popup arrives, frustration | Pre-compute popup data on hover-zone enter (50ms throttle); pin animation runs while data loads |
| 5 forecast lines lit up on chart by default | Visual noise; friend can't tell which is "the forecast" | §22: default to 1 forecast line (SARIMAX BAU) + actual + CI band. Power users opt in via legend chips. |
| "What's the model's RMSE?" without context units | "18 RMSE" — €18? €1800? hours? | Always show units: "RMSE €148, MAPE 18%". §17 spec already includes units. |

---

## "Looks Done But Isn't" Checklist

- [ ] **Forecast pipeline runs nightly:** Often missing the upstream-freshness check — verify `forecast-refresh.yml` has a `check_upstream_fresh.py` step that exits non-zero if `pipeline_runs` shows stale weather/holidays
- [ ] **Track-B counterfactual fit:** Often missing the cutoff audit — verify `pipeline_runs.error_msg` records `fit_train_end` for every CF refit, and assert `fit_train_end <= campaign_start_date - interval '7 days'`
- [ ] **Backtest gate workflow:** Often missing the regressor-aware naive baseline — verify `forecast_quality` table has rows for both `naive_dow` and `naive_dow_with_holidays` model_names; gate compares against the higher RMSE
- [ ] **Hover popup accuracy row:** Often shows 12-fold gate metric, not last-7-day — verify the SQL in `forecast-quality/+server.ts` filters `evaluation_window='last_7_days'`
- [ ] **Mobile chart default:** Often shows 3+ lines on first paint — verify Chrome MCP screenshot at iPhone SE 375px renders only actual + 1 forecast + CI band before any user interaction
- [ ] **Closed-day forecast handling:** Often returns non-zero yhat for `is_open=false` days — verify acceptance test `select count(*) from forecast_daily f join shop_calendar s using (tenant_id, target_date) where s.is_open=false and f.yhat > 0` returns 0
- [ ] **Open-Meteo ToS:** Often skipped because "we'll fix it later" — verify production deployment has `WEATHER_PROVIDER=brightsky`, not open-meteo
- [ ] **`recurring_events.yaml` annual refresh:** Often missing the pg_cron reminder — verify `select * from cron.job where jobname='recurring-events-yearly-reminder'` returns 1 row
- [ ] **`its_validity_audit.py` weekly:** Often run once at launch then forgotten — verify GHA workflow `audit-cron.yml` runs weekly and posts results to `pipeline_runs`
- [ ] **Prophet `yearly_seasonality`:** Often left at `'auto'` — verify `prophet_fit.py` has explicit `yearly_seasonality=False` until len(history) >= 730 days
- [ ] **Chronos behind feature flag:** Often gets demoed and then "stays on" — verify default GHA env `FORECAST_ENABLED_MODELS=sarimax,prophet,naive_dow` (no chronos)
- [ ] **Sample paths NOT shipped to client:** Often the API endpoint serves raw `yhat_samples` jsonb — verify `/api/forecast/+server.ts` returns only `yhat`, `yhat_lower`, `yhat_upper` per (model, target_date), no jsonb arrays
- [ ] **CI band shown for Track-B:** Often forgotten because Track-B accuracy is "unverifiable" — but the CI from MC sampling is computable and must be displayed; verify popup renders Track-B CI even when accuracy slot says "unverifiable by construction"
- [ ] **Timezone consistency:** Often: extractor stores UTC, dashboard displays UTC, friend confused — verify §20 discipline: all `date` columns are Europe/Berlin civil; all `*_at` are UTC; UI converts at render
- [ ] **`shop_calendar` populated 365d forward:** Often only has historical rows — verify `select count(*) from shop_calendar where date > current_date and date <= current_date + 365` ≥ 365

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Prophet yearly seasonality silently flipped on at 1-year mark, polluted forecasts for N days | LOW | Set `yearly_seasonality=False` explicitly, force-refit. Forecasts immediately revert to correct shape. No data loss. |
| SARIMAX exog leakage detected in backtest | MEDIUM | Add `exog_signature` to `forecast_daily` (one-time migration), backfill last 90d of fits with new signature column, re-train both Track-A and Track-B with consistent exog flavor, document in `backtest_report.md` |
| ITS Track-B trend extrapolation falsely showed +€420 uplift; campaign actually €0 | HIGH | If communicated to friend already: "the early estimate was anticipation-sensitive; here's the corrected number with 4-cutoff sensitivity analysis." Add sensitivity columns to `campaign_uplift_v` permanently. Trust cost: 1 conversation |
| Concurrent intervention (price hike) found post-launch | HIGH | Adjust `revenue_comparable_eur` derivation to exclude affected items; re-fit Track-B; re-render `campaign_uplift_v`. Document in `tools/its_validity_audit.py` log. May reduce uplift by 30-50% — disclose clearly |
| Stale weather → forecast ran with stale exog for 3 days unnoticed | LOW | Backfill weather, re-fit forecast_fit for affected `run_date`s, overwrite `forecast_daily` rows. Show "corrected forecast retroactively applied" badge for 24h |
| BVG RSS URL changed format → 7 days of missing strike data | LOW | Add Verdi-news fallback (per D-04 fallback option), backfill known strikes manually from Twitter/r/berlin, mark `transit_alerts.source='manual_backfill'` |
| Open-Meteo "non-commercial" cease-and-desist letter | MEDIUM | Switch `WEATHER_PROVIDER=brightsky` (env var change only), redeploy, verify CI weekly Bright Sky job has been green. Backfill 1y of Bright Sky data. |
| Mobile chart spaghetti shipped to friend's phone | LOW | Hotfix: `+page.server.ts` returns only `default_visible_models=['actual','sarimax_bau']` for mobile breakpoint; legend collapsed by default. 1-line PR. |
| `forecast_daily.yhat_samples` jsonb caused DB bloat past 500MB free tier | MEDIUM | Truncate samples retention to last 30 days; older runs keep only `yhat`/`yhat_lower`/`yhat_upper`. Run a one-time `delete from forecast_daily where run_date < current_date - 30 and yhat_samples is not null returning ...` after extracting summary CIs |
| Closed-day `yhat=0` rule forgotten → forecast says €700 for Christmas Day | LOW | Add post-fit zero-out step in `fit_all.py`: `update forecast_daily f set yhat=0, yhat_lower=0, yhat_upper=0 from shop_calendar s where s.tenant_id=f.tenant_id and s.date=f.target_date and s.is_open=false and f.run_date=current_date` |
| Backtest gate accidentally promoted regressed model | MEDIUM | Add a `forecast_quality.is_promoted` boolean + a `force_demote` workflow that resets the production model to the last passing model. Roll back via env var `PRIMARY_MODEL` override. |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. Prophet auto-yearly on short data | 12.2 (`12-2-03-PLAN.md`) | Unit test: `assert prophet_model.yearly_seasonality is False` until 2027-06-11 |
| 2. SARIMAX exog leakage | 12.2 (`12-2-02-PLAN.md`) | `forecast_daily.exog_signature` populated; CI test fits/predicts with same flavor |
| 3. Trend extrapolation in declining pre-period | 12.4 (`12-4-01-PLAN.md`) | `campaign_uplift_v` includes `naive_dow_uplift_eur` cross-check column |
| 4. Concurrent intervention contamination | 12.0 (commit `tools/its_validity_audit.py`) + 12.4 (`baseline_items_v`) | Weekly audit cron + assert ITS uplift queries use `revenue_comparable_eur` not `revenue_eur` |
| 5. Stale weather → silent stale forecast | 12.5 (`12-5-01-PLAN.md`) | `forecast-refresh.yml` runs `check_upstream_fresh.py` first; CI red-team with simulated weather failure |
| 6. Backtest unfair-comparison gate | 12.5 (`12-5-01-PLAN.md`) | Gate compares against `naive_dow_with_holidays` (regressor-aware floor), not just unflavored naive |
| 7. Closed-day handling biases seasonality | 12.1 (`shop_calendar` table) + 12.2 (per-model NaN/zero rules) | Acceptance test: forecast for any `is_open=false` day = 0 |
| 8. Chronos zero-shot ships unverified | 12.2 (`12-2-04-PLAN.md`) + 12.5 (gate enforces flag) | `feature_flags` cannot enable Chronos without passing `forecast_quality` row |
| 9. Mobile chart spaghetti | 12.3 (`12-3-04-PLAN.md`) | Chrome MCP screenshot at iPhone SE 375 renders only 1 forecast + CI; pan/zoom <200ms |
| 10. Anticipation effect in pre-period | 12.4 (`12-4-01-PLAN.md`) | Track-B cutoff = `campaign_start - 7d` default; sensitivity log at `tests/forecast/cutoff_sensitivity.md` |
| 11. Open-Meteo non-commercial ToS | 12.1 (`12-1-02-PLAN.md`) | Production env: `WEATHER_PROVIDER=brightsky`; CI tests Bright Sky path weekly |
| Sample-path memory leak to client | 12.3 (`12-3-01-PLAN.md`) | API endpoint `/api/forecast` returns no jsonb arrays |
| pg_cron MV refresh deadlock | 12.2 (`12-2-01-PLAN.md`) | MV uses `CONCURRENTLY` + unique index; schedule has 5+ min buffer |
| RLS missing on new tables | 12.1 + 12.2 + 12.4 | Acceptance: `select tablename from pg_tables where schemaname='public' and tablename like 'forecast%' or like 'campaign%'` cross-checked against `select tablename from pg_policies` |
| BVG RSS URL changes | 12.1 (`12-1-02-PLAN.md`) + 12.5 (alerting) | CI step `curl -fsS [BVG_RSS_URL]` + parse XML; alert on schema diff |
| `recurring_events.yaml` annual rot | 12.1 (`recurring_events_seed.py`) + 12.5 (pg_cron reminder) | `select * from cron.job where jobname='recurring-events-yearly-reminder'` returns 1 row |
| Hover popup latency on touch | 12.3 (`12-3-03-PLAN.md`) | Mobile QA timer: tap-to-pin <200ms 95th percentile |

---

## Sources

- `12-PROPOSAL.md` §11 (KISS discipline & honest framing rule), §12 (open risks #1-#8), §13 (two-track BAU vs CF), §14 (failure modes + freshness SLO + `pipeline_runs`), §15 (closed-day handling, audit trail), §16 (backtest fairness rules), §17 (last-7-actual-days hover popup), §18 (per-model uplift CI sampling), §20 (timezone/dates/money discipline), §22 (mobile UI defaults) — HIGH confidence (project-internal authoritative document)
- [Open-Meteo Terms of Service](https://open-meteo.com/en/terms) — HIGH confidence (verified 2026-04-27)
- [Open-Meteo Pricing & Commercial Use](https://open-meteo.com/en/pricing) — HIGH confidence
- [Prophet documentation: Seasonality, Holiday Effects, Regressors](https://facebook.github.io/prophet/docs/seasonality,_holiday_effects,_and_regressors.html) — HIGH (yearly_seasonality='auto' threshold of 1 year, not 2)
- [Forecasting: Principles and Practice §12.2 Prophet](https://otexts.com/fpp3/prophet.html) — HIGH (overfitting risk on short series)
- [Skforecast: ARIMA and SARIMAX forecasting](https://skforecast.org/0.14.0/user_guides/forecasting-sarimax-arima.html) — HIGH (SARIMAX requires future exog; leakage modes)
- [statsmodels SARIMAX FAQ](https://www.statsmodels.org/dev/examples/notebooks/generated/statespace_sarimax_faq.html) — HIGH (exog handling)
- [ITS regression-based quasi-experimental approach (PMC4460815)](https://pmc.ncbi.nlm.nih.gov/articles/PMC4460815/) — HIGH (anticipation effects, transition period bias, ≥8 pre + ≥8 post recommendation)
- [ITS for Assessing Causality (PMC12442797)](https://pmc.ncbi.nlm.nih.gov/articles/PMC12442797/) — HIGH (concurrent intervention threats)
- [Bias-Corrected Adaptive Conformal Inference for Multi-Horizon Time Series](https://arxiv.org/html/2604.13253) — MEDIUM (long-horizon coverage degradation)
- [Conformal Prediction Beyond Exchangeability (CMU)](https://www.stat.cmu.edu/~ryantibs/papers/nexcp.pdf) — HIGH (exchangeability assumption violated by time series)
- [Optimizing Materialized View Refresh to Minimize Locks (PostgreSQL)](https://dev.to/divyansh_gupta/optimizing-materialized-view-refresh-to-minimize-locks-in-postgresql-4f76) — MEDIUM (CONCURRENTLY + lock upgrades = deadlock risk)
- [Postgres docs: REFRESH MATERIALIZED VIEW](https://www.postgresql.org/docs/current/sql-refreshmaterializedview.html) — HIGH
- [Chronos zero-shot benchmark vs naive baselines (Amazon Science)](https://www.amazon.science/blog/introducing-chronos-2-from-univariate-to-universal-forecasting) — MEDIUM (zero-shot performance varies by domain; specialized forecasters can still win)
- [Chronos vs Toto: Zero-Shot Forecasting Benchmark (Parseable)](https://www.parseable.com/blog/chronos-vs-toto-forecasting-telemetry-with-mase-crps) — MEDIUM (MASE < 1 vs naive baseline as practical threshold)
- CLAUDE.md project constraints (multi-tenant RLS, $0 budget, mobile-first, GHA cron) — HIGH (project-authoritative)
- `.claude/memory/feedback_layerchart_mobile_scroll.md` + `feedback_svelte5_tooltip_snippet.md` + `feedback_chrome_mcp_ui_qa.md` — HIGH (project-specific known LayerChart 2.x mobile issues already encountered in v1.2)
- `.claude/memory/feedback_sql_cross_check_per_chart.md` — HIGH (per-chart SQL cross-check discipline already a known project pattern; informs the "fair backtest baseline" pitfall)

---
*Pitfalls research for: v1.3 External Data & Forecasting Foundation*
*Researched: 2026-04-27*
