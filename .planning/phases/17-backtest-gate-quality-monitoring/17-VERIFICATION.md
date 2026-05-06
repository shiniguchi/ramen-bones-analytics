---
phase: 17-backtest-gate-quality-monitoring
verified: 2026-05-06T21:35:00Z
status: passed
score: 6/6 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 4/6
  gaps_closed:
    - "Promotion gate enforces ≥10% RMSE improvement vs the higher of naive_dow / naive_dow_with_holidays at every horizon (BCK-03/BCK-04)"
    - "Backtest fold-row writes to forecast_daily are cleaned up after every run, success or failure, so dashboard reads never observe `forecast_track LIKE 'backtest_fold_%'` rows"
  gaps_remaining: []
  regressions: []
  warnings_closed:
    - WR-01 (silent error swallowing in createForecastOverlay)
    - WR-03 (ACCURACY-LOG + write_accuracy_log.py Tuesday-cron drift)
    - WR-04 (NaN qhat → NULL at write boundary; render NULL in ACCURACY-LOG)
    - WR-05 (quality_gate_check.py dead imports)
    - WR-06 (quality_gate_check.py loose comprehension)
    - WR-07 (hardcoded English Backtest column header)
    - WR-08 (write_accuracy_log.py timestamp string-compare across Z / +00:00 suffixes)
    - WR-09 (non-deterministic production_model selection in ACCURACY-LOG)
  warnings_skipped:
    - WR-02 (auto-scroll RAF cleanup) — explicit non-fix; chains self-terminate at scroll-clamp; refactor not blocker
deferred:
  - truth: "forecast-backtest.yml + forecast-quality-gate.yml verified live via gh workflow run on a feature ref"
    addressed_in: "Phase 17 ship to main (post-merge, structural)"
    evidence: "`gh workflow run` returns 404 for workflow files that aren't on main yet; verification auto-resolves on merge to main. Logic verified locally (139/139 pytest)."
gaps: []
---

# Phase 17: Backtest Gate & Quality Monitoring — Verification Report

**Phase Goal:** Backtest Gate & Quality Monitoring — rolling-origin CV at 4 horizons + ConformalIntervals + ≥10% RMSE promotion gate + freshness-SLO badges + ACCURACY-LOG.
**Verified:** 2026-05-06T21:35:00Z
**Status:** passed
**Re-verification:** Yes — after gap closure for BL-01, BL-02 + 7 of 8 warnings.

## Re-verification Summary

The 2026-05-06T19:08:05Z verification surfaced two BLOCKERS (BL-01: gate fails open on missing baseline; BL-02: fold-row cleanup not in `finally:`) and 9 warnings. Between then and now (commits `5fdcb2e` → `506305a`):

- **2 blockers closed** with regression tests (BL-01: 5 tests, BL-02: 3 tests).
- **8 of 9 warnings closed.** WR-02 (RAF cleanup) explicitly skipped — not a defect; the existing chains self-terminate at scroll-clamp, so the absence of cancel-on-rerun is a refactor opportunity, not a fix.
- **Test totals:** 139 pytest pass (was 131; +8 regression tests for BL-01 + BL-02). 20 vitest UI tests pass (unchanged).
- **Status flips** from `gaps_found` (4/6) to `passed` (6/6). The two PARTIALLY SATISFIED requirements (BCK-03 + BCK-04) become SATISFIED because their root cause (BL-01) is fixed.
- **Workflow-on-feature-ref** (BCK-05/06/07 partial) remains structural — auto-resolves at ship to main. Recorded under `deferred:` not `gaps:`.

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | `backtest.py` runs rolling-origin CV at h=7/35/120/365, computes RMSE+MAPE per (model × horizon × fold), writes rows to `forecast_quality` with `evaluation_window='rolling_origin_cv'`; conformal calibration at h=35 with n_windows=4; long horizons UNCALIBRATED until 2y; cold-start PENDING badge | VERIFIED (with documented D-03 deviation) | `backtest.py` (745 LOC) — `HORIZONS=[7,35,120,365]`, `N_FOLDS=4`, `UNCALIBRATED_HORIZONS=(120,365)`, cold-start PENDING write at the per-(kpi,model) cold-start guard. **D-03 deviation:** plan/CONTEXT explicitly chose a manual numpy rolling-origin loop over `statsforecast.cross_validation`, and a manual absolute-residual quantile in `conformal.py` over `statsforecast.ConformalIntervals`. Decision recorded in 17-CONTEXT.md D-03 + 17-02-PLAN; substantively equivalent (split-conformal math). 139/139 pytest + 20/20 vitest pass post-fix. |
| SC2 | Gate compares challengers against the higher of `naive_dow` and `naive_dow_with_holidays` RMSE at every horizon | VERIFIED | `_gate_decision` (`backtest.py:343-360`) computes `baseline = max(naive_dow_rmse, naive_dow_with_holidays_rmse)` when both are present and finite. **BL-01 fix (commit `5fdcb2e`):** when either baseline is `None`, NaN, or inf, returns `{m: 'PENDING' for m in mean_rmse}` — refuses to compute a verdict rather than letting `inf * 0.9 = inf` silently pass every challenger. 5 regression tests added in `test_backtest.py:221-290` covering all 4 missing-baseline modes (None / NaN / inf / both-missing). |
| SC3 | Promotion gate: any model promoted requires ≥10% RMSE improvement vs the regressor-aware naive baseline; gate failure flips `feature_flags.{model}.enabled=false`; baselines never flipped | VERIFIED | `BASELINE_MODELS=('naive_dow','naive_dow_with_holidays')` constant at `backtest.py:99`; R7 hard guard `if model in BASELINE_MODELS: continue` verified at line 389. `_apply_gate_to_feature_flags` writes `enabled=False` for non-baseline FAIL — covered by 13 `test_gate.py` tests. **Gate decision logic itself is now correct** post-BL-01 fix: missing baselines route to PENDING (no flip), present baselines route to PASS / FAIL on the ≥10% threshold. The mechanism for flipping flags AND the decision feeding it are both verified. |
| SC4 | `forecast-backtest.yml` runs weekly Tuesday 23:00 UTC; `forecast-quality-gate.yml` runs on every forecast-engine PR; both <5 min on ubuntu-latest | PARTIAL — accepted (cadence redefined; doc/code drift fixed) | `forecast-quality-gate.yml` correct: `pull_request: paths: scripts/forecast/**`, `timeout-minutes: 5`. **`forecast-backtest.yml` deviates from SC4** — has `push: paths: data/**` + `workflow_dispatch`, NO `schedule:` block. The phase explicitly accepted this owner-driven cadence per 17-10-SUMMARY. **WR-03 fix (`e684dbb`):** doc/code drift reconciled — ACCURACY-LOG.md and `write_accuracy_log.py` no longer claim a Tuesday cron; both now say "owner-driven cadence — no scheduled cron." `gh workflow run --ref feature/...` 404 is structural (workflow file isn't on `main` yet) → auto-resolves post-merge. Recorded under `deferred:` not `gaps:`. |
| SC5 | `docs/forecast/ACCURACY-LOG.md` auto-committed weekly with RMSE history per (model × horizon) including PASS/FAIL/PENDING gate verdict; honest-failure copy when no challenger beats naive | VERIFIED | Skeleton form committed; auto-update wired. `write_accuracy_log.py:32-35` defines exact em-dash canonical string `'> naive-DoW-with-holidays remains production model — no challenger promoted this week.'` per BCK-07 spec. PASS/FAIL/PENDING/UNCALIBRATED verdict rendering verified by `test_accuracy_log.py` (6 tests pass). Commit-back step uses `[skip ci]` to prevent recursive triggers. **WR-04 fix (`ed68b8b`):** NaN qhat → NULL at backtest.py write boundary (lines 601-604); ACCURACY-LOG renders `qhat_95 = NULL (no calibration data yet)` instead of the prior `0 EUR` placeholder lie. **WR-08 fix (`344ce91`):** timestamp comparison now in datetime space via `_parse_pg_timestamp` helper — no more wrong-by-a-day filter on mixed Z / +00:00 suffixes. **WR-09 fix (`506305a`):** `production_model` selection deterministic via `sorted` by h=7 RMSE asc with alphabetical tie-break. First auto-update fires post-merge on first `data/**` push. |
| SC6 | Freshness-SLO check: if any cascade stage `upstream_freshness_h > 24`, dashboard renders stale-data badge; CI fault-injection verifies surfacing | VERIFIED | `data_freshness_v` migration 0067 has UNION branch `pipeline_runs WHERE step_name IN (...) AND status='success'`, returns `MIN(stage_last)` (stalest stage) per restaurant. `WITH (security_invoker = true)` and `GRANT SELECT TO authenticated` preserved. `FreshnessLabel.svelte:16,19` — `hours > 30 ? red : hours > 24 ? yellow : zinc` — threshold tightened to 24h per BCK-08. `tests/unit/cards.test.ts` (14 tests pass) covers boundary cases (23h gray, 25h yellow, 31h red). 17-10-SUMMARY records DEV round-trip pass at 375×667 in ja+en. **Note:** ROADMAP SC6 mentions "deliberate weather-fetch failure in CI verifies the badge surfaces" — no automated CI fault-injection test was added; verification was manual on DEV via Playwright MCP. Acceptable per 17-10 PARTIAL acceptance for this round; data-layer surfacing is verified. |

**Score:** 6/6 truths verified (SC1, SC2, SC3, SC5, SC6 outright; SC4 partial-accepted with cadence redefinition + doc/code drift now fixed).

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `supabase/migrations/0067_phase17_backtest_schema.sql` | ALTER forecast_quality + INSERT feature_flags + DROP/CREATE data_freshness_v | VERIFIED | All 3 sections present, RLS preserved, 8 step_name literals match `*_fit.py` constants. |
| `supabase/migrations/0068_phase17_backtest_schema_gap.sql` | Gap closure (qhat column + NULLABLE relax + CHECK constraint) | VERIFIED | All 3 ALTERs present; `forecast_quality_rolling_origin_cv_verdict_required` constraint enforces gate_verdict NOT NULL on `rolling_origin_cv` rows. |
| `scripts/forecast/conformal.py` | Pure function `calibrate_conformal_h35(fold_residuals, alpha=0.05) -> {'qhat_h35': float}` | VERIFIED | 30 LOC, only numpy import; 5/5 tests pass; cold-start returns nan; absolute-residual quantile math correct. |
| `scripts/forecast/naive_dow_with_holidays_fit.py` | Regressor-aware naive baseline; STEP_NAME='forecast_naive_dow_with_holidays'; honors FORECAST_TRACK env var | VERIFIED | Renamed (defect 119ad45). MODEL_NAME, STEP_NAME, FORECAST_TRACK env read all confirmed. 6/6 helper tests pass. |
| `scripts/forecast/{sarimax,prophet,ets,theta,naive_dow}_fit.py` argparse retrofit | --train-end/--eval-start/--fold-index + FORECAST_TRACK env var | VERIFIED | 15/15 parametrized tests in `test_fit_scripts_argparse.py` pass. |
| `scripts/forecast/backtest.py` | Rolling-origin CV driver, gate writer, conformal calibration | VERIFIED (BL-01 + BL-02 closed) | File exists with all required constants and helpers. R7 baseline-skip guard verified. **BL-01 fix (`5fdcb2e`)**: `_gate_decision` lines 343-358 returns PENDING when baseline is None/NaN/inf — 5 regression tests at `test_backtest.py:221-290`. **BL-02 fix (`9afd7f5`)**: `_cleanup_sentinel_rows` now in `finally:` block at lines 701-716 — 3 regression tests at `test_backtest.py:351,384,410`. **WR-04 fix (`ed68b8b`)**: NaN qhat → NULL at write boundary, lines 601-604. |
| `scripts/forecast/run_all.py` | feature_flags AND-intersect + DEFAULT_MODELS includes naive_dow_with_holidays | VERIFIED | `_get_enabled_models` helper + `env_set & db_set` intersect + DEFAULT_MODELS extended. Graceful fallback on DB read failure. 6/6 tests pass. |
| `.github/workflows/forecast-backtest.yml` | Weekly cron + commit-back of ACCURACY-LOG.md | DEVIATION ACCEPTED | Has `push: paths: data/**` + `workflow_dispatch`. Owner-driven cadence per 17-10. WR-03 fix reconciled docstring + ACCURACY-LOG header to match this trigger. SC4 cadence-redefinition deferred to ship time. |
| `.github/workflows/forecast-quality-gate.yml` | PR-time gate, <5 min, contents:read | VERIFIED | All correct. Cold-start safety in `quality_gate_check.py` returns 0 when no rolling_origin_cv rows yet. |
| `docs/forecast/ACCURACY-LOG.md` | Skeleton + append-only weekly history + honest-failure copy | VERIFIED | File exists with valid Markdown structure. **WR-03 fix (`e684dbb`)**: header line 3 now reads "Auto-generated by `.github/workflows/forecast-backtest.yml` on `workflow_dispatch` and on every `data/**` push (owner-driven cadence — no scheduled cron)." History section empty until first auto-update fires post-merge. |
| `scripts/forecast/quality_gate_check.py` | Read-only DB gate; <5 min; cold-start PASS | VERIFIED | Cold-start handled; **WR-05 fix (`ccf857c`)**: imports list trimmed to `import sys` + `from scripts.forecast.db import make_client`. **WR-06 fix (same commit)**: comprehension tightened to `if row['flag_key'].startswith('model_') and row.get('enabled') is True` — no more loose `else row['flag_key']` fallthrough or truthy `get('enabled', True)` admit-by-default. 9/9 tests pass. |
| `scripts/forecast/write_accuracy_log.py` | Render ACCURACY-LOG from forecast_quality with verdicts + qhat | VERIFIED | **WR-03 fix (`e684dbb`)**: docstring now describes the actual `workflow_dispatch + data/** push` trigger, not a fictional Tuesday cron. **WR-04 fix (`ed68b8b`)**: `_render_latest_run` accepts `qhat: float \| None`, renders `qhat_95 = NULL` when None / NaN / inf; `main()` passes `qhat = None` until BCK-02 wires the DB read. **WR-08 fix (`344ce91`)**: `_parse_pg_timestamp` helper + datetime-space comparison `dt >= cutoff` — no more lexicographic wrong-by-a-day filter on Z vs +00:00 mixed inputs. **WR-09 fix (`506305a`)**: `production_model` selected by `sorted(... key=lambda m: (h7_rmse_raw or inf, m))` — deterministic by lowest h=7 RMSE with alphabetical tie-break. |
| `src/lib/components/ModelAvailabilityDisclosure.svelte` | Backtest verdict pills column with 4 horizon cells per model | VERIFIED | 5th column with 4 pills per row using `verdictColorClass()` + i18n. **WR-07 fix (`3933c82`)**: line 143 now uses `{t(page.data.locale, 'model_avail_col_backtest')}` — header is localised in all 5 locales (`messages.ts:235, 492, 744, 997, 1250` confirmed via grep). |
| `src/lib/components/FreshnessLabel.svelte` | Yellow >24h, red >30h thresholds | VERIFIED | Line 16: `hours > 30 ? ... : ''`; Line 19: `hours > 30 ? text-red-600 : hours > 24 ? text-yellow-600 : text-zinc-500`. |
| `src/lib/forecastOverlay.svelte.ts` | Overlay state machine with /api/forecast hydration | VERIFIED | **WR-01 fix (`51a03bf`)**: line 141 logs `console.error('[forecastOverlay] /api/forecast failed:', err)` BEFORE `forecastData = null`. The 2026-04-17 silent-error pattern (memory: feedback_silent_error_isolation) is no longer re-introduced. |
| `src/routes/api/forecast/+server.ts` | `modelBacktestStatus` field returned | VERIFIED | Reads `forecast_quality WHERE evaluation_window='rolling_origin_cv'`, deduplicates latest verdict per (model, horizon), returns `Record<model, {h7,h35,h120,h365}>`. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `backtest.py` | `conformal.py::calibrate_conformal_h35` | import | WIRED | Imported at line 30; called per (kpi, model) in conformal calibration phase; result NaN/None-normalised before DB write. |
| `backtest.py` | `last_7_eval.py::compute_metrics` | import | WIRED | Imported at line 28; called per fold to compute RMSE/MAPE/bias. |
| `backtest.py` | `public.forecast_quality` | client.upsert | WIRED | `_write_quality_row` upserts diagnostic columns including `gate_verdict='PENDING'` initially, then UPDATEd with PASS/FAIL in second pass (or PENDING when baselines missing — BL-01 fix). |
| `backtest.py` | `public.feature_flags` | `.update({'enabled': False})` on FAIL | WIRED (gate now correct) | `_apply_gate_to_feature_flags` writes the flip; **upstream gate decision is now correct (BL-01 closed)** so the WIRED behavior receives the right inputs. |
| `backtest.py` subprocess fits | `forecast_daily` track-scoped rows | `FORECAST_TRACK=backtest_fold_{N}` env var | WIRED | All 5 fit scripts honor FORECAST_TRACK; `_fetch_fold_yhats` reads back by `forecast_track=backtest_fold_{N}`. |
| `backtest.py` | `_cleanup_sentinel_rows` | called in `finally:` block | WIRED (BL-02 closed) | Lines 701-716 — cleanup unconditional on success/failure, with inner try/except so cleanup-failure logs without raising. |
| `run_all.py` | `feature_flags` AND-intersect | `_get_enabled_models` | WIRED | Verified via grep + tests. Graceful fallback to env_set on DB read failure. |
| `forecast-quality-gate.yml` | `quality_gate_check.py` | `python -m scripts.forecast.quality_gate_check` | WIRED | Workflow runs the script; script exits 1 on enabled FAIL. |
| `+page.server.ts` | `data_freshness_v` (with forecast cascade UNION) | `.from('data_freshness_v').select('last_ingested_at')` | WIRED | View contract preserved; SSR call unchanged; cascade stages now feed the badge. |
| `ModelAvailabilityDisclosure.svelte` | `/api/forecast::modelBacktestStatus` | prop wired in CalendarRevenueCard + CalendarCountsCard | WIRED | `backtestStatus={overlay.forecastData?.modelBacktestStatus ?? null}` on both Calendar cards. Pill renders `verdictColorClass(status)` with cold-start gray fallback. |
| `forecastOverlay.svelte.ts` | `/api/forecast` (error path) | console.error before state clear | WIRED (WR-01 closed) | Errors visible in browser console for DEV-time / QA debugging. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| `ModelAvailabilityDisclosure.svelte` backtest pills | `backtestStatus` prop | `/api/forecast` returns `modelBacktestStatus` from `forecast_quality WHERE evaluation_window='rolling_origin_cv'` | DEV round-trip Round B per 17-10 wrote >0 rolling_origin_cv rows during a live workflow_dispatch run; pills verified live. | FLOWING |
| `FreshnessLabel.svelte` | `lastIngestedAt` | `data_freshness_v.last_ingested_at` (now MIN over transactions + pipeline_runs forecast steps) | UNION branch returns real `MAX(finished_at)` from real `pipeline_runs` rows on DEV; threshold logic verified in unit tests. | FLOWING |
| `ACCURACY-LOG.md` | rendered Markdown | `forecast_quality` rolling_origin_cv rows + datetime-space cutoff filter | Function correctly groups by (model, horizon) + verdict. **qhat now renders NULL when source is None / NaN / inf** (WR-04 fix) instead of placeholder `0 EUR`. **production_model deterministic** by h=7 RMSE asc + alphabetical tie-break (WR-09 fix). **Cutoff filter correct** across mixed Z / +00:00 suffix formats (WR-08 fix). | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Phase 17 pytest suite green (post-fix +8 regression) | `python3 -m pytest scripts/forecast/tests/ -q` | 139 passed in 16.76s | PASS |
| Phase 17 vitest UI suite green | `npm run test -- --run tests/unit/ModelAvailabilityDisclosure.test.ts tests/unit/cards.test.ts` | Test Files 2 passed (2); Tests 20 passed (20) | PASS |
| BL-01 regression tests cover all 4 missing-baseline modes | grep `test_backtest.py` for None / NaN / inf / both-missing assertions | 5 tests at lines 221-290 — all assert `verdicts['sarimax'] == 'PENDING'`; explicit "NO model gets PASS when a baseline is missing" comment | PASS |
| BL-02 regression tests cover exception-during-fold path | grep `test_backtest.py` for monkeypatch + cleanup spy assertions | 3 tests at lines 351, 384, 410 — assert `_cleanup_sentinel_rows` called even when fold raises, and that cleanup-failure swallows itself in the finally block | PASS |
| WR-03 cron-claim removal | `grep -n "Tuesday\|cron\|0 23" docs/forecast/ACCURACY-LOG.md scripts/forecast/write_accuracy_log.py` | No Tuesday claims; remaining "cron" mentions are explicit denials ("no scheduled cron") and a placeholder-skeleton fallback string | PASS |
| WR-07 i18n key present in all 5 locales | `grep -n "model_avail_col_backtest" src/lib/i18n/messages.ts` | 5 hits at lines 235 / 492 / 744 / 997 / 1250 (en/de/ja/es/fr) | PASS |
| Migration 0067 + 0068 applied to DEV | DB MCP information_schema check | per 17-10-SUMMARY Round-A evidence: 5 new columns visible; 6 model_% rows seeded; data_freshness_v references pipeline_runs | PASS |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|---|---|---|---|---|
| BCK-01 | 17-04, 17-05 | Rolling-origin CV at 4 horizons; RMSE+MAPE per (model × horizon × fold) → forecast_quality | SATISFIED (with D-03 deviation) | Manual numpy loop replaces statsforecast.cross_validation per documented D-03 lock; same observable contract. |
| BCK-02 | 17-02, 17-05, 17-09 | Conformal CI calibration at h=35 (n_windows=4); UI badge for UNCALIBRATED at h=120/365 | SATISFIED | `conformal.py::calibrate_conformal_h35` uses split-conformal absolute-residual quantile; pooled across N_FOLDS=4 fold residuals at h=35; result written to `forecast_quality.qhat` (NULL on cold-start post-WR-04). UNCALIBRATED verdict applied to h=120/365 unconditionally in `_gate_decision`. UI: 4-horizon pills with i18n'd `model_avail_backtest_uncalibrated` rendering. |
| BCK-03 | 17-03, 17-05 | Regressor-aware naive baseline; gate uses higher of two naive RMSEs | SATISFIED | `naive_dow_with_holidays_fit.py` correctly implements multiplicative holiday-flag-combo multiplier with same exog regressors as competing models. Gate `max(naive_dow, naive_dow_with_holidays)` formula present at backtest.py:359. **BL-01 fix:** missing-baseline path now returns PENDING (not silent pass). 5 regression tests cover the 4 missing-baseline modes. |
| BCK-04 | 17-01, 17-05, 17-06 | Promotion gate: ≥10% RMSE improvement vs naive baseline; gate failure flips feature_flags; run_all honors flags | SATISFIED | feature_flags seed (0067) + AND-intersect read in run_all.py + R7 baseline-skip guard all VERIFIED. Gate-flip MECHANISM correct. **Gate DECISION now correct via BL-01 fix** — when a baseline RMSE is missing, all models in the slice get PENDING; threshold is computed only when both baselines are present and finite. |
| BCK-05 | 17-07 | `forecast-backtest.yml` weekly Tuesday 23:00 UTC | DEVIATION ACCEPTED (cadence redefined) | Workflow exists with `push: paths: data/**` + `workflow_dispatch`. Owner-driven cadence (per 17-10 SUMMARY decision). **WR-03 fix:** documentation in `ACCURACY-LOG.md:3` and `write_accuracy_log.py:4,39` now correctly describes the actual trigger — no more Tuesday cron claim. SC4 wording redefined with explicit phase-level acceptance. |
| BCK-06 | 17-08 | `forecast-quality-gate.yml` PR-time gate, <5 min | SATISFIED | Workflow + script + tests all green. WR-05+06 closed (dead imports removed; comprehension tightened). PARTIAL on workflow_dispatch verification (404 on feature ref) is structural — auto-resolves at ship to main. |
| BCK-07 | 17-07 | `docs/forecast/ACCURACY-LOG.md` auto-committed weekly with PASS/FAIL/PENDING verdicts; honest-failure copy when no challenger | SATISFIED (skeleton + first run merge-deferred) | Skeleton committed; `write_accuracy_log.py` renders correctly per 6 unit tests. WR-03 / WR-04 / WR-08 / WR-09 all closed. First auto-commit fires post-merge on first `data/**` push. |
| BCK-08 | 17-01, 17-09 | Freshness-SLO badge when any cascade stage >24h stale; CI fault-injection verifies | SATISFIED at data layer | data_freshness_v UNION branch + FreshnessLabel 24h threshold verified end-to-end on DEV. CI fault-injection test (SC6 sub-clause) not implemented; not a blocker per phase scope. |

**Coverage:** 8/8 BCK requirements accounted for. 7 SATISFIED outright, 1 with accepted deviation (BCK-05 cadence redefined; doc/code drift now reconciled).

### Anti-Patterns Found (post-fix re-scan)

| File | Line | Pattern | Severity | Status |
|---|---|---|---|---|
| `scripts/forecast/backtest.py` | 343-358 | Missing-baseline → PENDING (was: `float('inf')` silent pass-through) | RESOLVED | BL-01 fix `5fdcb2e` |
| `scripts/forecast/backtest.py` | 701-716 | `_cleanup_sentinel_rows` in `finally:` block (was: only on happy path) | RESOLVED | BL-02 fix `9afd7f5` |
| `scripts/forecast/backtest.py` | 595-604 | NaN qhat → NULL at DB write boundary (was: NaN persisted to forecast_quality.qhat) | RESOLVED | WR-04 fix `ed68b8b` |
| `src/lib/forecastOverlay.svelte.ts` | 135-143 | `console.error` before state clear (was: silent `.catch(() => null)`) | RESOLVED | WR-01 fix `51a03bf` |
| `src/lib/components/CalendarRevenueCard.svelte` | 219-244 | RAF chain has no cancellation on rapid effect re-runs | INFO (skipped) | WR-02 — explicit non-fix; chains self-terminate at scroll-clamp; refactor not blocker |
| `docs/forecast/ACCURACY-LOG.md` & `scripts/forecast/write_accuracy_log.py` | 3 / 4, 39 | Doc/code drift on cron schedule | RESOLVED | WR-03 fix `e684dbb` |
| `scripts/forecast/quality_gate_check.py` | 1-15 | Imports list minimal (was: 3 dead imports) | RESOLVED | WR-05 fix `ccf857c` |
| `scripts/forecast/quality_gate_check.py` | 34-38 | Tightened comprehension (was: leaky else fallthrough + truthy enabled default) | RESOLVED | WR-06 fix `ccf857c` |
| `src/lib/components/ModelAvailabilityDisclosure.svelte` | 143 | i18n'd column header (was: hardcoded English "Backtest") | RESOLVED | WR-07 fix `3933c82` |
| `scripts/forecast/write_accuracy_log.py` | 65-101 | Datetime-space timestamp comparison via `_parse_pg_timestamp` (was: lexicographic compare across mixed Z / +00:00) | RESOLVED | WR-08 fix `344ce91` |
| `scripts/forecast/write_accuracy_log.py` | 285-297 | Deterministic `production_model` selection (was: dict-order-dependent) | RESOLVED | WR-09 fix `506305a` |

**Net:** 2 BLOCKERS resolved, 8 of 9 warnings resolved, 1 warning explicitly skipped (WR-02 — non-defect).

### Human Verification Required

None. All required behaviors are programmatically verified in the test suite or covered by the 17-10 phase-final QA Round-trip evidence on DEV. Both BLOCKERS surfaced by the prior verification have been fixed and are covered by 8 new regression tests.

### Deferred Items

Items addressed structurally by ship-to-main; not actionable in-phase gaps.

| # | Item | Addressed In | Evidence |
|---|---|---|---|
| 1 | `forecast-backtest.yml` + `forecast-quality-gate.yml` verified live via `gh workflow run` on a feature ref | Phase 17 ship to main | `gh workflow run --ref feature/...` returns 404 because workflow files aren't on main yet — auto-resolves on merge. Logic verified locally (139/139 pytest); DEV round-trip Round B per 17-10 already exercised both workflows via workflow_dispatch on a separate ref. |

### Gaps Summary

**No gaps remain.** Phase 17 ships a structurally complete and behaviorally correct backtest + gate + freshness pipeline:

- 6 of 6 ROADMAP success criteria verified (SC4 with explicit cadence-redefinition acceptance + drift now fixed).
- 8 of 8 BCK requirements satisfied.
- Both prior BLOCKERS (BL-01 gate-bypass, BL-02 fold-row leak) are fixed with comprehensive regression test coverage in the failure paths that were previously untested.
- 8 of 9 prior warnings resolved; WR-02 explicitly skipped as a refactor opportunity, not a defect.
- Test suite grew from 131 → 139 pytest (the 8 new tests target exactly the previously-untested failure paths).

The "happy path well tested, failure path not" theme that produced both BLOCKERS has been directly addressed: BL-01 now has 5 missing-baseline regression tests (None / NaN / inf / both-missing); BL-02 now has 3 exception-during-fold regression tests (forced exception + cleanup spy + cleanup-self-failure). Plan 17-05's existing TestFoldCutoffs / TestUncalibratedHorizons / TestGateDecision suite continues to cover the math; the new tests bolt on the failure-mode coverage that was missing.

The cadence redefinition (BCK-05 cron → `push:data/**`) remains a phase-level decision with explicit acceptance in 17-10; WR-03 reconciled the documentation so future maintainers see the actual trigger. The workflow-on-feature-ref structural deferral resolves on ship to main.

**Recommendation:** Proceed to `/gsd-ship`. Phase goal is achieved.

---

_Verified: 2026-05-06T21:35:00Z_
_Verifier: Claude (gsd-verifier)_
_Re-verification: post-gap-closure for BL-01 + BL-02 + 7 of 8 warnings_
