---
phase: 17-backtest-gate-quality-monitoring
verified: 2026-05-06T19:08:05Z
status: gaps_found
score: 4/6 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: n/a
  gaps_closed: []
  gaps_remaining: []
  regressions: []
gaps:
  - truth: "Promotion gate enforces ≥10% RMSE improvement vs the higher of naive_dow / naive_dow_with_holidays at every horizon (BCK-03/BCK-04)"
    status: failed
    reason: "BL-01 — `_gate_decision` defaults missing baselines to `float('inf')`, so `threshold = inf * 0.9 = inf` and every non-baseline model passes whenever either baseline RMSE is missing. A baseline subprocess crash, zero aligned rows, or any data-quality blip silently turns the gate into a pass-through. This is a security/correctness gate that the phase exists to provide — the failure mode neutralises the central deliverable."
    artifacts:
      - path: "scripts/forecast/backtest.py:344-347"
        issue: "`baseline_dow = mean_rmse.get('naive_dow', float('inf'))` and same for `naive_dow_with_holidays`. `max(inf, x) = inf`, `inf * 0.9 = inf`, `rmse <= inf` is always True for any challenger."
    missing:
      - "Replace `float('inf')` defaults with explicit None checks; when either baseline is missing, mark all models for that (kpi, horizon) as PENDING (verdict-undecidable). Baselines are R7 always-on; their absence is a data-quality signal, not a free pass."
      - "Add a regression test in `test_backtest.py` that constructs `quality_rows` with `naive_dow_with_holidays` missing and asserts `_gate_decision` returns PENDING (or FAIL) for challengers — never PASS. Plan 17-05's existing tests do not cover this path; that is why the bug shipped."
  - truth: "Backtest fold-row writes to forecast_daily are cleaned up after every run, success or failure, so dashboard reads never observe `forecast_track LIKE 'backtest_fold_%'` rows"
    status: failed
    reason: "BL-02 — `_cleanup_sentinel_rows` is called inside the `try:` block (line 649, before `write_success`), not in a `finally:`. Any exception in the fold loop, conformal calibration, gate update, or `write_success` itself escapes via the `except:` handler at line 664, which writes pipeline_runs failure but never deletes the fold rows. Because `forecast_daily_mv` does `DISTINCT ON ... ORDER BY run_date DESC`, a leaked `forecast_track='backtest_fold_3'` row can persist until the same (kpi, model, target_date, run_date) combination is re-written — which never happens for `track='bau'` reads."
    artifacts:
      - path: "scripts/forecast/backtest.py:649 (called in try) and 664-676 (except path with no cleanup)"
        issue: "Cleanup is on the happy path only. The docstring claim 'Cleans backtest_fold_* rows post-eval' is contradicted by the control flow."
    missing:
      - "Wrap the cleanup call in a `finally:` block so it runs on both success and failure: `finally: try: _cleanup_sentinel_rows(client, restaurant_id=restaurant_id) except Exception as cleanup_err: print(...)`."
      - "Add a `test_backtest.py` case that simulates an exception during the fold loop (e.g., raises in `_write_quality_row` mock) and asserts cleanup is still called — currently no test exercises the exception path."
deferred: []
---

# Phase 17: Backtest Gate & Quality Monitoring — Verification Report

**Phase Goal:** Backtest Gate & Quality Monitoring — rolling-origin CV at 4 horizons + ConformalIntervals + ≥10% RMSE promotion gate + freshness-SLO badges + ACCURACY-LOG.
**Verified:** 2026-05-06T19:08:05Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | `backtest.py` runs rolling-origin CV at h=7/35/120/365, computes RMSE+MAPE per (model × horizon × fold), writes rows to `forecast_quality` with `evaluation_window='rolling_origin_cv'`; conformal calibration at h=35 with n_windows=4; long horizons UNCALIBRATED until 2y; cold-start PENDING badge | VERIFIED (with documented deviation) | `backtest.py` exists (~770 LOC). Constants `HORIZONS=[7,35,120,365]`, `N_FOLDS=4`, `UNCALIBRATED_HORIZONS=(120,365)`, cold-start PENDING write at lines that gate `if days_history < horizon + N_FOLDS`. **D-03 deviation:** plan/CONTEXT explicitly chose a manual numpy rolling-origin loop over `statsforecast.cross_validation`, and a manual absolute-residual quantile in `conformal.py` over `statsforecast.ConformalIntervals`. Decision recorded in 17-CONTEXT.md D-03 + 17-02-PLAN; substantively equivalent (split-conformal math). 89/89 Phase 17 pytests + 20/20 vitest pass. |
| SC2 | Gate compares challengers against the higher of `naive_dow` and `naive_dow_with_holidays` RMSE at every horizon | FAILED | `_gate_decision` (`backtest.py:344-347`) computes `baseline = max(naive_dow_rmse, naive_dow_with_holidays_rmse)` correctly when both exist — but defaults missing baselines to `float('inf')`. The infinity propagates through `threshold = inf * 0.9 = inf`, so any challenger passes when either baseline is absent. The "higher of two" rule degrades to a pass-through whenever a baseline subprocess fails — exactly the data-quality scenario where the gate matters. See gap #1. |
| SC3 | Promotion gate: any model promoted requires ≥10% RMSE improvement vs the regressor-aware naive baseline; gate failure flips `feature_flags.{model}.enabled=false`; baselines never flipped | FAILED | `BASELINE_MODELS=('naive_dow','naive_dow_with_holidays')` constant at `backtest.py:99`; R7 hard guard `if model in BASELINE_MODELS: continue` verified at line 376. `_apply_gate_to_feature_flags` writes `enabled=False` for non-baseline FAIL — verified by 13 `test_gate.py` tests. **Gate threshold logic itself is broken (BL-01)** — the ≥10% improvement threshold collapses to "any improvement vs ∞" when a baseline is missing. The mechanism for flipping flags is correct; the decision feeding it is not. See gap #1. |
| SC4 | `forecast-backtest.yml` runs weekly Tuesday 23:00 UTC; `forecast-quality-gate.yml` runs on every forecast-engine PR; both <5 min on ubuntu-latest | PARTIAL — accepted | `forecast-quality-gate.yml` correct: `pull_request: paths: scripts/forecast/**`, `timeout-minutes: 5`. **`forecast-backtest.yml` deviates from SC4** — has `push: paths: data/**` + `workflow_dispatch`, NO `schedule:` block. The 17-07-SUMMARY claimed `cron: '0 23 * * 2'` and `test_workflow_yaml.py::test_backtest_cron_tuesday_2300_utc PASSED`, but the workflow file on disk has no schedule. `test_workflow_yaml.py:33` actually asserts `not on_block.get('schedule')` (intentional owner-driven cadence, not a cron). REVIEW WR-03 flags the doc/code drift. The phase explicitly accepts a "merge-deferred + cadence change" PARTIAL per 17-10-SUMMARY. Logic is verified locally (89/89 tests pass); `gh workflow run --ref feature/...` returns 404 because the workflow file isn't on `main` yet. |
| SC5 | `docs/forecast/ACCURACY-LOG.md` auto-committed weekly with RMSE history per (model × horizon) including PASS/FAIL/PENDING gate verdict; honest-failure copy when no challenger beats naive | VERIFIED (with caveats) | `docs/forecast/ACCURACY-LOG.md` exists (skeleton form; auto-update wired). `write_accuracy_log.py:29-30` defines exact em-dash canonical string `'> naive-DoW-with-holidays remains production model — no challenger promoted this week.'` per BCK-07 spec. PASS/FAIL/PENDING/UNCALIBRATED verdict rendering verified by `test_accuracy_log.py` (6 tests pass). Commit-back step uses `[skip ci]` to prevent recursive triggers. **Caveats:** (a) `qhat = 0.0` is a hardcoded placeholder in `write_accuracy_log.py:224` — the rendered "qhat_95 = 0 EUR" is a placeholder value (REVIEW WR-04); (b) ACCURACY-LOG.md skeleton claims "Auto-generated weekly by ... (Tuesday 23:00 UTC)" which contradicts the actual `push: data/**` trigger (REVIEW WR-03); (c) merge-deferred — the workflow hasn't fired in production yet (404 on feature ref). Logic is correct; first auto-update happens after merge to main + first `data/**` push. |
| SC6 | Freshness-SLO check: if any cascade stage `upstream_freshness_h > 24`, dashboard renders stale-data badge; CI fault-injection verifies surfacing | VERIFIED | `data_freshness_v` migration 0067 has UNION branch `pipeline_runs WHERE step_name IN (...) AND status='success'`, returns `MIN(stage_last)` (stalest stage) per restaurant. `WITH (security_invoker = true)` and `GRANT SELECT TO authenticated` preserved. `FreshnessLabel.svelte:16,19` — `hours > 30 ? red : hours > 24 ? yellow : zinc` — threshold tightened to 24h per BCK-08. `tests/unit/cards.test.ts` (14 tests pass) covers the boundary cases (23h gray, 25h yellow, 31h red). 17-10-SUMMARY records DEV round-trip pass at 375×667 in ja+en. **Note:** ROADMAP SC6 mentions "deliberate weather-fetch failure in CI verifies the badge surfaces" — no automated CI fault-injection test was added; verification was manual on DEV via Playwright MCP. Acceptable per 17-10 PARTIAL acceptance for this round; not a blocker because the data-layer surfacing is verified. |

**Score:** 4/6 truths verified (SC1, SC4 [partial-accepted], SC5, SC6); 2 truths FAILED (SC2, SC3 — both blocked by BL-01).

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `supabase/migrations/0067_phase17_backtest_schema.sql` | ALTER forecast_quality + INSERT feature_flags + DROP/CREATE data_freshness_v | VERIFIED | All 3 sections present, RLS preserved, 8 step_name literals match `*_fit.py` constants. |
| `supabase/migrations/0068_phase17_backtest_schema_gap.sql` | Gap closure (qhat column + NULLABLE relax + CHECK constraint) | VERIFIED | All 3 ALTERs present; `forecast_quality_rolling_origin_cv_verdict_required` constraint enforces gate_verdict NOT NULL on `rolling_origin_cv` rows. (Migration was originally promised in plan 17-01 but landed in a follow-up 0068 — cosmetic split.) |
| `scripts/forecast/conformal.py` | Pure function `calibrate_conformal_h35(fold_residuals, alpha=0.05) -> {'qhat_h35': float}` | VERIFIED | 30 LOC, only numpy import; 5/5 tests pass; cold-start returns nan; absolute-residual quantile math correct. |
| `scripts/forecast/naive_dow_with_holidays_fit.py` | Regressor-aware naive baseline; STEP_NAME='forecast_naive_dow_with_holidays'; honors FORECAST_TRACK env var | VERIFIED | Renamed (originally `naive_dow_with_holidays.py` — defect 119ad45). MODEL_NAME, STEP_NAME, FORECAST_TRACK env read all confirmed via grep. 6/6 helper tests pass. |
| `scripts/forecast/{sarimax,prophet,ets,theta,naive_dow}_fit.py` argparse retrofit | --train-end/--eval-start/--fold-index + FORECAST_TRACK env var | VERIFIED | 15/15 parametrized tests in `test_fit_scripts_argparse.py` pass. All 5 scripts grep-confirmed for `track = os.environ.get('FORECAST_TRACK', 'bau')` and `train_end=train_end_override`. |
| `scripts/forecast/backtest.py` | Rolling-origin CV driver, gate writer, conformal calibration | EXISTS, BL-01 + BL-02 | File exists with all required constants and helpers. R7 baseline-skip guard verified. **However**, `_gate_decision` (lines 344-347) silently passes challengers when baselines missing (BL-01); `_cleanup_sentinel_rows` not in `finally:` block (BL-02). |
| `scripts/forecast/run_all.py` | feature_flags AND-intersect + DEFAULT_MODELS includes naive_dow_with_holidays | VERIFIED | `_get_enabled_models` helper (line 60) + `env_set & db_set` intersect (line 262) + DEFAULT_MODELS extended (line 35). Graceful fallback on DB read failure. 6/6 tests pass. |
| `.github/workflows/forecast-backtest.yml` | Weekly cron + commit-back of ACCURACY-LOG.md | DRIFT vs SC4 wording | Has `push: paths: data/**` + `workflow_dispatch`, NO schedule. SC4 mandates "weekly Tuesday 23:00 UTC". Documented in 17-10 as merge-deferred PARTIAL with owner-driven cadence justification, but the disk file does NOT match the SC4 contract verbatim. The phase has accepted this; flagged here for visibility, not as a blocker. |
| `.github/workflows/forecast-quality-gate.yml` | PR-time gate, <5 min, contents:read | VERIFIED | All correct. Cold-start safety in `quality_gate_check.py` returns 0 when no rolling_origin_cv rows yet. |
| `docs/forecast/ACCURACY-LOG.md` | Skeleton + append-only weekly history + honest-failure copy | VERIFIED (skeleton only) | File exists with valid Markdown structure. History section empty until first auto-update fires post-merge. Honest-failure canonical string defined in `write_accuracy_log.py:29-30`. |
| `scripts/forecast/quality_gate_check.py` | Read-only DB gate; <5 min; cold-start PASS | VERIFIED | Cold-start handled (empty enabled_models -> []; empty verdicts -> []). 9/9 tests pass. |
| `scripts/forecast/write_accuracy_log.py` | Render ACCURACY-LOG from forecast_quality with verdicts + qhat | VERIFIED (qhat=0 placeholder) | Function-level rendering correct; `qhat = 0.0` hardcoded at line 224 (REVIEW WR-04) — published log will show "qhat_95 = 0 EUR" until a future plan wires the real value. Not a blocker. |
| `src/lib/components/ModelAvailabilityDisclosure.svelte` | Backtest verdict pills column with 4 horizon cells per model | VERIFIED | 5th column added (line 143) with 4 pills per row using `verdictColorClass()` + i18n. **Header is hardcoded English `Backtest`** (REVIEW WR-07) — not localised; not a blocker but inconsistent with other column headers. |
| `src/lib/components/FreshnessLabel.svelte` | Yellow >24h, red >30h thresholds | VERIFIED | Line 16: `hours > 30 ? ... : ''`; Line 19: `hours > 30 ? text-red-600 : hours > 24 ? text-yellow-600 : text-zinc-500`. |
| `src/routes/api/forecast/+server.ts` | `modelBacktestStatus` field returned | VERIFIED | Reads `forecast_quality WHERE evaluation_window='rolling_origin_cv'`, deduplicates latest verdict per (model, horizon), returns `Record<model, {h7,h35,h120,h365}>`. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `backtest.py` | `conformal.py::calibrate_conformal_h35` | import | WIRED | Imported at line 30; called per (kpi, model) in conformal calibration phase. |
| `backtest.py` | `last_7_eval.py::compute_metrics` | import | WIRED | Imported at line 28; called per fold to compute RMSE/MAPE/bias. |
| `backtest.py` | `public.forecast_quality` | client.upsert | WIRED | `_write_quality_row` upserts diagnostic columns including `gate_verdict='PENDING'` initially, then UPDATEd with PASS/FAIL in second pass. Verified at lines 600-624. |
| `backtest.py` | `public.feature_flags` | `.update({'enabled': False})` on FAIL | WIRED (but conditioned on broken gate) | `_apply_gate_to_feature_flags` writes the flip correctly; **upstream gate decision is broken (BL-01)** so this WIRED behavior receives the wrong inputs. Mechanism PASS, semantics FAIL. |
| `backtest.py` subprocess fits | `forecast_daily` track-scoped rows | `FORECAST_TRACK=backtest_fold_{N}` env var | WIRED | All 5 fit scripts honor FORECAST_TRACK; `_fetch_fold_yhats` reads back by `forecast_track=backtest_fold_{N}`. |
| `run_all.py` | `feature_flags` AND-intersect | `_get_enabled_models` | WIRED | Verified via grep + tests. Graceful fallback to env_set on DB read failure. |
| `forecast-quality-gate.yml` | `quality_gate_check.py` | `python -m scripts.forecast.quality_gate_check` | WIRED | Workflow runs the script; script exits 1 on enabled FAIL. |
| `+page.server.ts` | `data_freshness_v` (with forecast cascade UNION) | `.from('data_freshness_v').select('last_ingested_at')` | WIRED | View contract preserved; SSR call unchanged; cascade stages now feed the badge. |
| `ModelAvailabilityDisclosure.svelte` | `/api/forecast::modelBacktestStatus` | prop wired in CalendarRevenueCard + CalendarCountsCard | WIRED | `backtestStatus={overlay.forecastData?.modelBacktestStatus ?? null}` on both Calendar cards. Pill renders `verdictColorClass(status)` with cold-start gray fallback. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| `ModelAvailabilityDisclosure.svelte` backtest pills | `backtestStatus` prop | `/api/forecast` returns `modelBacktestStatus` from `forecast_quality WHERE evaluation_window='rolling_origin_cv'` | DEV round-trip showed cold-start (no rolling_origin_cv rows in DEV yet) — pills correctly fall back to gray PENDING. Round B per 17-10 wrote >0 rolling_origin_cv rows during a live workflow_dispatch run; pills were verified live. | FLOWING |
| `FreshnessLabel.svelte` | `lastIngestedAt` | `data_freshness_v.last_ingested_at` (now MIN over transactions + pipeline_runs forecast steps) | UNION branch returns real `MAX(finished_at)` from real `pipeline_runs` rows on DEV; threshold logic verified in unit tests. | FLOWING |
| `ACCURACY-LOG.md` | rendered Markdown | `forecast_quality` rolling_origin_cv rows + `latest evaluated_at week filter` | Function correctly groups by (model, horizon) + verdict — but `qhat = 0.0` is hardcoded; published number is meaningless until wired (REVIEW WR-04). | STATIC (qhat) / FLOWING (RMSE+verdict) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Phase 17 pytest suite green | `python3 -m pytest scripts/forecast/tests/test_{backtest,gate,conformal,naive_dow_with_holidays,quality_gate_check,run_all_feature_flags,workflow_yaml,accuracy_log,fit_scripts_argparse}.py` | 89 passed in 15.26s | PASS |
| Phase 17 vitest UI suite green | `npm run test -- --run tests/unit/ModelAvailabilityDisclosure.test.ts tests/unit/cards.test.ts` | Test Files 2 passed (2); Tests 20 passed (20) | PASS |
| `backtest.py --help` exits 0 | `python -m scripts.forecast.backtest --help` | (per 17-05-SUMMARY) usage shown with --models / --run-date | PASS (verified in summary; not re-run here) |
| `quality_gate_check.py` cold-start exits 0 | `python -m scripts.forecast.quality_gate_check` (against DEV with no rolling_origin_cv rows) | per 17-08-SUMMARY: `[quality_gate_check] PASS — ... or no rolling_origin_cv rows yet.` | PASS |
| Migration 0067 + 0068 applied to DEV | DB MCP information_schema check | per 17-10-SUMMARY Round-A evidence: 5 new columns visible; 6 model_% rows seeded; data_freshness_v references pipeline_runs | PASS |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|---|---|---|---|---|
| BCK-01 | 17-04, 17-05 | Rolling-origin CV at 4 horizons; RMSE+MAPE per (model × horizon × fold) → forecast_quality | SATISFIED (with D-03 deviation) | Manual numpy loop replaces statsforecast.cross_validation per documented D-03 lock; same observable contract (4 folds, 4 horizons, RMSE/MAPE/bias rows in forecast_quality with evaluation_window='rolling_origin_cv'). |
| BCK-02 | 17-02, 17-05, 17-09 | Conformal CI calibration at h=35 (n_windows=4); UI badge for UNCALIBRATED at h=120/365 | SATISFIED | `conformal.py::calibrate_conformal_h35` uses split-conformal absolute-residual quantile (Vovk/Shafer); pooled across N_FOLDS=4 fold residuals at h=35; result written to `forecast_quality.qhat`. UNCALIBRATED verdict applied to h=120/365 unconditionally in `_gate_decision`. UI: 4-horizon pills with i18n'd `model_avail_backtest_uncalibrated` rendering. |
| BCK-03 | 17-03, 17-05 | Regressor-aware naive baseline; gate uses higher of two naive RMSEs | PARTIALLY SATISFIED | `naive_dow_with_holidays_fit.py` correctly implements multiplicative holiday-flag-combo multiplier with same exog regressors as competing models. Gate `max(naive_dow, naive_dow_with_holidays)` formula present at backtest.py:346. **HOWEVER:** baseline-missing path silently bypasses the comparison (BL-01 — see gap #1). Spec is satisfied when both baselines run successfully; spec is NOT satisfied when either fails. |
| BCK-04 | 17-01, 17-05, 17-06 | Promotion gate: ≥10% RMSE improvement vs naive baseline; gate failure flips feature_flags; run_all honors flags | PARTIALLY SATISFIED | feature_flags seed (0067) + AND-intersect read in run_all.py + R7 baseline-skip guard all VERIFIED. Gate-flip MECHANISM correct. **Gate DECISION broken via BL-01** — when a baseline RMSE is missing, threshold becomes infinite and every challenger PASSes. The promotion gate is not actually a gate under that failure mode. See gap #1. |
| BCK-05 | 17-07 | `forecast-backtest.yml` weekly Tuesday 23:00 UTC | DEVIATION ACCEPTED | Workflow exists with `push: paths: data/**` + `workflow_dispatch`. No schedule:cron. Owner-driven cadence (per 17-10 SUMMARY decision). Documentation in `ACCURACY-LOG.md:3` and `write_accuracy_log.py:36` still claim Tuesday cron — REVIEW WR-03 doc/code drift. Phase explicitly accepts this in 17-10. SC4 wording is not literally satisfied; phase decided to redefine the cadence. |
| BCK-06 | 17-08 | `forecast-quality-gate.yml` PR-time gate, <5 min | SATISFIED | Workflow + script + tests all green. PARTIAL on workflow_dispatch verification (404 on feature ref) is merge-deferred. Logic verified locally. |
| BCK-07 | 17-07 | `docs/forecast/ACCURACY-LOG.md` auto-committed weekly with PASS/FAIL/PENDING verdicts; honest-failure copy when no challenger | SATISFIED (skeleton + first run merge-deferred) | Skeleton committed; `write_accuracy_log.py` renders correctly per 6 unit tests. qhat=0 placeholder is a known follow-up (WR-04). First auto-commit fires post-merge on first `data/**` push. |
| BCK-08 | 17-01, 17-09 | Freshness-SLO badge when any cascade stage >24h stale; CI fault-injection verifies | SATISFIED at data layer | data_freshness_v UNION branch + FreshnessLabel 24h threshold verified end-to-end on DEV. CI fault-injection test (SC6 sub-clause) not implemented; not a blocker per phase scope. |

**Coverage:** 8/8 BCK requirements accounted for. 5 SATISFIED outright, 2 PARTIALLY SATISFIED (BCK-03 + BCK-04, both blocked on BL-01), 1 with accepted deviation (BCK-05 cadence redefined).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `scripts/forecast/backtest.py` | 344-347 | `float('inf')` default for missing baseline → silent gate bypass | BLOCKER | Gate fails open. Source of gap #1. |
| `scripts/forecast/backtest.py` | 435-676 | `_cleanup_sentinel_rows` outside `finally:` | BLOCKER | Fold rows leak into forecast_daily on exception; `forecast_daily_mv DISTINCT ON` keeps stale rows visible. Source of gap #2. |
| `src/lib/forecastOverlay.svelte.ts` | 135 | `.catch(() => { forecastData = null })` swallows error silently | WARNING (REVIEW WR-01) | Re-introduces the 2026-04-17 incident pattern. Already in project memory `feedback_silent_error_isolation`. Not a blocker but a regression risk against an existing lesson. |
| `src/lib/components/CalendarRevenueCard.svelte` | 219-244 | RAF chain has no cancellation → race on rapid effect re-runs | WARNING (REVIEW WR-02) | UX scroll jitter; `lastSetScrollLeft` desync. Not a blocker. |
| `docs/forecast/ACCURACY-LOG.md` & `scripts/forecast/write_accuracy_log.py:36` | 3 / 36 | Claim "Tuesday 23:00 UTC cron" that doesn't exist in workflow | WARNING (REVIEW WR-03) | Doc/code drift. Misleads future maintainers. Cosmetic but persistent. |
| `scripts/forecast/backtest.py` | 594 (call site) + `conformal.py:34,42` | NaN written to `forecast_quality.qhat` on cold-start | WARNING (REVIEW WR-04) | Postgres accepts NaN in double precision but downstream consumers querying `WHERE qhat IS NOT NULL` see it as "present"; format-time crashes possible. |
| `scripts/forecast/quality_gate_check.py` | 13-15 | Dead imports (`defaultdict`, `datetime`, `Optional`) | INFO (REVIEW WR-05) | Linter trip; cold-start time penalty on 5-min PR gate. Cosmetic. |
| `scripts/forecast/quality_gate_check.py` | 30-33 | `else row['flag_key']` branch can leak unprefixed flag keys; `if row.get('enabled', True)` admits unknown rows | WARNING (REVIEW WR-06) | Defense-in-depth comprehension is the OPPOSITE of defensive. Not a blocker because `.like('flag_key', 'model_%')` filter at line 25 currently makes the path unreachable. |
| `src/lib/components/ModelAvailabilityDisclosure.svelte` | 143 | Hardcoded English `Backtest` column header in i18n'd table | WARNING (REVIEW WR-07) | Non-EN locales (DE/JA/ES/FR) see English header above localised pills. Cosmetic. |
| `scripts/forecast/write_accuracy_log.py` | 78-82 | String comparison of timestamps with mixed `Z` vs `+00:00` suffixes | WARNING (REVIEW WR-08) | Wrong-by-a-day filter possible when PostgREST mixes formats. |
| `scripts/forecast/write_accuracy_log.py` | 224 | `qhat = 0.0` hardcoded placeholder | WARNING (REVIEW WR-04 cont.) | Published "qhat_95 = 0 EUR" is a placeholder lie until BCK-02 wired. |
| `scripts/forecast/write_accuracy_log.py` | 231-235 | `production_model` non-deterministic on multi-PASS challengers | WARNING (REVIEW WR-09) | ACCURACY-LOG header could flicker between sarimax/ets across runs without an actual model change. |

### Human Verification Required

None. All required behaviors are either programmatically verifiable in the test suite or covered by the 17-10 phase-final QA Round-trip evidence on DEV. The two BLOCKERS surfaced by the code review are observable failure modes in the code itself and require code fixes, not human judgement.

### Gaps Summary

Phase 17 ships a structurally complete backtest + gate + freshness pipeline. 4 of 6 ROADMAP success criteria are verified in code and tests; 1 has an accepted owner-cadence deviation (SC4); the remaining 2 (SC2 + SC3 — the gate's central correctness contract) are FAILED through a single root cause: the `_gate_decision` function silently passes any challenger when a baseline RMSE is missing.

The two BLOCKERS share a theme: **the happy path is well-tested, the failure path is not**. BL-01 turns a missing baseline (a data-quality signal) into a pass-through. BL-02 turns an exception during fold execution into pollution of the BAU dashboard's `forecast_daily` reads. Plan 17-05's 33-test suite (TestFoldCutoffs, TestUncalibratedHorizons, TestGateDecision, TestGate*) covers the math and the happy-path mechanics but does not exercise either of these failure paths.

Both fixes are small (≤10 LOC each) and well-localised:

1. **BL-01 (gap #1):** Replace `float('inf')` defaults with explicit None checks in `_gate_decision`. When either baseline is missing, return PENDING for all models in that (kpi, horizon) slice. Add a regression test.
2. **BL-02 (gap #2):** Move `_cleanup_sentinel_rows` into a `finally:` block. Add a test that simulates an exception during the fold loop and asserts cleanup still runs.

The phase's 89/89 pytest + 20/20 vitest green status is real — the bugs are in untested code paths. The R7 baseline-never-flipped guard and the FORECAST_TRACK scope-isolation are both correctly implemented and well-tested. The 119ad45 defect (subprocess module-name + FORECAST_TRACK env honor) is a third lesson in the same theme: subprocess pathway hidden from unit tests; surfaced only on live DEV run.

The cadence redefinition (BCK-05 cron → push:data/**) is a phase-level decision recorded in 17-10 — flagged here for transparency but not as a blocker. The ACCURACY-LOG and `write_accuracy_log.py` docstrings still claim the original cadence; that should be reconciled (REVIEW WR-03) before next ship.

**Recommendation:** /gsd-plan-phase --gaps to close BL-01 and BL-02 before /gsd-ship. Both are 5-minute fixes with test additions; not worth deferring the way SC4's cadence change was deferred.

---

_Verified: 2026-05-06T19:08:05Z_
_Verifier: Claude (gsd-verifier)_
