---
phase: 17
slug: backtest-gate-quality-monitoring
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-06
last_updated: 2026-05-06
---

# Phase 17 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Populated post-planning by /gsd-plan-phase per the Nyquist Dimension 8 contract.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Python framework** | pytest 7.x (existing — `scripts/forecast/tests/`) |
| **Frontend framework** | vitest (existing — `src/lib/components/*.test.ts`) |
| **Quick run command (Python)** | `cd scripts/forecast && python -m pytest tests/ -x --tb=short` |
| **Quick run command (Frontend)** | `npm run test -- --run` |
| **Full suite command** | `npm run check && npm run test -- --run && cd scripts/forecast && python -m pytest tests/` |
| **Estimated runtime** | ~60s Python + ~30s Frontend |

---

## Sampling Rate

- **After every task commit:** Run quick command for the affected layer (Python OR Frontend)
- **After every plan wave:** Run full suite
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 17-01-T1 | 17-01 | 1 | BCK-04, BCK-08 | T-17-04, T-17-03 | Migration body uses static SQL literals; security_invoker=true preserved | inline grep | `grep -c "ALTER TABLE public.forecast_quality" supabase/migrations/0067_phase17_backtest_schema.sql` | ⬜ pending | ⬜ pending |
| 17-01-T2 | 17-01 | 1 | BCK-08 | — | FreshnessLabel threshold tightened | vitest | `npm run test -- --run FreshnessLabel.test` | ⬜ pending | ⬜ pending |
| 17-01-T3 | 17-01 | 1 | BCK-04, BCK-08 | T-17-03 | Migration applied to local + DEV | manual checkpoint | `gh run list --workflow=migrations.yml --limit 1` | ⬜ pending | ⬜ pending |
| 17-02-T1 | 17-02 | 1 | BCK-02 | — | RED test fails before impl exists | pytest (RED) | `pytest scripts/forecast/tests/test_conformal.py -x` (expect ImportError) | ⬜ pending | ⬜ pending |
| 17-02-T2 | 17-02 | 1 | BCK-02 | T-17-02b | Quantile math correct, no DB access | pytest (GREEN) | `pytest scripts/forecast/tests/test_conformal.py -v` | ⬜ pending | ⬜ pending |
| 17-03-T1 | 17-03 | 1 | BCK-03 | T-17-02, T-17-03, T-17-04c | naive_dow_with_holidays.py imports + MODEL_NAME literal | smoke import | `python -c "from scripts.forecast.naive_dow_with_holidays import fit_and_write, MODEL_NAME"` | ⬜ pending | ⬜ pending |
| 17-03-T2 | 17-03 | 1 | BCK-03 | — | Holiday multiplier helper math | pytest | `pytest scripts/forecast/tests/test_naive_dow_with_holidays.py -v` | ⬜ pending | ⬜ pending |
| 17-04-T1 | 17-04 | 1 | BCK-01 | T-17-02, T-17-15 | argparse retrofit on 5 scripts; --help works without env vars | shell loop | `for s in sarimax prophet ets theta naive_dow; do python -m scripts.forecast.${s}_fit --help \| grep -q -- "--train-end"; done` | ⬜ pending | ⬜ pending |
| 17-04-T2 | 17-04 | 1 | BCK-01 | — | argparse runs before env-var validation | pytest | `pytest scripts/forecast/tests/test_fit_scripts_argparse.py -v` (15 tests) | ⬜ pending | ⬜ pending |
| 17-05-T1 | 17-05 | 2 | BCK-01..04 | T-17-02, T-17-03, T-17-12, T-17-14 | backtest.py imports conformal + compute_metrics; sentinel run_dates; R7 baseline guard | smoke + grep | `python -m scripts.forecast.backtest --help && grep -c "BASELINE_MODELS" scripts/forecast/backtest.py` | ⬜ pending | ⬜ pending |
| 17-05-T2 | 17-05 | 2 | BCK-01, BCK-04 | T-17-14 | Fold cutoffs + gate decision + R7 hardcoded skip | pytest | `pytest scripts/forecast/tests/test_backtest.py scripts/forecast/tests/test_gate.py -v` | ⬜ pending | ⬜ pending |
| 17-06-T1 | 17-06 | 2 | BCK-04 | T-17-04d, T-17-04e, T-17-15 | _get_enabled_models bulk read + AND-intersect + graceful fallback | grep + smoke | `grep -c "_get_enabled_models" scripts/forecast/run_all.py && python -m scripts.forecast.run_all --help` | ⬜ pending | ⬜ pending |
| 17-06-T2 | 17-06 | 2 | BCK-04 | T-17-04d, T-17-04e | Mocked-DB tests for query shape + filtering | pytest | `pytest scripts/forecast/tests/test_run_all_feature_flags.py -v` (6 tests) | ⬜ pending | ⬜ pending |
| 17-07-T1 | 17-07 | 3 | BCK-07 | T-17-05 | ACCURACY-LOG.md skeleton + write_accuracy_log.py + canonical honest-failure copy | pytest | `pytest scripts/forecast/tests/test_accuracy_log.py -v` (6 tests) | ⬜ pending | ⬜ pending |
| 17-07-T2 | 17-07 | 3 | BCK-05 | T-17-01, T-17-02, T-17-09 | forecast-backtest.yml YAML parses; cron, perms, concurrency match spec | pytest (yaml) | `pytest scripts/forecast/tests/test_workflow_yaml.py -v` (10 tests) | ⬜ pending | ⬜ pending |
| 17-08-T1 | 17-08 | 3 | BCK-06 | T-17-03b | quality_gate_check.py exit-code logic | pytest | `pytest scripts/forecast/tests/test_quality_gate_check.py -v` (9 tests) | ⬜ pending | ⬜ pending |
| 17-08-T2 | 17-08 | 3 | BCK-06 | T-17-01b | forecast-quality-gate.yml YAML parses; permissions:read; timeout:5 | pytest (yaml) | `pytest scripts/forecast/tests/test_workflow_yaml.py -v` (gate tests activate) | ⬜ pending | ⬜ pending |
| 17-09-T1 | 17-09 | 3 | BCK-01, BCK-02 | T-17-05b | /api/forecast modelBacktestStatus payload | grep + svelte-check | `grep -c "modelBacktestStatus" src/routes/api/forecast/+server.ts && npm run check` | ⬜ pending | ⬜ pending |
| 17-09-T2 | 17-09 | 3 | BCK-01, BCK-02 | T-17-16 | 8 i18n keys × 5 locales + backlog stub | grep | `grep -cE "model_avail_backtest_(pass\|fail\|pending\|uncalibrated\|short_(pass\|fail\|pending\|uncalibrated)):" src/lib/i18n/messages.ts` (== 40) | ⬜ pending | ⬜ pending |
| 17-09-T3 | 17-09 | 3 | BCK-01, BCK-02 | — | Pills render at 4 horizons; cold-start gray fallback | vitest | `npm run test -- --run ModelAvailabilityDisclosure.test` | ⬜ pending | ⬜ pending |
| 17-09-T4 | 17-09 | 3 | BCK-01, BCK-02 | — | Localhost QA at 375×667 in ja + en | manual checkpoint | Playwright MCP screenshot evidence | ⬜ pending | ⬜ pending |
| 17-10-T1 | 17-10 | 4 | BCK-01..08 | T-17-17 | DEV round-trip — 6 rounds (schema/manual run/log/PR gate/UI/freshness) | manual checkpoint | 8-row BCK evidence table | ⬜ pending | ⬜ pending |
| 17-10-T2 | 17-10 | 4 | BCK-01..08 | T-17-17 | STATE/ROADMAP/REQUIREMENTS sync | shell | `bash .claude/scripts/validate-planning-docs.sh; echo $?` (== 0) | ⬜ pending | ⬜ pending |
| 17-10-T3 | 17-10 | 4 | — | — | Final commit + clean tree | shell | `git status --short \| wc -l` (≤1) | ⬜ pending | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## State Transitions Coverage

| Behavior | Minimum sample | Owner plan |
|---|---|---|
| `backtest.py` cold-start vs hot | 1 fixture <8d history → PENDING; 1 ≥8d → PASS/FAIL | 17-05 (test_backtest.py) |
| Gate FAIL flip | 1 model RMSE=baseline×1.0 (FAIL) + 1 RMSE=baseline×0.85 (PASS) | 17-05 (test_gate.py) |
| Gate PENDING no-flip | 1 model with empty quality_rows → no UPDATE | 17-05 (test_gate.py) |
| ConformalIntervals h=35 calibration | 4 fold residuals; assert qhat = quantile(\|residuals\|, 0.95) | 17-02 (test_conformal.py) |
| ACCURACY-LOG honest-failure copy | 1 fixture all-FAIL → assert canonical em-dash string | 17-07 (test_accuracy_log.py) |
| feature_flags read at run_all.py startup | 1 enabled=true + 1 enabled=false → only enabled spawned | 17-06 (test_run_all_feature_flags.py) |
| `data_freshness_v` staleness propagation | 1 tx row at now-1h + 1 forecast pipeline_runs at now-30h → view returns now-30h | 17-10 Round F (manual SQL) |
| `forecast-quality-gate.yml` exit 1 on FAIL | DB fixture: enabled model + FAIL verdict at h=7 → script exits 1 | 17-08 (test_quality_gate_check.py) |
| `ModelAvailabilityDisclosure` backtest column | 1 model `{h7:'PASS', h35:'FAIL'}` → 4 verdict pills, h35 red | 17-09 (ModelAvailabilityDisclosure.test.ts) |
| `naive_dow_with_holidays.py` regressor application | Date with `is_holiday=1` → yhat = dow_mean × holiday_ratio | 17-03 (test_naive_dow_with_holidays.py) |
| argparse runs before env-var validation | Pass --train-end without env vars → argparse parses, env-var check fails | 17-04 (test_fit_scripts_argparse.py) |

---

## Wave 0 Requirements (created during execution by RED tasks)

- [ ] `scripts/forecast/tests/test_backtest.py` — fold cutoffs + cold-start (BCK-01) — owner plan 17-05
- [ ] `scripts/forecast/tests/test_naive_dow_with_holidays.py` — regressor application (BCK-03) — owner plan 17-03
- [ ] `scripts/forecast/tests/test_conformal.py` — quantile math (BCK-02) — owner plan 17-02 (TDD: RED first)
- [ ] `scripts/forecast/tests/test_gate.py` — feature_flags flip + R7 guard (BCK-04) — owner plan 17-05
- [ ] `scripts/forecast/tests/test_run_all_feature_flags.py` — AND-intersect (BCK-04) — owner plan 17-06
- [ ] `scripts/forecast/tests/test_accuracy_log.py` — Markdown rendering + honest-failure copy (BCK-07) — owner plan 17-07
- [ ] `scripts/forecast/tests/test_workflow_yaml.py` — YAML parse assertions (BCK-05, BCK-06) — owner plans 17-07 + 17-08
- [ ] `scripts/forecast/tests/test_quality_gate_check.py` — exit-code logic (BCK-06) — owner plan 17-08
- [ ] `scripts/forecast/tests/test_fit_scripts_argparse.py` — 15 parametrized tests (BCK-01) — owner plan 17-04
- [ ] `src/lib/components/ModelAvailabilityDisclosure.test.ts` extension — backtest pills (BCK-01/02) — owner plan 17-09

*Existing pytest + vitest infra covers all needs; no Wave 0 scaffolding plan required because each implementation plan creates its own test file in the same task pair.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|---|---|---|---|
| Weekly cron actually fires Tuesday 23:00 UTC | BCK-05 | GHA cron drift only observable in production | After Phase 17 ships, monitor first 2 Tuesday cron runs; confirm forecast_quality rows written within 5min |
| GITHUB_TOKEN can push to main | BCK-07 | Branch protection rules can only be tested live | First weekly cron run must produce ACCURACY-LOG.md commit on main visible in `git log` |
| <5min CI completion budget | BCK-06 | Real GHA runner timing | Observe forecast-quality-gate.yml runs on 3 PRs; assert duration_ms < 300_000 |
| Friend-persona acceptance of UNCALIBRATED badge copy | BCK-01/02 | Subjective UX | Owner reads ModelAvailabilityDisclosure on her phone after ≥35d of data; states what each verdict means |
| Migration 0067 applied to DEV | BCK-04, BCK-08 | DB state can only be confirmed live | Plan 17-01 Task 3 BLOCKING checkpoint |
| Backtest pills render correctly at 375×667 in ja + en | BCK-01, BCK-02 | Mobile UX subjective + locale | Plan 17-09 Task 4 LOCALHOST QA + Plan 17-10 Round E DEV QA |
| End-to-end DEV round-trip 8-BCK evidence table | BCK-01..08 | Adversarial QA before /gsd-ship | Plan 17-10 Task 1 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or named manual checkpoint — DONE (per-task map above)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify — DONE (TDD pairs ensure each task gets immediate test feedback)
- [ ] Wave 0 covers all MISSING references — DONE (each plan creates its own test file)
- [ ] No watch-mode flags — DONE (--run/--tb=short used everywhere)
- [ ] Feedback latency <90s — DONE (pytest individual files <30s, vitest <30s)
- [ ] `nyquist_compliant: true` set in frontmatter — DONE (this commit)

**Approval:** ready for execution
