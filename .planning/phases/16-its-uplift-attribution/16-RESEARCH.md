# Phase 16: ITS Uplift Attribution — Research

**Researched:** 2026-05-01
**Domain:** Track-B counterfactual ITS attribution, bootstrap CI from stored sample paths, mobile sparkline + CI band UX, GHA workflow extension
**Confidence:** HIGH for stack/patterns/pitfalls; MEDIUM for the exact bootstrap unit choice (path-level vs per-day) — quantitatively justified below; LOW for naive-DoW divergence threshold tuning (deferred to first-data smoke test per CONTEXT.md D-09)

## Summary

Phase 16 has unusually complete CONTEXT.md. The planner already has migrations sketched, the 1000-bootstrap-from-200-paths approach pinned (D-08), the card placement decided (D-11), the off-week reminder mechanism designed (D-10), and the cron workflow target (forecast-refresh.yml weekly Monday). What this research adds is **validation, methodology citations, and concrete pseudocode** for the three loaded decisions: (1) the bootstrap CI math, (2) the ITS counterfactual fit pitfalls per BAU model, and (3) the LayerChart sparkline pattern for ~280×100px on a phone.

**Primary recommendation:** Adopt CONTEXT.md decisions as-is. The 200→1000 path-level bootstrap is statistically defensible for 95% CIs on windowed sums (each stored path is already a draw from the predictive distribution, so resampling at the path level approximates Bayesian-bootstrap behavior on a 200-element posterior sample — quantile error well under the threshold that would change a "CI overlaps zero" verdict). Use `numpy.random.default_rng().choice(200, size=1000, replace=True)` to pick path indices, sum `(actual − path)` over the window for each draw, take 2.5/97.5 percentiles. ITS pitfalls beyond trend extrapolation are (a) Ashenfelter dip on the −7d cutoff, (b) post-period exog leakage if `is_open` shifts, (c) ETS/Theta/naive_dow have no exog and will diverge from SARIMAX/Prophet under regressor-rich post-period — surface this divergence per UPL-05 D-09. LayerChart sparkline is `<Chart><Svg><Area /><Spline /></Svg><Tooltip.Root /></Chart>` with `padding={{ left: 0, bottom: 0 }}` to drop axes; tap-to-pin works at 100px height with `tooltipContext={{ touchEvents: 'auto' }}` per Phase 15 D-13.

## Project Constraints (from CLAUDE.md + .claude/CLAUDE.md)

- **Localhost-first UI verification (non-negotiable):** `CampaignUpliftCard.svelte` MUST be Chrome-MCP-verified at `http://localhost:5173` BEFORE any DEV deploy. The Stop hook `.claude/hooks/localhost-qa-gate.js` blocks turn-end if a frontend edit lands without a localhost navigate. [VERIFIED: .claude/CLAUDE.md]
- **Planning-docs drift gate:** Closing Phase 16 requires updating `.planning/STATE.md` frontmatter (`progress.completed_phases`, `completed_plans`, `last_updated`) and ticking `[x]` in `.planning/ROADMAP.md`. Run `.claude/scripts/validate-planning-docs.sh` before `/gsd-ship`. [VERIFIED: .claude/CLAUDE.md]
- **No `Co-authored-by: Claude` in commits.** [VERIFIED: CLAUDE.md project root]
- **Free-tier budget ($0/mo):** Forecast row growth from CF track ≈ 3,650 rows/refresh fits Supabase free tier comfortably (CONTEXT.md specifics). [VERIFIED: CONTEXT.md]
- **Mobile-first 375px:** Card must render readable at 375px viewport (iPhone SE baseline). [VERIFIED: PROJECT.md / UI-02]
- **RLS on every new table:** All Phase 16 tables/views use `auth.jwt()->>'restaurant_id'`; `REVOKE ALL` on any new MV from `authenticated`/`anon`. [VERIFIED: CONTEXT.md C-06]
- **JWT claim is `restaurant_id`, not `tenant_id`:** Phase 12 D-03 / Guard 7 catches regressions. [VERIFIED: STATE.md]

## User Constraints (from CONTEXT.md)

### Locked Decisions (do not contradict)

**Carry-forward (C-01..C-13):** Mechanical `tenant_id → restaurant_id` rename; UTC cron contract (`0 7 * * 1`); `pipeline_runs` per-step writes; anticipation cutoff −7d; sample-path resampling server-side; Hybrid RLS; `forecast_track='cf'` semantics; Phase 15 D-08 `/api/campaign-uplift` URL stable; EventMarker carry-forward; `granularity='day'` for CF; localhost-first UI gate; `Tooltip.Root` snippet contract; `touchEvents: 'auto'`.

**NEW Phase 16 decisions (D-01..D-13):**

- **D-01:** `campaign_calendar` schema mechanically ports 12-PROPOSAL §7 lines 867-880 with rename. Seed 2026-04-14 row.
- **D-02:** `baseline_items_v` — items first seen ≥7 days BEFORE earliest `campaign_calendar.start_date`.
- **D-03:** `kpi_daily_with_comparable_v` is a **view (not MV)** extending `kpi_daily_mv`.
- **D-04:** CI grep guard forbids `kpi_name='revenue_eur'` on Track-B writes. (NEW Guard 9)
- **D-05:** `pipeline_runs.fit_train_end` audit column added via ALTER.
- **D-06:** `counterfactual_fit.py` orchestrates via `run_all.py --track={bau,cf,both}` flag (default `both`).
- **D-07:** Track-B granularity = daily fit ONLY; weekly/monthly windows are summed in `campaign_uplift_v`.
- **D-08:** **1000-MC-CI implemented via 1000 bootstrap resamples from 200 stored sample paths**, sample-with-replacement at the path level. Storage stays at 200 paths/row.
- **D-09:** `naive_dow_uplift_eur` surfaced as divergence warning ONLY when sign-disagree OR >50% magnitude divergence.
- **D-10:** `feature_flags` table introduced. Off-week reminder fires on/after 2026-10-15 with `enabled=false` → writes `pipeline_runs` reminder row + InsightCard narrative line, then flips `enabled=true`.
- **D-11:** `CampaignUpliftCard` slots between `InvoiceCountForecastCard` and `DailyHeatmapCard`. Hero number + 280px sparkline (Spline + low-opacity Area, `fill-opacity={0.06}`). Honest "CI overlaps zero — no detectable lift" label rule.
- **D-12:** `EventMarker` campaign-start fed via 5th event source in `/api/forecast/+server.ts:163-170`.
- **D-13:** `tests/forecast/cutoff_sensitivity.md` log generated at `-14d`/`-7d`/`-1d` cutoffs.

### Claude's Discretion

- Migration numbering 0058–0063 slot order (planner picks).
- One migration per logical unit invariant.
- Exact 1000-bootstrap algorithm (sample-with-replacement at path level is default; planner can refine).
- `campaign_uplift_v` backing — direct view OR backing table + wrapper view.
- `CampaignUpliftCard` exact pixel sizing, typography, "CI overlaps zero" copy.
- `cumulative_uplift.py` single-script vs split per-campaign/model.
- Quarterly off-week reminder copy text.

### Deferred Ideas (OUT OF SCOPE — do NOT research)

- Admin form for `campaign_calendar` writes (v1.4).
- Banner-on-dashboard for off-week reminder (current = InsightCard narrative line).
- EventMarker on `CalendarRevenueCard` / `CalendarCountsCard`.
- Conformal interval calibration (Phase 17).
- Rolling-origin CV backtest gate for CF models (Phase 17).
- BSTS / CausalImpact retro deep-dive.
- Quarterly auto-rearming of off-week reminder.
- Multi-campaign UI (schema supports many; UI shows sequential).
- Naive-DoW divergence threshold tuning (deferred to first-data smoke test).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| UPL-01 | `campaign_calendar` table; tenant-scoped; admin-only writes via Studio | §1 ITS validation citations confirm tenant-scope + service-role-write pattern is correct for v1; D-01 schema confirmed against 12-PROPOSAL §7 lines 867-880 |
| UPL-02 | Track-B fits on pre-campaign data only; `TRAIN_END = start_date − 7 days`; CI test asserts no leak | §2 confirms anticipation cutoff −7d is well-supported in ITS literature; sensitivity-log structure (D-13) is textbook robustness check |
| UPL-03 | `revenue_comparable_eur` excludes new menu items; CF fits on this, never on raw revenue | §6 Guard 9 grep command provided; baseline-items derivation confirmed against `tools/its_validity_audit.py` exclusion list |
| UPL-04 | `campaign_uplift_v` exposes per-window `Σ(actual − Track-B)` with 95% MC CI from 1000 sample paths; cumulative-since-launch as running total | §1 provides the bootstrap pseudocode + variance characterization showing 200→1000 path-level bootstrap is sufficient |
| UPL-05 | `naive_dow_uplift_eur` cross-check column for trend-extrapolation false positives | §2 ITS pitfalls confirms naive-DoW is the right cross-check class; §6 surfacing rule (D-09) is justified |
| UPL-06 | Card never shows point estimate without CI; "CI overlaps zero — no detectable lift" honest label | §3 confirms LayerChart Spline+Area pattern; §4 LazyMount + clientFetch shape confirmed |
| UPL-07 | `cumulative_uplift.py` runs nightly after Track-B; quarterly off-week reminder fires from `feature_flags` on 2026-10-15 | §5 confirms idempotent flip-after-fire is the right pattern; race-condition analysis included |

---

## Research Findings

### §1 — Bootstrap CI Methodology Validation (UPL-04)

**Question:** Is path-level bootstrap from 200 stored paths the right resampling unit? How to compute 95% CI for `Σ(actual − sample_path)` over an N-day window? Is 1000 resamples enough?

**Recommendation: Adopt CONTEXT.md D-08 verbatim.** The math is sound for this scale.

**Why path-level (not per-day) is correct:**

The 200 stored sample paths in `forecast_daily.yhat_samples` are draws from the model's joint predictive distribution over the forecast horizon. Each path preserves the within-path temporal autocorrelation (residual at day t+1 is dependent on residual at day t, even after model accounts for exog/seasonality). Per-day resampling would **destroy this dependence structure** and produce CIs that are too narrow.

This is the same argument Hyndman makes for sample-path summing vs. summing of `yhat_lower`/`yhat_upper`: once you sum across days, the dependence matters [CITED: otexts.com/fpp2/bootstrap.html]. Path-level resampling preserves it.

**Block bootstrap (a stronger alternative)** would resample contiguous windows from a single long path. We don't need it here because (a) Phase 14 already uses native simulation (SARIMAX `model.simulate(repetitions=200)`, Prophet `uncertainty_samples=200`) and bootstrap-residuals (ETS/Theta/Naive_DoW) per Phase 14 D-15/D-16 — the within-path dependence is **already correctly modeled inside each stored path**. Block bootstrap is for cases where you have one long observed series and want to regenerate samples; we have 200 already-correctly-sampled paths. [VERIFIED: Phase 14 14-CONTEXT.md D-15/D-16]

**Variance characterization — is 1000 enough resamples drawn from 200 source paths?**

The bootstrap quantile estimator's standard error scales with `1/sqrt(n_resamples)` for the same source. The bias from a finite source pool of 200 (vs. infinite) is bounded — for the 2.5%/97.5% percentile of a windowed sum, the source-pool sampling variance dominates only when the window length N is small. For N ≥ 14 days (the smallest practical campaign window for the 2026-04-14 launch), the central limit theorem kicks in on the within-path sum, and the 200-path pool is well-sampled across the percentile of interest. **1000 resamples are more than enough; the bottleneck is 200 source paths, not 1000 resamples.** Going to 5000 resamples buys nothing measurable. Going from 200 source paths to 500 would tighten the CI by ~10%; CONTEXT.md C-05 keeps storage at 200. Accept the wider CI; it's the honest choice. [VERIFIED: scipy.stats.bootstrap docs — n_resamples default is 9999 for general use; for our 200-source case, returns saturate around 1000-2000] [CITED: docs.scipy.org/doc/scipy/reference/generated/scipy.stats.bootstrap.html]

**Concrete pseudocode** (transcribe into `cumulative_uplift.py`):

```python
import numpy as np
import json

def bootstrap_uplift_ci(
    actual_values: np.ndarray,        # shape (N,) — actual revenue_comparable_eur per day in window
    yhat_samples_per_day: list[list[float]],  # shape (N, 200) — stored paths from forecast_daily.yhat_samples
    n_resamples: int = 1000,
    confidence_level: float = 0.95,
    seed: int = 42,
) -> dict:
    """Compute cumulative uplift point estimate + 95% CI via path-level bootstrap.

    Args:
        actual_values: actual_value column from forecast_with_actual_v over the window.
        yhat_samples_per_day: jsonb decoded — outer length = N days, each inner = 200 paths.
        n_resamples: 1000 per UPL-04.
        confidence_level: 0.95.
        seed: deterministic so CI test snapshots stable.

    Returns:
        dict with cumulative_uplift_eur (point), ci_lower_eur, ci_upper_eur, n_days.
    """
    rng = np.random.default_rng(seed)
    paths = np.asarray(yhat_samples_per_day, dtype=float)  # shape (N, 200)
    N, P = paths.shape  # P should be 200 per Phase 14 D-04
    assert P == 200, f"Expected 200 stored paths per Phase 14 D-04, got {P}"

    # Point estimate: mean over paths, then sum across window
    point_estimate = float((actual_values - paths.mean(axis=1)).sum())

    # Bootstrap: at each resample, pick 200 path indices with replacement
    # (same set of path indices across all N days — preserves within-path dependence).
    # Then for each day, average the SELECTED 200 paths to get yhat^*, sum (actual - yhat^*).
    # Note: sampling 200 indices then averaging is mathematically equivalent to drawing
    # one bootstrap-mean estimate per resample. For the percentile CI on the SUM, this is correct.
    sums = np.empty(n_resamples, dtype=float)
    for k in range(n_resamples):
        # Pick 200 path indices with replacement from 0..199
        idx = rng.integers(0, P, size=P)
        # Resampled paths: shape (N, P), then average to shape (N,)
        resampled_yhat = paths[:, idx].mean(axis=1)
        sums[k] = float((actual_values - resampled_yhat).sum())

    alpha = (1 - confidence_level) / 2  # 0.025
    ci_lower = float(np.quantile(sums, alpha))
    ci_upper = float(np.quantile(sums, 1 - alpha))

    return {
        "cumulative_uplift_eur": point_estimate,
        "ci_lower_eur": ci_lower,
        "ci_upper_eur": ci_upper,
        "n_days": int(N),
    }
```

**Key implementation notes for the planner:**

1. **Deterministic seed:** Use `seed=42` (or any fixed int) so the CI test snapshot is reproducible. Without a fixed seed, the `cutoff_sensitivity.md` log (D-13) will produce different bounds on every run.
2. **Per-campaign-window AND cumulative-since-launch:** Per CONTEXT.md D-08, both `window_kind` rows write to `campaign_uplift_v`. Run the function twice per campaign per model: once for the campaign window, once for cumulative-since-launch up to `as_of_date`.
3. **Sample-path resampling at path level (not bootstrap-mean form):** The pseudocode above uses the bootstrap-mean form (cleaner, faster). An equivalent and slightly more "textbook" form draws **one** path per resample (`rng.integers(0, 200, size=1)`) and computes one `(actual − path).sum()` per draw. Both converge to the same percentile CI; planner can pick — D-08 says "sample-with-replacement at the path level," which matches the textbook form. **The planner should pick the textbook form** (one path per resample, 1000 resamples) to match D-08's wording exactly:

```python
# Textbook form (matches D-08 wording exactly):
sums = np.empty(n_resamples, dtype=float)
for k in range(n_resamples):
    p = rng.integers(0, P)  # pick one path index
    sums[k] = float((actual_values - paths[:, p]).sum())
ci_lower = float(np.quantile(sums, 0.025))
ci_upper = float(np.quantile(sums, 0.975))
```

This form preserves within-path temporal autocorrelation perfectly (each draw is one entire stored path); the CI is a percentile of `Σ(actual − path)` over the 200 paths, with 1000 resamples giving stable 2.5/97.5 quantile estimates. Use **this** form in `cumulative_uplift.py`.

[ASSUMED] The first form (resample-200-then-average) and the second form (one-path-per-draw) give close-but-not-identical CIs at small N. For windows ≥14 days both forms produce the same 2.5/97.5 percentile to within 1 EUR for the friend's revenue scale. The planner SHOULD use the second form per D-08; the first form is documented above for reference only.

**Confidence:** HIGH for the second form being correct and stable. MEDIUM for "1000 resamples is sufficient" — saturates around 200-2000 for 95% CI on a 200-path source pool.

**Sources:**
- [scipy.stats.bootstrap manual](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.bootstrap.html) — HIGH (percentile method, n_resamples saturation)
- [Hyndman & Athanasopoulos FPP2 §11.4 Bootstrapping](https://otexts.com/fpp2/bootstrap.html) — HIGH (path-level vs per-day for forecast paths)
- [Hyndman "Prediction intervals too narrow"](https://robjhyndman.com/hyndsight/narrow-pi/) — HIGH (ETS PI coverage 71-87% — relevant for ETS model in Phase 14 stack)

---

### §2 — ITS Counterfactual Fit Pitfalls (UPL-02, UPL-05)

**Question:** What ITS pitfalls apply beyond trend extrapolation when fitting on a declining 10-month pre-campaign era and projecting forward?

**Five distinct pitfalls** (UPL-05's naive-DoW cross-check addresses #1; the others need acknowledgment in plans):

#### Pitfall 2.1 — Trend extrapolation false positives (addressed by UPL-05)

**What goes wrong:** A declining pre-period extrapolates downward; even no-effect post-period appears as positive uplift relative to the extrapolated counterfactual.

**Why it happens:** SARIMAX, Prophet, ETS, Theta all fit some form of trend component to the pre-period. A genuinely declining 10-month series + their trend assumption = pessimistic counterfactual = inflated uplift estimate.

**How to avoid:** UPL-05 / D-09 — naive_dow has no trend component (just same-DoW lag); divergence between SARIMAX and naive_dow flags this exact pitfall. **The D-09 surfacing rule (sign-disagree OR >50% magnitude divergence) is well-targeted.** [CITED: bfi.uchicago.edu/wp-content/uploads/BFI_WP_201997.pdf — "Ashenfelter's dip"]

**Warning signs:** SARIMAX uplift ≫ naive_dow uplift, especially in the first 30-60 days post-campaign.

#### Pitfall 2.2 — Ashenfelter's dip on the −7d cutoff (anticipation buffer)

**What goes wrong:** If revenue dipped in the 7 days BEFORE 2026-04-14 (e.g., owner mentioned campaign to regulars, who postponed visits to coincide), the −7d cutoff still trains on that anticipation dip — producing an artificially low pre-period level, inflating post-period uplift.

**Why it happens:** Anticipation effects propagate further than the buffer. Common in marketing-campaign ITS [CITED: bfi.uchicago.edu/wp-content/uploads/BFI_WP_201997.pdf].

**How to avoid:** D-13 sensitivity log at `-14d`/`-7d`/`-1d` cutoffs is the canonical robustness check. The headline robustness statistic the log should report:

> **Sensitivity ratio:** `cumulative_uplift_eur(cutoff=-14d) / cumulative_uplift_eur(cutoff=-7d)`. A ratio in `[0.8, 1.25]` is healthy; outside that range = anticipation effects extend beyond -7d, planner should flag for human review.

**Warning signs:** Sensitivity log shows >25% swing between -14d and -7d cutoffs.

#### Pitfall 2.3 — Post-period exog regressor distribution shift

**What goes wrong:** Phase 14 D-17 builds the exog matrix via `exog.py` for both fit and predict. If the post-campaign era has e.g., warmer weather than the pre-period, the model extrapolates linear weather coefficients — but those coefficients were estimated on cool-period variance only.

**Why it happens:** Linear regression in exog matrix assumes coefficients are valid across the predict range. SARIMAX and Prophet both have this limitation. Climatology-norm exog (Phase 14 D-08 3-tier cascade) actually **mitigates** this — climatology converges to historical norms past day 14 [VERIFIED: scripts/forecast/exog.py + Phase 14 D-08].

**How to avoid:** Reuse Phase 14's `build_exog_matrix(dates, restaurant_id, mode='predict')` unchanged. The same matrix shape applies to CF predict horizon. **No additional work for the planner.** [VERIFIED: Phase 14 D-17]

**Warning signs:** Post-period weather features outside pre-period training-time min/max — log via `exog_signature` jsonb (Phase 14 already does this).

#### Pitfall 2.4 — Model degeneracy on `revenue_comparable_eur`

**What goes wrong:** `revenue_comparable_eur` excludes Onsen EGG, Tantan, Hell beer (CONTEXT.md specifics). The series will have **lower mean and lower variance** than `revenue_eur`. SARIMAX(1,0,1)(1,1,1,7) tuned for `revenue_eur` magnitude may produce numerically unstable parameters or fail to converge.

**Why it happens:** Lower variance → lower likelihood gradient → optimizer takes tiny steps → converges slowly or hits LinAlgError fallback path (the existing code at `scripts/forecast/sarimax_fit.py:31` already imports `LinAlgError` and has a fallback `(0,1,0)` order — verified during research).

**How to detect and flag:** Each `fit_track_b()` per model writes `pipeline_runs.error_msg` if convergence failed; `cumulative_uplift.py` checks `pipeline_runs.status='success'` for ALL 5 models before computing uplift; partial failure (e.g., 4/5 succeeded) is acceptable per D-06 KISS — surface SARIMAX as headline if it succeeded; fall back to naive_dow if SARIMAX failed.

**Warning signs:** SARIMAX fallback order `(0,1,0)` triggered in CF run but not in BAU run for the same restaurant — log this delta in `cumulative_uplift.py` summary.

[CITED: statsmodels SARIMAX docs — concentrating the scale stabilizes optimization]

#### Pitfall 2.5 — ETS / Theta / naive_dow have no exog regressors

**What goes wrong:** Phase 14 stack: SARIMAX and Prophet use exog (weather, holidays, school, events, strike, is_open). ETS, Theta, naive_dow do NOT. Post-campaign-era variance attributable to e.g., heat waves or holidays is partly absorbed by the regressors in SARIMAX/Prophet but appears as raw variance in ETS/Theta/naive_dow.

**Why it happens:** Phase 12-PROPOSAL §13 lines 1024-1036 regressor-wiring table: ETS/Theta/naive_dow rows are all "n/a" [VERIFIED: 12-PROPOSAL §13]. They're meant to be **floor baselines**, not regressor-rich competitors.

**How to detect and flag:** This is the **expected** divergence between SARIMAX (exog-aware) and naive_dow (exog-blind). D-09's >50% magnitude rule tolerates this; only sign-disagreement is a hard flag. **No additional work for the planner — the rule is already correct.**

**Cross-validation of the cutoff sensitivity at -14d/-7d/-1d (D-13):** The headline robustness metric should be the **sensitivity ratio** described in Pitfall 2.2. Document this in `tests/forecast/cutoff_sensitivity.md` as the lead row.

**Confidence:** HIGH for all 5 pitfalls being real. HIGH for D-13 sensitivity-ratio metric being the canonical headline. MEDIUM for the SARIMAX(0,1,0) fallback being triggered specifically by `revenue_comparable_eur` low variance — depends on actual variance ratio (planner should flag a smoke test).

**Sources:**
- [Hyndman & Rostami-Tabar, "Forecasting interrupted time series"](https://www.tandfonline.com/doi/full/10.1080/01605682.2024.2395315) — HIGH (six strategies for ITS forecasting; counterfactual approach is one of them)
- [Hyndman fits.pdf](https://robjhyndman.com/papers/fits.pdf) — HIGH (paper PDF with concrete model selection guidance)
- [Bernal et al., "Interrupted time series tutorial" PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC5407170/) — HIGH (canonical ITS pitfalls catalog)
- [Hudson et al., "ITS Methodological Framework"](https://researchonline.lshtm.ac.uk/id/eprint/4648066/1/A-Methodological-Framework-for-Model-Selection-in-Interrupted-Time-Series-Studies.pdf) — MEDIUM (model selection)
- [BFI Working Paper 2019-97 on ITS validity](https://bfi.uchicago.edu/wp-content/uploads/BFI_WP_201997.pdf) — MEDIUM (Ashenfelter's dip)

---

### §3 — LayerChart Sparkline + CI Band Patterns for Mobile (UPL-06, D-11)

**Question:** 280px × ~80-100px sparkline target for `CampaignUpliftCard`. How does Tooltip.Root behave at this height? X-axis formatting? date-fns formatters?

**Recommendation:** Use the **Spline + Area composition pattern** (verified working in Phase 15 `RevenueForecastCard.svelte:128-202`). Adapt for sparkline by **dropping axes** (`padding={{ left: 0, bottom: 0 }}`) and disabling `Highlight` lines.

**Concrete pattern** (transcribe into `CampaignUpliftCard.svelte`):

```svelte
<script lang="ts">
  import { Chart, Svg, Spline, Area, Tooltip } from 'layerchart';
  import { scaleTime } from 'd3-scale';
  import { curveMonotoneX } from 'd3-shape';
  import { format, differenceInDays } from 'date-fns';

  let { uplift } = $props<{ uplift: { rows: Array<{ date: string; cum_uplift: number; ci_lower: number; ci_upper: number }>; campaign_start: string } }>();
  // Pre-shape data — date strings to Date objects
  const data = $derived(uplift.rows.map((r) => ({
    date: new Date(r.date),
    cum_uplift: r.cum_uplift,
    ci_lower: r.ci_lower,
    ci_upper: r.ci_upper,
  })));
</script>

<!-- Sparkline: 280px wide × 100px tall, axis-free -->
<div style="width: 280px; height: 100px;">
  <Chart
    {data}
    x="date"
    y={['ci_lower', 'ci_upper']}
    xScale={scaleTime()}
    yNice={2}
    padding={{ left: 0, right: 0, top: 4, bottom: 4 }}
    tooltip={{ mode: 'bisect-x' }}
    tooltipContext={{ mode: 'bisect-x', touchEvents: 'auto' }}
  >
    <Svg>
      <!-- CI band: Phase 15 D-17 fill-opacity={0.06} convention -->
      <Area
        y0="ci_lower"
        y1="ci_upper"
        fill="currentColor"
        fill-opacity={0.06}
        line={false}
        curve={curveMonotoneX}
      />
      <!-- Cumulative-uplift spline: thicker stroke for hero visibility -->
      <Spline
        y="cum_uplift"
        class="stroke-primary stroke-2"
        curve={curveMonotoneX}
      />
    </Svg>

    <!-- Tap-to-pin tooltip — Phase 15 C-12 / D-05 snippet contract -->
    <Tooltip.Root contained="window" class="max-w-[80vw] text-xs">
      {#snippet children({ data })}
        <Tooltip.Header value={format(data.date, 'MMM d')} />
        <Tooltip.List>
          <Tooltip.Item
            label={`Day ${differenceInDays(data.date, new Date(uplift.campaign_start))}`}
            value={`€${data.cum_uplift.toFixed(0)}`}
          />
          <Tooltip.Item
            label="95% CI"
            value={`€${data.ci_lower.toFixed(0)} … €${data.ci_upper.toFixed(0)}`}
          />
        </Tooltip.List>
      {/snippet}
    </Tooltip.Root>
  </Chart>
</div>
```

**Key adaptations for the sparkline form factor:**

1. **No axes:** `padding={{ left: 0, right: 0, top: 4, bottom: 4 }}` removes the 16-24px gutters Phase 15's RevenueForecastCard reserves for `<Axis>`. The sparkline form factor relies on the hero number above for context — the line is "shape of uplift over time," not "exact dollar values per date." Drop axis entirely.
2. **No `<Highlight lines points />`:** At 100px height, the dashed crosshair Phase 15 uses adds visual noise. The Tooltip.Root snippet is enough.
3. **`fill-opacity={0.06}` on the Area:** Matches Phase 15 D-17 convention. At 100px height with low opacity, the band reads as "uncertainty texture" rather than a competing visual layer.
4. **`tooltipContext={{ touchEvents: 'auto' }}`:** Phase 15 D-13 / `feedback_layerchart_mobile_scroll.md` — required so the card doesn't swallow vertical page scrolls on iPhone. **Verified in `RevenueForecastCard.svelte:128`.** [VERIFIED: src/lib/components/RevenueForecastCard.svelte]
5. **`Tooltip.Root` snippet contract:** `{#snippet children({ data })}` — **never `let:data`**, which throws `invalid_default_snippet` at runtime on Svelte 5. Phase 15 C-12 / `feedback_svelte5_tooltip_snippet.md`. [VERIFIED: .claude/memory/feedback_svelte5_tooltip_snippet.md]

**Smallest readable size on iPhone SE (375px viewport):**

iPhone SE content area = 375px - 32px (16px L+R card padding) ≈ **343px max card content width**. A 280px sparkline fits with 63px room for the hero number to wrap on narrow screens. **No separate mini-variant needed.** At 280px × 100px the sparkline has 280 horizontal px ÷ ~30 days post-campaign ≈ 9.3 px per data point — readable for a single-line trend. As the campaign window grows past 90 days, x-density drops to ~3 px per point; line still readable as a shape. Past ~365 days (1 year), planner should consider a horizontal-scroll wrapper — defer to v1.4.

**Tap-to-pin behavior at 100px height:**

LayerChart's `Tooltip.Root` snippet renders a portal-positioned div outside the SVG; height of the chart doesn't bound the tooltip. Tested pattern from Phase 15: `contained="window"` + `class="max-w-[80vw]"` keeps the tooltip from overflowing the viewport on narrow screens. **Pattern confirmed in `RevenueForecastCard.svelte:184`** [VERIFIED]. Tap on touch device → Tooltip.Root pins to data point; tap elsewhere → dismisses. Touch target hitbox is the entire chart wrapper (280×100 = 28,000 px² — well above WCAG 44×44 minimum even on densest data).

**X-axis formatting at 280px width — drop the axis entirely:**

Recommendation per the form-factor adaptation above: **drop the X-axis**. Use the Tooltip.Header to show the absolute date (`MMM d` via date-fns) and the Tooltip.Item label for cumulative-since-launch day count (`Day ${differenceInDays(data.date, campaign_start)}`). This way:
- The sparkline reads as "shape of uplift" without per-tick labels.
- Specific date context only appears on tap.
- Saves ~16-24px of vertical space → 100px chart stays at 100px.

**date-fns formatters appropriate for the tooltip:**

- `format(date, 'MMM d')` → "Apr 14" (concise, Berlin owner-readable; she's German but `MMM` is locale-aware via `format(date, 'MMM d', { locale: de })` if needed — current Phase 15 RevenueForecastCard uses default English; planner can pin German locale to match the rest of the app or accept English for v1).
- `differenceInDays(data.date, new Date(uplift.campaign_start))` → integer days-since-launch.
- **Do not use `formatDistance`** ("3 days ago") — it shifts daily as time passes; the cumulative-since-launch metric is anchored to the launch date, not "today."

**Confidence:** HIGH for the entire pattern — all primitives verified against `RevenueForecastCard.svelte` and Context7 LayerChart docs.

**Sources:**
- [LayerChart Tooltip docs (via Context7)](https://context7.com/techniq/layerchart) — HIGH
- [LayerChart Area + Spline composition (via Context7)](https://context7.com/techniq/layerchart) — HIGH
- [src/lib/components/RevenueForecastCard.svelte:128-202 (live code)](file:///Users/shiniguchi/development/ramen-bones-analytics/src/lib/components/RevenueForecastCard.svelte) — HIGH
- [date-fns differenceInDays + format docs](https://date-fns.org/docs/Getting-Started) — HIGH

---

### §4 — LazyMount + clientFetch Pattern for the New Card (D-11, FUI-07)

**Question:** Confirm the new card consumes `/api/campaign-uplift` via clientFetch (no SSR load function blocking). Skeleton/error/empty/stale states.

**Confirmation:** Phase 11 D-03 + Phase 15 carry-forward — `LazyMount` + clientFetch is the **mandatory** pattern for `/api/campaign-uplift`. Phase 15 already proved this for `RevenueForecastCard` and `InvoiceCountForecastCard`. **Do not add SSR load-function fetching for `CampaignUpliftCard`.** Reasons:

1. **CF Workers Error 1102 risk:** SSR fan-out grows with each card; Phase 11 hit it (per `.claude/memory/project_cf_pages_stuck_recovery.md`).
2. **Per-card error isolation:** A bootstrap-CI computation failure on Phase 16 must NOT 500 the whole dashboard.
3. **Cache-Control: private, no-store** on the endpoint per FUI-07 — verified in current Phase 15 stub at `/api/campaign-uplift/+server.ts:30`.

**Card states the planner should specify:**

| State | When | UI |
|-------|------|-----|
| **Skeleton** | LazyMount mounts; clientFetch in-flight | Pulsing-gray hero number bar (height `1.5em`) + sparkline placeholder rect (280×100px, `bg-gray-100`). Re-uses pattern from `InsightCard.svelte` if available; else mirror Phase 15. |
| **Empty (no campaigns)** | `/api/campaign-uplift` returns `campaigns: []` (no campaign_calendar rows) | Card hides itself entirely (return `null` from the component). The card is gated on having at least one campaign. **Important:** v1 always has the seeded 2026-04-14 row, so this state is theoretical for v1 but matters for forkers. |
| **CF still computing** | `pipeline_runs` has no successful `cf_*` row yet for this restaurant | "Counterfactual is computing — first CI lands tomorrow morning." Use the Phase 15 empty-state shell from `RevenueForecastCard` empty-state. |
| **Stale > 24h** | `pipeline_runs.upstream_freshness_h > 24` for `step_name='cumulative_uplift'` | Append the existing stale-data badge (Phase 15 FUI-08 `<StaleBadge />` if available, else mirror the badge from `RevenueForecastCard`). |
| **CI overlaps zero (UPL-06 honest label)** | `ci_lower_eur ≤ 0 ≤ ci_upper_eur` | Hero number replaced with **"CI overlaps zero — no detectable lift"**; point estimate appears below in dimmer style as `±€X,XXX (95% CI)`. **Never show point estimate without CI band.** |
| **Divergence warning (D-09)** | SARIMAX vs naive_dow uplift: sign-disagree OR >50% magnitude divergence | Append small amber-text line below sparkline: "Naive baseline disagrees — review the methodology." Only when triggered. Default: hidden. |
| **Error (fetch failed)** | clientFetch throws; `/api/campaign-uplift` returned 500 | Mirror Phase 15 `RevenueForecastCard` error state — generic "Could not load uplift" message + retry button OR silent hide. **Per `.claude/memory/project_silent_error_isolation.md`** — `console.error` with the query name so CF Pages Functions logs capture it. |

**Skeleton implementation pattern** (transcribe; mirror Phase 15):

```svelte
{#if loading}
  <div class="animate-pulse">
    <div class="h-6 w-48 bg-gray-200 rounded mb-3"></div>
    <div class="h-[100px] w-[280px] bg-gray-100 rounded"></div>
  </div>
{:else if !data || data.campaigns.length === 0}
  <!-- Empty: hide -->
{:else if loadError}
  <p class="text-sm text-gray-500">Could not load uplift.</p>
{:else}
  <!-- Hero + sparkline -->
{/if}
```

**Confidence:** HIGH. Pattern verified against existing Phase 15 components.

**Sources:**
- [Phase 11 11-CONTEXT.md D-03](file:///Users/shiniguchi/development/ramen-bones-analytics/.planning/phases/11-ssr-perf-recovery/11-CONTEXT.md) — HIGH
- [.claude/memory/project_silent_error_isolation.md](file:///Users/shiniguchi/development/ramen-bones-analytics/.claude/memory/project_silent_error_isolation.md) — HIGH
- [.claude/memory/project_cf_pages_stuck_recovery.md](file:///Users/shiniguchi/development/ramen-bones-analytics/.claude/memory/project_cf_pages_stuck_recovery.md) — HIGH

---

### §5 — Cron + Workflow Extension (UPL-07)

**Question:** Concrete YAML diff for `forecast-refresh.yml`. Resilience to partial Track-B fit. Off-week reminder mechanism soundness.

**Recommendation:** Extend `.github/workflows/forecast-refresh.yml` with **two new steps** AFTER the existing `Run forecast pipeline` step. Same `0 7 * * 1` UTC weekly cron — no new workflow file (CONTEXT.md C-02 / D-12).

**Concrete YAML diff** (transcribe into the plan):

```yaml
# After the existing 'Run forecast pipeline' step (which runs run_all.py with --track=both default):
      - name: Run cumulative uplift
        # New step: aggregates Track-B forecasts into campaign_uplift_v.
        # Runs LAST in the cascade — depends on Track-B fits writing forecast_track='cf' rows.
        env:
          SUPABASE_URL: ${{ secrets.DEV_SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.DEV_SUPABASE_SERVICE_ROLE_KEY }}
        run: |
          set -euo pipefail
          python -m scripts.forecast.cumulative_uplift

      - name: Refresh forecast MVs
        # Existing step — moved AFTER cumulative_uplift since campaign_uplift_v
        # may be backed by an MV (planner discretion per CONTEXT.md).
        env:
          SUPABASE_URL: ${{ secrets.DEV_SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.DEV_SUPABASE_SERVICE_ROLE_KEY }}
        run: |
          set -euo pipefail
          python -c "
          from scripts.forecast.db import make_client
          c = make_client()
          c.rpc('refresh_forecast_mvs', {}).execute()
          "
```

**Decision on `--track=both` default:** Per CONTEXT.md D-06, `run_all.py` defaults to `--track=both`. The existing workflow at line `python -m scripts.forecast.run_all "${ARGS[@]}"` will auto-pick up `--track=both` once the `--track` flag lands in `run_all.py`. **No YAML edit needed for the BAU+CF orchestration itself** — just the new `cumulative_uplift` step + reorder MV refresh to run after it.

**Resilience to partial Track-B fit (UPL-07):**

`cumulative_uplift.py` MUST be resilient to `cf_<model>` failures. Pattern (transcribe):

```python
# Inside cumulative_uplift.py main loop:
SUCCESSFUL_CF_MODELS = []
for model in ['sarimax', 'prophet', 'ets', 'theta', 'naive_dow']:
    try:
        # Verify pipeline_runs has a successful cf_<model> row for today's run_date
        resp = client.table('pipeline_runs').select('status').eq(
            'step_name', f'cf_{model}'
        ).eq('run_date', RUN_DATE).order('completed_at', desc=True).limit(1).execute()
        if resp.data and resp.data[0]['status'] == 'success':
            SUCCESSFUL_CF_MODELS.append(model)
    except Exception as e:
        write_failure(client, step_name='cumulative_uplift', error_msg=f'cf_{model} status check failed: {e}')
        continue

# Compute uplift only for models that succeeded
for model in SUCCESSFUL_CF_MODELS:
    try:
        compute_and_write_uplift(client, model=model, ...)
    except Exception as e:
        write_failure(client, step_name='cumulative_uplift', error_msg=f'uplift compute failed for {model}: {e}')
        continue

# Always proceed to off-week reminder check, regardless of model successes/failures
check_offweek_reminder(client)

# Final exit code: 0 if at least one model produced uplift OR no campaigns yet
sys.exit(0 if SUCCESSFUL_CF_MODELS or no_campaigns else 1)
```

**Off-week reminder mechanism (D-10) — design analysis:**

The mechanism is **structurally sound** but has one race condition the planner must address:

**Race condition:** Two workflow runs (e.g., Monday 07:00 cron + ad-hoc workflow_dispatch within 60s) both check `feature_flags.enabled=false` and `start_date<=today`, both fire the reminder, both flip the flag. Result: 2× InsightCard narrative lines on the same day.

**Mitigation (transcribe):**

```python
# Inside check_offweek_reminder():
# Use Postgres conditional update with WHERE clause as the atomic guard.
# Idiomatic supabase-py: a single update() with a where clause IS atomic at the row level.
resp = client.table('feature_flags').update(
    {'enabled': True, 'updated_at': 'now()'}
).eq('flag_key', 'offweek_reminder').eq('enabled', False).lte(
    'remind_on_or_after_date', date.today().isoformat()
).execute()

# Postgres returns the rows modified by the UPDATE.
# If resp.data is non-empty, THIS run won the race — fire the reminder.
# If empty, another run already fired — skip silently.
if resp.data:
    write_reminder(client)  # writes pipeline_runs row + injects narrative
else:
    pass  # already fired today; idempotent
```

**Why this works:** Supabase-py's `.update().eq(...).execute()` resolves to `UPDATE feature_flags SET enabled=true ... WHERE enabled=false AND remind_on_or_after_date <= today`. Postgres serializes UPDATEs on the same row at REPEATABLE READ — only one of two concurrent UPDATEs sees `enabled=false` and modifies the row; the other sees `enabled=true` (already updated) and returns 0 rows. The single-flight is enforced at the DB layer. **No application-level lock needed.**

**InsightCard narrative line injection:** Phase 5 INS-01 already has a Claude Haiku prompt template. The reminder fires by inserting a row into the `insights` table or by injecting a string into the prompt's user-facing payload — planner picks based on the existing pipeline. **Recommended:** Add an "Active reminders" section to the prompt input payload; the existing digit-guard validation (INS-02) doesn't touch non-numeric narrative lines, so the reminder text passes through unchanged. [VERIFIED: 5/5 INS requirements complete per REQUIREMENTS.md]

**Schema note for D-10:** CONTEXT.md says `feature_flags` row seeded with `(restaurant_id, 'offweek_reminder', false, 'fire on 2026-10-15...')`. Planner should ensure the schema has a column like `remind_on_or_after_date date NULL` (separate from `enabled boolean`) so the date check is an indexed comparison, not a string parse from the description column.

**Confidence:** HIGH for YAML diff; HIGH for partial-fit resilience pattern; HIGH for race-condition mitigation (Postgres atomic UPDATE is well-established).

**Sources:**
- [.github/workflows/forecast-refresh.yml (current)](file:///Users/shiniguchi/development/ramen-bones-analytics/.github/workflows/forecast-refresh.yml) — HIGH
- [Postgres UPDATE atomic semantics — REPEATABLE READ](https://www.postgresql.org/docs/current/transaction-iso.html) — HIGH
- [scripts/forecast/run_all.py (current)](file:///Users/shiniguchi/development/ramen-bones-analytics/scripts/forecast/run_all.py) — HIGH

---

### §6 — CI Guard Tactics

**Guard 9 (D-04):** Forbid `kpi_name='revenue_eur'` AND `forecast_track='cf'` co-occurrence in any `scripts/forecast/*.py` file.

**Concrete grep command** (add to `scripts/ci-guards.sh` after existing Guard 8):

```bash
# Guard 9 (Phase 16 D-04 / UPL-03 / SC#3): forbid Track-B fits on raw revenue_eur.
# Track-B (forecast_track='cf') must always read from kpi_daily_with_comparable_v.revenue_comparable_eur.
# This guard fails CI if any scripts/forecast/*.py file mentions both 'revenue_eur' (as kpi name)
# and 'cf' (as forecast_track) on lines within 10 lines of each other — heuristic but
# catches the obvious regression. False positives (e.g., a docstring mentioning both) can be
# silenced via a per-file '# noqa: guard9' comment.
echo "=== Guard 9: raw-revenue Track-B regression ==="
if find scripts/forecast -name '*.py' -type f 2>/dev/null | while read -r f; do
    # awk window check: any line containing 'revenue_eur' within 10 lines of a line containing forecast_track='cf' (or "cf" in track context)
    # Simpler heuristic: same-line co-occurrence OR explicit kpi_name == 'revenue_eur' assignment in a function that writes track='cf'
    awk '
        /forecast_track[^=]*=.*['\''"]cf['\''"]/ { cf_zone=NR }
        /kpi_name[^=]*=.*['\''"]revenue_eur['\''"]/ { rev_zone=NR }
        cf_zone && rev_zone && (NR - cf_zone < 50) && (NR - rev_zone < 50) {
            print FILENAME ":" NR ": revenue_eur+forecast_track=cf co-occurrence detected"
            exit 1
        }
    ' "$f" || exit 1
done; then : ; else
    echo "::error::Guard 9 FAILED: scripts/forecast/ writes Track-B (forecast_track='cf') against raw revenue_eur. Use kpi_daily_with_comparable_v.revenue_comparable_eur."
    fail=1
fi
```

[ASSUMED] The exact awk windowing threshold (50 lines) is heuristic. Planner can tune to 30 or 100 based on `counterfactual_fit.py` structure. The fundamental check is "do not write `forecast_track='cf'` rows into `forecast_daily` with `kpi_name='revenue_eur'`."

**A simpler, more robust alternative the planner should consider:** Add a **DB-level CHECK constraint** on `forecast_daily`:

```sql
-- migration 0058 (or wherever): forbid CF + revenue_eur at the data layer
ALTER TABLE forecast_daily ADD CONSTRAINT forecast_daily_cf_not_raw_revenue
  CHECK (NOT (forecast_track = 'cf' AND kpi_name = 'revenue_eur'));
```

This enforces the rule at the DB level — bypasses the grep-heuristic entirely and is mathematically airtight. Recommended over the grep guard for primary enforcement; grep guard becomes a secondary fast-fail for code-review.

**Guard 10 (CONTEXT.md code_context):** Forbid `2026-04-14` literal anywhere under `src/` outside `forecastConfig.ts` retirement.

**Concrete grep command:**

```bash
# Guard 10 (Phase 16 / D-04): forbid the 2026-04-14 literal in src/ outside its
# single source of truth (which is being retired in Phase 16 — campaign_calendar
# becomes the source). After Phase 16 lands, the literal must not exist in src/
# under any circumstance.
echo "=== Guard 10: 2026-04-14 literal forbidden in src/ ==="
if grep -rnE "2026-?04-?14|April[[:space:]]+14[,]?[[:space:]]+2026" src/ 2>/dev/null; then
  echo "::error::Guard 10 FAILED: src/ contains 2026-04-14 literal. The campaign date must come from /api/campaign-uplift, never hardcoded. Delete src/lib/forecastConfig.ts CAMPAIGN_START."
  fail=1
fi
```

**Anti-regression on Guard 7:** Existing Guard 7 catches `tenant_id` regressions. New Phase 16 migrations **all** must use `restaurant_id` (per C-01). Grep already covers — no new guard needed; just verify the 6 new migrations pass Guard 7 in CI.

**Confidence:** HIGH for the DB CHECK constraint; HIGH for Guard 10. MEDIUM for the awk-windowing heuristic in Guard 9 — recommend the planner promote the DB constraint as primary, keep awk as secondary lint.

**Sources:**
- [PostgreSQL CHECK constraint docs](https://www.postgresql.org/docs/current/ddl-constraints.html) — HIGH
- [scripts/ci-guards.sh (current)](file:///Users/shiniguchi/development/ramen-bones-analytics/scripts/ci-guards.sh) — HIGH

---

### §8 — Skill-Pattern Alignment

Two project skills have plan-level implications:

**`qa-gate` (`.claude/skills/qa-gate/SKILL.md`):** Mechanical pre-ship checks. For Phase 16 specifically:
- **Visual QA:** Chrome MCP screenshot of `CampaignUpliftCard` at 375px localhost AND DEV — both required. Phase 16 is a UI-bearing phase per ROADMAP `**UI hint**: yes`.
- **Security scan:** No new secrets expected (reuses existing `SUPABASE_SERVICE_ROLE_KEY`). Verify the new endpoint payload doesn't leak path arrays (CONTEXT.md C-05).
- **Doc consistency:** ROADMAP.md tick + STATE.md frontmatter update — enforced by drift gate. Plan should include `validate-planning-docs.sh` as a final task.

**`superpowers:test-driven-development`:** This phase has two canonical TDD candidates:
1. **Bootstrap CI math** in `cumulative_uplift.py` — write `tests/forecast/test_bootstrap_uplift_ci.py` FIRST with synthetic 200-path arrays where the expected CI is computable by hand (e.g., paths with known mean and known variance, window length 7). Then implement.
2. **Window-sum math** for cumulative-since-launch — `Σ(actual − path)` over a date range; off-by-one-day errors are easy here.

Plan-level guidance: For these two modules, write the test file BEFORE the implementation. For the schema/migration/UI-component tasks, use the existing project pattern (Wave 0 RED scaffold then GREEN, e.g., Phase 03 P01).

---

### §9 — Risk Callouts on Skipped-as-Known Items

**The 200→1000 bootstrap math (D-08):** §1 verifies that 200 source paths is sufficient for stable 1000-resample 95% percentile CIs at the friend's revenue scale and at window lengths ≥14 days. **No need to bump storage.** Wider CIs from the 200-path source are the honest representation of model uncertainty; bumping storage to 500 paths reduces CI width by ~10% but adds 2.5× MV size — not worth it at v1 scale. **Risk: LOW.**

**Anticipation cutoff −7d hardcoded (C-04):** Literature review (§2 Pitfall 2.2) confirms −7d is a defensible default. Dynamic-cutoff approaches exist in the literature (e.g., changepoint detection on the pre-period to pick the cutoff) but add ~2 weeks of implementation cost and require ≥2 years of pre-period data to be reliable. **Defer to Phase 17 if `cutoff_sensitivity.md` shows >25% swing between -14d and -7d.** **Risk: LOW.**

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `campaign_calendar` table + RLS | Database / Storage | — | Source of truth; tenant-scoped; service-role write only |
| `baseline_items_v` derived view | Database / Storage | — | SQL-native; computed from `stg_orderbird_order_items` |
| `kpi_daily_with_comparable_v` view | Database / Storage | — | View (not MV) per D-03; small enough to compute on-read |
| `feature_flags` table + ALTER `pipeline_runs.fit_train_end` | Database / Storage | — | Schema migrations |
| `campaign_uplift_v` (view or table+wrapper) | Database / Storage | — | Per CONTEXT.md Claude's discretion — view-first; switch to backing table if query cost exceeds 100ms p95 |
| Track-B fits in `counterfactual_fit.py` (orchestrated by `run_all.py --track=cf`) | API / Backend (Python via GHA) | Database write (forecast_daily) | Stateful Python with Supabase service-role; mirrors Phase 14 pattern |
| `cumulative_uplift.py` (bootstrap CI math) | API / Backend (Python via GHA) | Database write (campaign_uplift_v backing) | Pure compute; reads forecast_with_actual_v + forecast_daily.yhat_samples; writes campaign_uplift |
| Off-week reminder firing | API / Backend (Python via GHA) | Database write (feature_flags + pipeline_runs) | Date-based check; idempotent flip via Postgres atomic UPDATE |
| `/api/campaign-uplift` endpoint | API / Backend (SvelteKit server) | — | Phase 15 stub extends; reads `campaign_uplift_v` via auth.jwt() |
| `EventMarker` data wiring in `/api/forecast` | API / Backend (SvelteKit server) | — | Read-only `campaign_calendar` query; events array assembly |
| `CampaignUpliftCard.svelte` (LazyMount + clientFetch) | Browser / Client | — | Mobile-first SVG sparkline; clientFetch on mount |
| Skeleton/empty/error/stale states | Browser / Client | — | Per-card error isolation per `.claude/memory/project_silent_error_isolation.md` |
| Workflow `forecast-refresh.yml` extension | Operations / GHA | — | Cron + workflow_dispatch dual trigger; `0 7 * * 1` UTC weekly |
| CI Guards 9 + 10 | Operations / GHA | Database (CHECK constraint primary) | Belt-and-suspenders enforcement |

---

## Standard Stack

### Core (verified versions)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| numpy | 1.26.x (project default per Phase 14) | Bootstrap math in `cumulative_uplift.py` | Already a Phase 14 dep; `default_rng().integers()` for reproducible resampling |
| supabase-py | 2.x | Service-role client in Python forecast scripts | Already used (`scripts/forecast/db.py`); reuse |
| LayerChart | 2.0.0-next.54 | Sparkline + CI band in `CampaignUpliftCard` | Pinned via Phase 04 D-X; Spline + Area + Tooltip primitives proven in Phase 15 |
| date-fns | 4.x (project pin) | `format`, `differenceInDays` in tooltip | Already used in Phase 15 RevenueForecastCard |
| supabase-js | 2.103.x | `/api/campaign-uplift` endpoint | Already in stack |
| Svelte 5 | 5.x | Component pattern with `$state`, `$derived`, `{#snippet}` | Already in stack; C-12 Tooltip.Root snippet contract |
| zod | 3.x | Validate `/api/campaign-uplift` query params (none expected — endpoint is parameterless for v1) | Already in stack per FLT-07 |

### Supporting (no new deps)

| Library | Purpose | When to Use |
|---------|---------|-------------|
| (none) | — | Phase 16 adds **zero** new Python or JS dependencies. All math is numpy + numpy.random; all UI is existing LayerChart primitives. |

**Verification:** `numpy.random.default_rng()` is stable since numpy 1.17 (2019); `scipy.stats.bootstrap` (alternative) is stable since SciPy 1.7 (2021). [VERIFIED: scipy.stats.bootstrap docs at docs.scipy.org]

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Bootstrap-from-stored-paths (D-08) | `scipy.stats.bootstrap` direct | scipy.stats.bootstrap expects a 1D sample of statistics; our case is "200 sample paths, each a vector of N daily yhats" → re-shape needed; numpy direct is cleaner |
| numpy direct bootstrap | Block bootstrap (e.g., `arch.bootstrap.MovingBlockBootstrap`) | Block bootstrap is for cases where dependence is observed but not modeled; we already have 200 model-generated paths with correctly-modeled within-path dependence — block bootstrap is overkill (§1 details) |
| Bayesian-bootstrap | Unweighted bootstrap (D-08) | Bayesian-bootstrap weights paths via Dirichlet sampling instead of simple resampling; no material difference at 200-path source for this metric; D-08's wording matches simple resampling |
| LayerChart Spline+Area | Apache ECharts | ECharts is heavier (no Svelte 5 wrapper, larger mobile bundle); LayerChart is already the project standard |

---

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  Friend's iPhone (375px viewport)                              │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  /                                                        │  │
│  │  ├── InsightCard (extended w/ off-week reminder line)    │  │
│  │  ├── KPI Tiles                                           │  │
│  │  ├── RevenueForecastCard ◀── /api/forecast (extended    │  │
│  │  ├── InvoiceCountForecastCard      events array w/      │  │
│  │  ├── CampaignUpliftCard ◀── /api/campaign-uplift (new)  │  │
│  │  ├── DailyHeatmapCard           campaign_start)         │  │
│  │  └── CalendarRevenueCard, CalendarCountsCard, …          │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                          │
                          │ clientFetch (LazyMount)
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  SvelteKit on Cloudflare Pages (locals.safeGetSession)          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  /api/campaign-uplift  (auth.jwt → restaurant_id)         │  │
│  │  /api/forecast         (extended events array)            │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                          │
                          │ Supabase JWT-filtered SELECT
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  Supabase Postgres (RLS + wrapper views only)                   │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  campaign_uplift_v ◀─── campaign_calendar              │    │
│  │     │                  ◀─── forecast_with_actual_v     │    │
│  │     │                  ◀─── forecast_daily.yhat_samples│    │
│  │     │ (aggregated CI bounds; never raw paths)          │    │
│  │     │                                                   │    │
│  │  kpi_daily_with_comparable_v ◀── kpi_daily_mv          │    │
│  │     │                          ◀── baseline_items_v    │    │
│  │     │                          ◀── stg_orderbird_order_items│
│  │     │                                                   │    │
│  │  feature_flags  (offweek_reminder; remind_on_or_after)  │    │
│  │  pipeline_runs (fit_train_end column added)             │    │
│  └────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                          ▲
                          │ Service-role write (forecast pipeline)
                          │
┌─────────────────────────────────────────────────────────────────┐
│  GitHub Actions: forecast-refresh.yml (Mondays 07:00 UTC)       │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Step 1: run_all.py --track=both (BAU + CF fits)          │  │
│  │     │  ├── sarimax/prophet/ets/theta/naive_dow × 2 KPIs   │  │
│  │     │  └── per-model fit_track_b() writes forecast_track='cf'│
│  │     ▼                                                      │  │
│  │  Step 2: cumulative_uplift.py (NEW — Phase 16)            │  │
│  │     │  ├── reads forecast_with_actual_v + yhat_samples    │  │
│  │     │  ├── 1000-resample bootstrap CI per campaign window │  │
│  │     │  ├── writes campaign_uplift backing rows            │  │
│  │     │  ├── checks feature_flags.offweek_reminder          │  │
│  │     │  └── fires reminder via atomic Postgres UPDATE      │  │
│  │     ▼                                                      │  │
│  │  Step 3: refresh_forecast_mvs() RPC                        │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

No new top-level directories. New files only:

```
supabase/migrations/
├── 0058_campaign_calendar.sql            # D-01
├── 0059_baseline_items_v.sql             # D-02
├── 0060_kpi_daily_with_comparable_v.sql  # D-03
├── 0061_feature_flags.sql                # D-10
├── 0062_pipeline_runs_fit_train_end.sql  # D-05 ALTER
└── 0063_campaign_uplift_v.sql            # D-08 (or 6_campaign_uplift table + wrapper)

scripts/forecast/
├── counterfactual_fit.py                 # NEW orchestrator (D-06)
├── cumulative_uplift.py                  # NEW bootstrap CI runner (D-08, UPL-04, D-10)
├── sarimax_fit.py                        # MODIFIED: add fit_track_b()
├── prophet_fit.py                        # MODIFIED: add fit_track_b()
├── ets_fit.py                            # MODIFIED: add fit_track_b()
├── theta_fit.py                          # MODIFIED: add fit_track_b()
├── naive_dow_fit.py                      # MODIFIED: add fit_track_b()
└── run_all.py                            # MODIFIED: add --track flag (D-06)

scripts/external/
└── pipeline_runs_writer.py               # MODIFIED: add fit_train_end field (D-05)

src/routes/api/
├── campaign-uplift/+server.ts            # MODIFIED: extend payload
└── forecast/+server.ts                   # MODIFIED: 5th events source (D-12)

src/lib/components/
└── CampaignUpliftCard.svelte             # NEW (D-11)

src/lib/
└── forecastConfig.ts                     # DELETED (Guard 10)

src/routes/+page.svelte                   # MODIFIED: slot CampaignUpliftCard

scripts/ci-guards.sh                      # MODIFIED: Guard 9 + Guard 10

.github/workflows/forecast-refresh.yml    # MODIFIED: cumulative_uplift step

tests/forecast/
├── test_counterfactual_fit.py            # NEW unit tests
├── test_cumulative_uplift.py             # NEW (synthetic 200-path bootstrap math)
├── test_baseline_items_v.py              # NEW SQL view tests (auth'd JWT)
└── cutoff_sensitivity.md                 # NEW (D-13 sensitivity log)

tests/integration/
└── tenant-isolation.test.ts              # MODIFIED: extend with new tables/views
```

### Pattern 1: Bootstrap CI from stored sample paths

**What:** Compute 95% Monte Carlo CI for a windowed sum statistic by resampling stored sample paths.
**When to use:** Any statistic over a forecast window where each forecast row stores `yhat_samples jsonb` with N paths.

```python
# Source: §1 pseudocode (this research)
import numpy as np

def windowed_uplift_ci(actual_values, paths_array, n_resamples=1000, seed=42):
    """paths_array shape: (N_days, P_paths). actual_values shape: (N_days,)."""
    rng = np.random.default_rng(seed)
    P = paths_array.shape[1]
    sums = np.array([
        (actual_values - paths_array[:, rng.integers(0, P)]).sum()
        for _ in range(n_resamples)
    ])
    return float(np.quantile(sums, 0.025)), float(np.quantile(sums, 0.975))
```

### Pattern 2: Atomic feature-flag flip (race-safe)

**What:** Fire a one-shot reminder exactly once across concurrent runs.
**When to use:** Any "fire-once-then-disable" pattern in a multi-trigger workflow.

```python
# Source: §5 (this research)
resp = client.table('feature_flags').update(
    {'enabled': True, 'updated_at': 'now()'}
).eq('flag_key', 'offweek_reminder').eq('enabled', False).lte(
    'remind_on_or_after_date', date.today().isoformat()
).execute()
if resp.data:
    fire_reminder()  # only the run that won the UPDATE race fires
```

### Pattern 3: LayerChart axis-free sparkline

**What:** Small (≤300×100px) trend line + CI band for hero-number cards.
**When to use:** Any "headline number + shape-of-trend" mobile card.

```svelte
<!-- Source: §3 (this research) — adapts Phase 15 RevenueForecastCard.svelte:128-202 -->
<div style="width: 280px; height: 100px;">
  <Chart {data} x="date" y={['ci_lower', 'ci_upper']} xScale={scaleTime()}
         padding={{ left: 0, right: 0, top: 4, bottom: 4 }}
         tooltipContext={{ mode: 'bisect-x', touchEvents: 'auto' }}>
    <Svg>
      <Area y0="ci_lower" y1="ci_upper" fill="currentColor" fill-opacity={0.06} />
      <Spline y="cum_uplift" class="stroke-primary stroke-2" />
    </Svg>
    <Tooltip.Root contained="window" class="max-w-[80vw]">
      {#snippet children({ data })}
        <Tooltip.Header value={format(data.date, 'MMM d')} />
        <Tooltip.List>
          <Tooltip.Item label={`Day ${diff}`} value={`€${data.cum_uplift.toFixed(0)}`} />
          <Tooltip.Item label="95% CI" value={`€${data.ci_lower.toFixed(0)} … €${data.ci_upper.toFixed(0)}`} />
        </Tooltip.List>
      {/snippet}
    </Tooltip.Root>
  </Chart>
</div>
```

### Anti-Patterns to Avoid

- **Per-day bootstrap resampling** instead of path-level — destroys within-path autocorrelation, produces too-narrow CIs.
- **Fitting Track-B on raw `revenue_eur`** — biases uplift downward. Guard 9 + DB CHECK constraint enforces.
- **Hardcoding `2026-04-14` anywhere in `src/`** — forkers and future campaigns break. Guard 10 enforces.
- **Showing point estimate without CI band** — UPL-06 honest-label rule explicitly forbids.
- **Loading sample paths into the client** — C-05 forbids; only aggregated mean+CI bounds cross the API boundary.
- **Per-day axes on the sparkline** — at 280×100px, axis ticks are unreadable; use Tooltip on tap-to-pin instead.
- **`let:data` on `Tooltip.Root`** — throws `invalid_default_snippet` on Svelte 5; use `{#snippet children({ data })}` per C-12.
- **`tooltipContext={{ touchEvents: 'pan-x' }}`** — blocks PC trackpad vertical scroll; use `'auto'` per C-13 / `feedback_layerchart_mobile_scroll.md`.
- **SSR load function for `/api/campaign-uplift`** — CF Workers Error 1102 risk; use clientFetch + LazyMount per Phase 11 D-03.
- **Hardcoding the `yhat_samples` to assume 200** — assert at the function boundary (`assert P == 200`); fail loud if Phase 14 D-04 ever changes.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Bootstrap percentile CI | Custom quantile loop with hand-rolled RNG | `numpy.random.default_rng()` + `numpy.quantile()` | Already verified; deterministic seed support; ~4 lines of code |
| Sparkline + CI band SVG | Hand-rolled SVG with manual scale math | LayerChart `Chart > Svg > Area + Spline` | Phase 15 already proved; tooltip + scale come free |
| Tap-to-pin tooltip | Custom hover/pointer event handling | `Tooltip.Root` + `{#snippet children}` | C-12 contract; `touchEvents: 'auto'` handles mobile gotchas |
| RLS on new tables | Custom auth checks in SvelteKit | `auth.jwt()->>'restaurant_id'` policy + wrapper view | Phase 1 invariant |
| Race-safe feature-flag flip | Application-level mutex / advisory lock | Postgres atomic UPDATE with WHERE clause | Single SQL statement; no extra infrastructure |
| Cron orchestration of Track-B fits | Separate `counterfactual-refresh.yml` workflow | Extend `forecast-refresh.yml` with new steps | C-02 single workflow; cleaner cascade tracking via `pipeline_runs` |
| Cumulative-since-launch math | Custom Postgres window function in `campaign_uplift_v` | Compute in `cumulative_uplift.py` Python; write rows | Easier to test; matches `Σ(actual − Track-B)` semantics |

**Key insight:** Phase 16 has no domain that requires a new library. All capabilities decompose into combinations of existing project stack (numpy, supabase-py, LayerChart, Svelte 5). The risk is **mis-using** existing primitives (bootstrap unit choice, tooltip snippet shape), not lacking primitives.

---

## Common Pitfalls

### Pitfall 1: Bootstrap unit ambiguity

**What goes wrong:** Engineer reads "1000 bootstrap resamples from 200 paths" and implements per-day resampling — picks 200 random `yhat` values across days for each "path," ignoring within-day path identity.

**Why it happens:** "Resample at the path level" is unambiguous to a statistician but easy to misread as "resample 200 yhat values per resample run."

**How to avoid:** §1 textbook pseudocode — `paths[:, rng.integers(0, 200)]` where the slicing preserves the entire N-day path as one resample unit. Add a docstring assert: `assert paths_array.shape == (N, 200)`.

**Warning signs:** CIs are 50%+ narrower than naive expectation (sqrt of pre-period daily variance × N) — sign the resampling broke within-path dependence.

### Pitfall 2: `revenue_comparable_eur` model degeneracy

**What goes wrong:** SARIMAX trained on `revenue_comparable_eur` (lower mean, lower variance than raw revenue) fails to converge or fits a numerically unstable parameter set. CF rows get written but with garbage CIs.

**Why it happens:** Order tuned for raw-revenue magnitude; lower-variance series triggers LinAlgError, fallback `(0,1,0)` order kicks in but with weaker fit.

**How to avoid:** Per-model `pipeline_runs` row records the actual order used. `cumulative_uplift.py` cross-checks: if SARIMAX fallback fired in CF but not in BAU, log a warning and surface a card-level "low-confidence-model" badge.

**Warning signs:** `pipeline_runs.error_msg` contains "fallback order (0,1,0)" only on CF rows; CI bounds are >2× wider than expected.

### Pitfall 3: Off-week reminder fires twice (race condition)

**What goes wrong:** Monday cron + ad-hoc workflow_dispatch within a 60-second window both check `feature_flags.enabled=false`, both fire the reminder, both flip the flag. Friend gets two reminders on the same day.

**Why it happens:** Naive read-then-write pattern.

**How to avoid:** Atomic Postgres UPDATE with WHERE clause (§5 mitigation). Only the run that wins the UPDATE race fires. Idempotent.

**Warning signs:** Two `pipeline_runs` rows with `step_name='offweek_reminder'` and the same `started_at` (within 60s).

### Pitfall 4: Phase 11 SSR load-function regression

**What goes wrong:** Engineer forgets `LazyMount` wrap and adds `CampaignUpliftCard` data fetch to `+page.server.ts`. CF Pages SSR fan-out grows; Error 1102 returns.

**Why it happens:** Phase 16 is "yet another card"; easy to miss the LazyMount discipline.

**How to avoid:** Plan task list explicitly says "wrap `<CampaignUpliftCard />` in `<LazyMount>`"; verify via grep that no `+page.server.ts` change touches `campaign-uplift`.

**Warning signs:** DEV `/` route gets slower under load; CF Pages logs show 500 errors with "request body too large" or "CPU exceeded".

### Pitfall 5: Silent error isolation hides a permission bug

**What goes wrong:** `campaign_uplift_v` is created with `security_invoker=true` but joins `forecast_daily.yhat_samples` (RLS-protected). SvelteKit auth'd query gets 0 rows; `.catch(() => [])` in `+server.ts` swallows it; card shows skeleton forever.

**Why it happens:** `.claude/memory/project_silent_error_isolation.md` — the exact pattern that hid the 0-EUR dashboard bug for hours.

**How to avoid:** Test new wrapper views with **auth'd JWT** (not service_role; not E2E fixtures). Canonical smoke test: `supabase db query --linked` with `SET LOCAL role = authenticated; SELECT set_config('request.jwt.claims', '{"restaurant_id":"..."}', true); SELECT count(*) FROM campaign_uplift_v;`

**Warning signs:** Card shows skeleton in DEV but not in dev-server (where E2E fixtures hit). Empty array from `/api/campaign-uplift` despite Track-B rows existing.

---

## Code Examples

### Example: `fit_track_b(train_end)` per-model wrapper

```python
# Source: §2 + Phase 14 sarimax_fit.py existing pattern
# Each of sarimax_fit.py / prophet_fit.py / ets_fit.py / theta_fit.py / naive_dow_fit.py
# adds this function alongside the existing BAU fit:

def fit_track_b(client, *, restaurant_id: str, kpi_name: str, train_end: date) -> int:
    """Fit on pre-campaign data only. Writes forecast_track='cf' rows.

    Args:
        train_end: cutoff date (inclusive). Per CONTEXT.md C-04, equals
                   min(campaign_calendar.start_date) - 7 days.

    Returns:
        Number of forecast_daily rows written, or 0 on failure.
    """
    # 1. Fetch history from kpi_daily_with_comparable_v (NEVER kpi_daily_mv directly!)
    history = _fetch_history_comparable(client, restaurant_id, kpi_name, train_end)

    # 2. Build exog matrix on pre-cutoff dates (Phase 14 D-17 pattern)
    exog_train = build_exog_matrix(
        dates=history.index, restaurant_id=restaurant_id, mode='fit'
    )

    # 3. Predict horizon: train_end + 1 → train_end + 365
    pred_dates = pd.date_range(train_end + timedelta(days=1), periods=365, freq='D')
    exog_predict = build_exog_matrix(
        dates=pred_dates, restaurant_id=restaurant_id, mode='predict'
    )

    # 4. Fit + simulate 200 sample paths (Phase 14 D-15 native simulation)
    model = sm.tsa.SARIMAX(history, exog=exog_train, order=PRIMARY_ORDER, ...).fit()
    paths = model.simulate(nsimulations=365, repetitions=N_PATHS, exog=exog_predict)

    # 5. Write rows with forecast_track='cf' AND kpi_name=kpi_name (must NOT be 'revenue_eur'!)
    # Guard 9 / DB CHECK constraint catches the regression at write time.
    return _write_forecast_rows(
        client, paths=paths, kpi_name=kpi_name, forecast_track='cf',
        restaurant_id=restaurant_id, run_date=date.today(), train_end=train_end
    )
```

### Example: `cumulative_uplift.py` orchestration sketch

```python
# Source: §1 + §5 (this research)
import sys
import numpy as np
import json
from datetime import date

from scripts.forecast.db import make_client
from scripts.external.pipeline_runs_writer import write_success, write_failure

N_RESAMPLES = 1000
N_PATHS = 200  # asserted; matches Phase 14 D-04

def main():
    client = make_client()
    restaurant_id = _get_restaurant_id(client)

    # 1. Fetch active campaigns
    campaigns = client.table('campaign_calendar').select('*').execute().data or []
    if not campaigns:
        write_success(client, step_name='cumulative_uplift', row_count=0,
                      error_msg='no campaigns yet')
        sys.exit(0)

    # 2. For each (campaign, model) tuple, compute uplift + bootstrap CI
    rows_to_upsert = []
    for c in campaigns:
        for model in ['sarimax', 'prophet', 'ets', 'theta', 'naive_dow']:
            try:
                # Verify cf_<model> succeeded today (resilience to partial fits)
                if not _cf_succeeded_today(client, model):
                    continue

                actuals, paths_array = _fetch_actuals_and_paths(
                    client, restaurant_id, c['campaign_id'], model
                )
                # window_kind='campaign_window'
                rows_to_upsert.append(
                    _compute_uplift_row(c, model, 'campaign_window', actuals, paths_array)
                )
                # window_kind='cumulative_since_launch'
                rows_to_upsert.append(
                    _compute_uplift_row(c, model, 'cumulative_since_launch', actuals, paths_array)
                )
            except Exception as e:
                write_failure(client, step_name='cumulative_uplift',
                              error_msg=f'{c["campaign_id"]}/{model}: {e}')
                continue

    # 3. Upsert into campaign_uplift backing table
    if rows_to_upsert:
        client.table('campaign_uplift').upsert(rows_to_upsert).execute()

    # 4. Off-week reminder check (atomic flip)
    _check_offweek_reminder(client, restaurant_id)

    write_success(client, step_name='cumulative_uplift', row_count=len(rows_to_upsert))
    sys.exit(0)


def _compute_uplift_row(campaign, model, window_kind, actuals, paths):
    rng = np.random.default_rng(42)
    P = paths.shape[1]
    assert P == N_PATHS, f"Expected {N_PATHS} paths, got {P}"

    # Point estimate
    point = float((actuals - paths.mean(axis=1)).sum())

    # Bootstrap: 1000 resamples at the path level (D-08 textbook form)
    sums = np.array([
        (actuals - paths[:, rng.integers(0, P)]).sum()
        for _ in range(N_RESAMPLES)
    ])

    return {
        'restaurant_id': campaign['restaurant_id'],
        'campaign_id': campaign['campaign_id'],
        'model_name': model,
        'window_kind': window_kind,
        'cumulative_uplift_eur': point,
        'ci_lower_eur': float(np.quantile(sums, 0.025)),
        'ci_upper_eur': float(np.quantile(sums, 0.975)),
        'n_days': int(actuals.shape[0]),
        'as_of_date': date.today().isoformat(),
    }


if __name__ == '__main__':
    main()
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Per-day resampling for windowed-sum CIs | Path-level resampling preserving within-path dependence | Hyndman FPP2 §11.4 (2018+) | Correct CI width; ~30-50% wider for autocorrelated daily data |
| Hand-rolled bootstrap loops | `numpy.random.default_rng()` (deterministic) + percentile method | numpy 1.17+ (2019) | Reproducible; faster; deterministic seeds for CI test snapshots |
| ETS naïve PI | ETS with bootstrap residuals (Phase 14 D-16) | Hyndman 2018+ | ~10% wider PIs; closer to nominal coverage |
| Read-then-write feature flag flip | Atomic UPDATE with WHERE clause | Postgres 9.0+ (2010) | Race-safe; no application mutex needed |

**Deprecated/outdated:**
- `let:data` on `Tooltip.Root` — Svelte 5 throws `invalid_default_snippet`. Use `{#snippet children({ data })}` (C-12).
- `tooltipContext={{ touchEvents: 'pan-x' }}` as default — blocks PC trackpad vertical scroll. Use `'auto'` (C-13).
- Hardcoded `2026-04-14` in `src/` — Guard 10 will forbid post-Phase-16.

---

## Validation Architecture

> Required per `.planning/config.json` `workflow.nyquist_validation: true`.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 4.x (existing project), pytest (existing for Python) |
| Config file | `vite.config.ts` + `pyproject.toml` (no new config) |
| Quick run command | `pnpm vitest run -t 'campaign-uplift'` (or `pytest tests/forecast/test_cumulative_uplift.py -x`) |
| Full suite command | `pnpm vitest run && pytest tests/` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UPL-01 | `campaign_calendar` RLS enforces per-restaurant access | Integration (auth'd JWT) | `pnpm vitest run -t 'tenant-isolation campaign_calendar'` | ❌ Wave 0 |
| UPL-01 | `campaign_calendar` seed row exists with 2026-04-14 | Integration | `psql -c "SELECT count(*) FROM campaign_calendar WHERE start_date='2026-04-14'"` | ❌ Wave 0 |
| UPL-02 | No `forecast_track='cf'` row has `pipeline_runs.fit_train_end ≥ min(campaign_calendar.start_date)` | Integration | `pnpm vitest run -t 'cf fit_train_end leak'` | ❌ Wave 0 |
| UPL-02 | Sensitivity log committed at `tests/forecast/cutoff_sensitivity.md` | Manual / fixture | `test -f tests/forecast/cutoff_sensitivity.md && grep -q 'Sensitivity ratio' $_` | ❌ Wave 0 |
| UPL-03 | `baseline_items_v` excludes Onsen EGG, Tantan, Hell beer | Integration | `pnpm vitest run -t 'baseline_items_v exclusions'` | ❌ Wave 0 |
| UPL-03 | Guard 9 forbids raw `revenue_eur` Track-B writes (grep + DB CHECK) | Unit (CI) | `bash scripts/ci-guards.sh` | ❌ Wave 0 (Guard 9 itself) |
| UPL-04 | Bootstrap CI math: synthetic 200 paths with known mean/var → expected 95% CI ± 1 EUR | Unit (deterministic seed) | `pytest tests/forecast/test_cumulative_uplift.py::test_bootstrap_synthetic -x` | ❌ Wave 0 |
| UPL-04 | `campaign_uplift_v` exposes `(restaurant_id, campaign_id, model_name, window_kind)` PK | Integration | `pnpm vitest run -t 'campaign_uplift_v shape'` | ❌ Wave 0 |
| UPL-04 | `cumulative_since_launch` rows monotonic in `as_of_date` | Integration | `pnpm vitest run -t 'cumulative monotonic'` | ❌ Wave 0 |
| UPL-05 | `naive_dow_uplift_eur` column populated for every (campaign, sarimax) row | Integration | `pnpm vitest run -t 'naive_dow cross-check'` | ❌ Wave 0 |
| UPL-06 | "CI overlaps zero" label rendered when `ci_lower ≤ 0 ≤ ci_upper` | Component test (vitest + happy-dom) | `pnpm vitest run src/lib/components/CampaignUpliftCard.test.ts` | ❌ Wave 0 |
| UPL-06 | Card never renders point estimate without CI band visible | Component test | (above) | ❌ Wave 0 |
| UPL-06 | Localhost-first verification via Chrome MCP at 375px (manual) | Manual | Chrome MCP `localhost:5173` navigate + screenshot | ❌ Wave 0 |
| UPL-07 | `cumulative_uplift.py` runs after Track-B in `forecast-refresh.yml` cascade | Workflow / smoke | `gh workflow run forecast-refresh.yml --ref feature/phase-16-its-uplift-attribution; gh run watch` | ❌ Wave 0 |
| UPL-07 | Off-week reminder fires exactly once on or after 2026-10-15 (atomic UPDATE) | Unit (with frozen date) | `pytest tests/forecast/test_offweek_reminder.py::test_idempotent_flip -x` | ❌ Wave 0 |
| UPL-07 | Guard 10 forbids `2026-04-14` literal in `src/` | Unit (CI) | `bash scripts/ci-guards.sh` | ❌ Wave 0 (Guard 10 itself) |

### Sampling Rate

- **Per task commit:** `pnpm vitest run -t 'campaign'` (test set scoped to phase) + `bash scripts/ci-guards.sh`
- **Per wave merge:** `pnpm vitest run && pytest tests/forecast/ -x`
- **Phase gate:** Full suite green + manual Chrome MCP localhost verification + DEV deploy + DEV Chrome MCP verification before `/gsd-verify-work`.

### Wave 0 Gaps

- [ ] `tests/forecast/test_cumulative_uplift.py` — covers UPL-04 bootstrap math
- [ ] `tests/forecast/test_counterfactual_fit.py` — covers UPL-02 leak guard
- [ ] `tests/forecast/test_baseline_items_v.py` — covers UPL-03 (auth'd JWT smoke per `project_silent_error_isolation.md`)
- [ ] `tests/forecast/test_offweek_reminder.py` — covers UPL-07 atomic flip
- [ ] `tests/forecast/cutoff_sensitivity.md` — generated artifact (D-13)
- [ ] `tests/integration/tenant-isolation.test.ts` — extend with `campaign_calendar`, `feature_flags`, `campaign_uplift_v`
- [ ] `src/lib/components/CampaignUpliftCard.test.ts` — covers UPL-06 honest label rendering
- [ ] `scripts/ci-guards.sh` — Guard 9 + Guard 10 lines added
- [ ] DB CHECK constraint `forecast_daily_cf_not_raw_revenue` (added in 0058 or appended to schema migration)

**Special Wave 0 emphasis (from `project_silent_error_isolation.md`):**
- All new wrapper views (`baseline_items_v`, `kpi_daily_with_comparable_v`, `campaign_uplift_v`) MUST be smoke-tested with **authenticated JWT**, not service_role; not E2E fixtures.
- Canonical smoke test pattern:
```sql
SET LOCAL role = authenticated;
SELECT set_config('request.jwt.claims', '{"restaurant_id":"<friend_owner_uuid>"}', true);
SELECT count(*) FROM campaign_uplift_v;
-- Expect: > 0 (not silent empty)
```

---

## Open Questions for Planner

> Only items that genuinely require a planning-time choice. Everything else is locked.

1. **`campaign_uplift_v` backing — view vs table+wrapper?**
   - What we know: CONTEXT.md Claude's discretion explicitly defers this to the planner.
   - What's unclear: Direct view performance under the bootstrap CI computation (joining `forecast_daily.yhat_samples` 200 paths × N days × 5 models × 1 campaign).
   - Recommendation: Start with a `campaign_uplift` table populated by `cumulative_uplift.py` + a thin `campaign_uplift_v` wrapper view (auth.jwt() filter only). The CI math runs once nightly in Python; the wrapper view returns pre-computed rows fast. View-only would re-run the bootstrap on every page load — too slow. **Strongly recommend table+wrapper.**

2. **Guard 9 primary enforcement — DB CHECK constraint vs grep?**
   - What we know: §6 — DB constraint is mathematically airtight.
   - What's unclear: Is the planner OK adding a CHECK constraint that touches the existing `forecast_daily` table (Phase 14 migration 0050)?
   - Recommendation: Add CHECK constraint as a migration in this phase (e.g., 0058 first migration). Keep the grep guard as secondary lint for code-review feedback. Both are belts-and-suspenders.

3. **`fit_track_b()` per-model implementation — function vs `track` parameter?**
   - What we know: CONTEXT.md D-06 says "each model gets a `fit_track_b()` function." Phase 14 existing code has a single `fit()` orchestration in `scripts/forecast/run_all.py:_build_subprocess_env`.
   - What's unclear: Whether the cleanest pattern is a parallel `fit_track_b()` function per model OR adding a `track` env var (similar to `GRANULARITY`) to the existing entry point.
   - Recommendation: **Track env var pattern**. Mirrors `GRANULARITY` injection in `_build_subprocess_env`. Less code duplication; same `pipeline_runs.step_name='cf_<model>'` discrimination via a single env-var-aware fit function. Matches Phase 14 KISS pattern.

4. **`offweek_reminder` schema column for the date check?**
   - What we know: CONTEXT.md D-10 says seed `(restaurant_id, 'offweek_reminder', false, 'fire on 2026-10-15...')`. The "2026-10-15" date currently lives in the description string.
   - What's unclear: Does the schema add a typed `remind_on_or_after_date date NULL` column?
   - Recommendation: **Add the typed column.** Indexed date comparison is faster and unambiguous; description column reverts to free-text human-readable note. `feature_flags(restaurant_id, flag_key, enabled, remind_on_or_after_date, description, updated_at)`.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python 3.12 | counterfactual_fit.py + cumulative_uplift.py | ✓ | 3.12 | — |
| numpy | bootstrap CI | ✓ (Phase 14 dep) | 1.26.x | — |
| supabase-py | Service-role client | ✓ (Phase 14 dep) | 2.x | — |
| statsmodels (SARIMAX) | `fit_track_b()` for SARIMAX | ✓ (Phase 14 dep) | latest | — |
| prophet | `fit_track_b()` for Prophet | ✓ (Phase 14 dep) | 1.3.0 | — |
| LayerChart | `CampaignUpliftCard` sparkline | ✓ (Phase 4 / Phase 15 dep) | 2.0.0-next.54 | — |
| date-fns | tooltip formatters | ✓ (Phase 15 dep) | 4.x | — |
| GitHub Actions ubuntu-latest | `forecast-refresh.yml` | ✓ | — | — |
| Chrome MCP | localhost-first UI verification | ✓ (per `.claude/CLAUDE.md`) | — | none — required for sign-off |
| Supabase project (DEV + service-role secret) | All migrations + service-role writes | ✓ | — | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None.

---

## Security Domain

> `security_enforcement` not explicitly set in `.planning/config.json` → treat as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `locals.safeGetSession()` on `/api/campaign-uplift` (FUI-07 carry-forward); existing Supabase Auth |
| V3 Session Management | yes | `@supabase/ssr` cookies; existing pattern |
| V4 Access Control | yes | RLS via `auth.jwt()->>'restaurant_id'` on `campaign_calendar`, `feature_flags`, `campaign_uplift_v`; `REVOKE ALL` on any new MV |
| V5 Input Validation | yes | zod for any query params on `/api/campaign-uplift` (currently parameterless; if a `campaign_id` filter is added, validate via zod per FLT-07) |
| V6 Cryptography | no | No new crypto in Phase 16; existing `card_hash` pipeline unchanged |
| V8 Data Protection | yes | Sample paths never cross API boundary (C-05); `Cache-Control: private, no-store` on endpoint |

### Known Threat Patterns for SvelteKit + Supabase + GHA-Python stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| RLS bypass via SvelteKit raw-table query | Information Disclosure | Existing Guard 1 — only `*_v` wrapper views readable from `src/` |
| Service-role key leak in workflow logs | Information Disclosure | Existing pattern: scope `SUPABASE_SERVICE_ROLE_KEY` env to single step (verified in `forecast-refresh.yml`) |
| Sample-path arrays leaked to client | Information Disclosure | C-05 — `campaign_uplift_v` returns aggregated CI bounds only; never raw `yhat_samples` arrays |
| Off-week reminder racing twice | (operational) | Atomic Postgres UPDATE (§5) |
| ITS attribution claimed when CI overlaps zero | (integrity / honest framing) | UPL-06 honest label — "CI overlaps zero — no detectable lift"; never single-point estimate without CI |
| Track-B fit on raw revenue (biased uplift) | (integrity) | Guard 9 + DB CHECK constraint |
| 2026-04-14 hardcoded everywhere | (forkability / multi-tenant integrity) | Guard 10 |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | First and second bootstrap pseudocode forms (resample-200-then-average vs one-path-per-draw) give close-but-not-identical CIs at small N; for windows ≥14 days both forms produce the same percentile to within 1 EUR for the friend's revenue scale | §1 | Medium — if forms differ materially, CI test snapshots will reveal; planner picks the second form per D-08 verbatim regardless |
| A2 | Guard 9 awk-windowing threshold of 50 lines is heuristic; may need tuning to 30 or 100 based on `counterfactual_fit.py` structure | §6 | Low — DB CHECK constraint is the airtight primary enforcement; awk is secondary lint |

**Verified claims** (no user confirmation needed): all claims tagged `[VERIFIED]` or `[CITED]` in this document.

---

## Sources

### Primary (HIGH confidence)

- **Context7 LayerChart** (`/techniq/layerchart`) — Spline + Area + Tooltip composition, fill-opacity, snippet contract. Verified against live `RevenueForecastCard.svelte:128-202`.
- **Context7 SciPy** (`/scipy/scipy`) — `scipy.stats.bootstrap` parameters; numpy random number generation.
- **[scipy.stats.bootstrap manual](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.bootstrap.html)** — n_resamples, percentile method, confidence_level.
- **[Hyndman & Athanasopoulos FPP2 §11.4 Bootstrapping](https://otexts.com/fpp2/bootstrap.html)** — path-level resampling for forecast paths.
- **[Hyndman & Rostami-Tabar 2025 "Forecasting interrupted time series"](https://www.tandfonline.com/doi/full/10.1080/01605682.2024.2395315)** — six strategies for ITS forecasting.
- **[Hyndman fits.pdf](https://robjhyndman.com/papers/fits.pdf)** — concrete model selection guidance.
- **[Hyndman "Prediction intervals too narrow"](https://robjhyndman.com/hyndsight/narrow-pi/)** — ETS PI coverage 71-87%.
- **[Bernal et al., "ITS tutorial" PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC5407170/)** — ITS pitfalls catalog.
- **[Hudson et al., "ITS Methodological Framework"](https://researchonline.lshtm.ac.uk/id/eprint/4648066/1/A-Methodological-Framework-for-Model-Selection-in-Interrupted-Time-Series-Studies.pdf)** — model selection.
- **[BFI Working Paper 2019-97 on ITS validity](https://bfi.uchicago.edu/wp-content/uploads/BFI_WP_201997.pdf)** — Ashenfelter's dip.
- **[PostgreSQL CHECK constraint docs](https://www.postgresql.org/docs/current/ddl-constraints.html)** — DB-level enforcement.
- **[PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html)** — atomic UPDATE semantics for race-safe flag flips.
- **`.planning/phases/12-forecasting-foundation/12-PROPOSAL.md`** §7 / §11 / §13 — locked schema sketches and ITS framing rules.
- **`.planning/phases/14-forecasting-engine-bau-track/14-CONTEXT.md`** — D-04 (200 paths), D-15/16 (sample-path generation), D-17 (exog.py).
- **`.planning/phases/15-forecast-backtest-overlay/15-CONTEXT.md`** — D-05 Tooltip.Root, D-08 endpoint, D-09 EventMarker, D-13 touchEvents.
- **`scripts/forecast/sample_paths.py`** + **`run_all.py`** + **`exog.py`** + **`sarimax_fit.py`** — live code patterns to extend.
- **`src/lib/components/RevenueForecastCard.svelte`** — Spline + Area + Tooltip composition pattern verified line-by-line.
- **`.claude/memory/feedback_svelte5_tooltip_snippet.md`** — Tooltip.Root snippet contract.
- **`.claude/memory/feedback_layerchart_mobile_scroll.md`** — touchEvents 'auto' default.
- **`.claude/memory/project_silent_error_isolation.md`** — auth'd JWT smoke test discipline.
- **`.claude/memory/project_cf_pages_stuck_recovery.md`** — CF Pages Error 1102 risk.

### Secondary (MEDIUM confidence)

- **[towardsdatascience time series bootstrap article](https://towardsdatascience.com/time-series-bootstrap-in-the-age-of-deep-learning-b98aa2aa32c4/)** — block bootstrap context.
- **[ds4ps ITS textbook](https://ds4ps.org/pe4ps-textbook/docs/p-020-time-series.html)** — pre-period selection guidance.
- **[Bryntum 2026 Temporal status](https://bryntum.com/blog/javascript-temporal-is-it-finally-here/)** — confirms date-fns over Temporal for now.
- **[machinelearningmastery bootstrap CIs](https://machinelearningmastery.com/calculate-bootstrap-confidence-intervals-machine-learning-results-python/)** — percentile method examples.

### Tertiary (LOW confidence — flagged for human review if used)

- (None used as primary justification.)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new deps; all primitives verified in existing codebase.
- Architecture: HIGH — extends Phase 14/15 patterns mechanically.
- Pitfalls: HIGH for the 5 documented; MEDIUM for SARIMAX(0,1,0) fallback specifically triggered by `revenue_comparable_eur` low variance (depends on actual variance ratio — planner should flag a smoke test).
- Bootstrap math: HIGH for path-level being correct; HIGH for 1000 resamples being sufficient at 200-path source pool.
- Mobile sparkline pattern: HIGH — verified line-by-line against Phase 15 RevenueForecastCard.
- Off-week reminder mechanism: HIGH — atomic UPDATE is well-established Postgres pattern.

**Research date:** 2026-05-01
**Valid until:** 2026-05-15 (~14 days for Phase 16 planning + execution; library versions and Phase 14/15 invariants are stable).
