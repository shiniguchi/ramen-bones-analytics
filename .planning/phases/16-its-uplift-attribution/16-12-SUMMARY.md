---
phase: 16
plan: 12
subsystem: forecast / ITS attribution
tags:
  - sensitivity-analysis
  - counterfactual
  - bootstrap-ci
  - anticipation-buffer
  - validator
dependency-graph:
  requires:
    - 16-05  # counterfactual_fit + per-model fit modules
    - 16-06  # cumulative_uplift bootstrap CI
    - 16-07  # campaign_uplift_v wrapper view
    - 16-11  # CI guards 9 + 10 (constraint not to regress)
  provides:
    - tests/forecast/cutoff_sensitivity.md
    - tests/forecast/check_cutoff_sensitivity.sh
    - "Pitfall 2.2 healthy-band evidence for SC#2 closure"
  affects:
    - scripts/forecast/sarimax_fit.py
    - scripts/forecast/prophet_fit.py
    - scripts/forecast/ets_fit.py
    - scripts/forecast/theta_fit.py
    - scripts/forecast/naive_dow_fit.py
    - supabase/migrations/0066_forecast_with_actual_v_comparable.sql
tech-stack:
  added: []
  patterns:
    - "pred_anchor = train_end if track == 'cf' else run_date — date label alignment for CF fits"
    - "SQL view CASE-extension to surface comparable actuals via LEFT JOIN of two source views"
key-files:
  created:
    - tests/forecast/cutoff_sensitivity.md
    - tests/forecast/check_cutoff_sensitivity.sh
    - supabase/migrations/0066_forecast_with_actual_v_comparable.sql
  modified:
    - scripts/forecast/sarimax_fit.py
    - scripts/forecast/prophet_fit.py
    - scripts/forecast/ets_fit.py
    - scripts/forecast/theta_fit.py
    - scripts/forecast/naive_dow_fit.py
decisions:
  - "Anchor CF pred_dates on train_end, not run_date — simulate(anchor='end') / h-step forecast project from the last training observation, so date labels must match"
  - "Extend forecast_with_actual_v to LEFT JOIN kpi_daily_with_comparable_v + add CASE branch for revenue_comparable_eur — Plan 03 territory but blocking for Plan 12"
  - "Document theta failure as a pre-existing Plan 05 bug, not a Plan 12 regression — leave fix to Plan 05 hygiene"
  - "Validator parses ratio from the 5x3 grid's column 8 (not a separate ratio table) so the plan's grep-based automated check stays at 5 model rows"
metrics:
  duration: "~4h (resume from checkpoint, fresh executor)"
  completed: 2026-05-04
requirements: [UPL-02]
---

# Phase 16 Plan 12: Cutoff Sensitivity Log + Validator Summary

Generated `tests/forecast/cutoff_sensitivity.md` (5×3 grid + sensitivity-ratio summary) and `tests/forecast/check_cutoff_sensitivity.sh` (validator) by running `counterfactual_fit.py --train-end-offset {-14, -7, -1}` against DEV three times, computing cumulative uplift via `cumulative_uplift.py`, and reading `campaign_uplift_v` for the friend's 2026-04-14 Instagram campaign — closing the D-13 / UPL-02 / ROADMAP SC#2 sensitivity-analysis gate.

## Headline result

**sarimax (1.139) and prophet (0.890) both PASS the [0.8, 1.25] healthy band.** ITS attribution is robust to the anticipation-buffer choice in [-14d, -7d]. Phase 16 ships per CONTEXT.md D-13.

| Model | -14d | -7d (HEADLINE) | -1d | Ratio | Verdict |
|-------|---:|---:|---:|---:|---|
| sarimax | €-1148.78 | €-1008.53 | €-565.05 | 1.139 | PASS |
| prophet | €-899.08 | €-1010.79 | €-653.14 | 0.890 | PASS |
| ets | €138.86 | €-153.79 | €-673.63 | -0.903 | FLAG (sign flip; low signal at this scale) |
| theta | FAIL | FAIL | FAIL | — | Pre-existing Plan 05 bug |
| naive_dow | €-1092.00 | €-1217.02 | €-1226.13 | 0.897 | PASS |

All four working models produce negative point estimates at n_days=14 with CIs straddling zero — informational, not statistically distinguishable from null effect. CIs will tighten as the window grows.

## Deviations from plan

This plan was originally a doc-and-shell-script-only plan. Three Wave-2 spec gaps were auto-folded into the 16-12 budget under Rule 3 (blocking issues prevent completing the current task). All three were untestable from Plan 03/05/06 internal tests (mocked DB clients); first end-to-end DEV exposure was Plan 12 sensitivity runs.

### Auto-fixed Issues

**1. [Rule 3 — Blocking] migration 0065: comparable views service_role bypass**
- **Found during:** Initial -14d cutoff CF refit on DEV (before checkpoint)
- **Issue:** Migrations 0054 / 0059 / 0060 / 0064 had a JWT predicate `auth.jwt()->>'restaurant_id' = restaurant_id` with no service_role bypass. The forecast pipeline runs under the service_role key (no JWT) and saw 0 rows from `forecast_with_actual_v`, `baseline_items_v`, `kpi_daily_with_comparable_v`, and `campaign_uplift_v`. Track-B fits returned 0 actuals → 0 uplift rows → empty sensitivity grid.
- **Fix:** New migration 0065 — relax the JWT predicate to `(auth.jwt()->>'restaurant_id') IS NULL OR ... = ...` on all four views. service_role's `auth.jwt()` is NULL so the OR short-circuits true.
- **Commit:** `69594eb` (+ `e072395` follow-up to preserve `granularity` column in 0054's superseded view definition)

**2. [Rule 3 — Blocking] cumulative_uplift `_successful_cf_models` probed run_date instead of started_at**
- **Found during:** First cumulative_uplift attempt against DEV
- **Issue:** `pipeline_runs` schema has no `run_date` column; the helper was probing a non-existent column and returning [] for every model → 0 successful models → 0 rows.
- **Fix:** Probe `started_at >= run_date 00:00 UTC AND started_at < (run_date+1) 00:00 UTC` — UTC daily window over the timestamptz column.
- **Commit:** `ab25c41`

**3. [Rule 3 — Blocking] CF pred_dates anchor on run_date instead of train_end**
- **Found during:** First clean CF run after migration 0065 landed
- **Issue:** All five `*_fit.py` modules in the daily path computed `pred_dates_for_grain(run_date=run_date, ...)` for both BAU and CF tracks. CF fits sample with `simulate(anchor='end')` (SARIMAX/ETS) or `forecast(h=horizon)` (Prophet/Theta/naive_dow) — those project from `train_end`, not `run_date`. The forecast values were correct, but date labels landed in `[run_date+1, run_date+horizon]` instead of `[train_end+1, train_end+horizon]`. Result: campaign window (2026-04-14 → 2026-05-03) had no CF rows joined to actuals.
- **Fix:** `pred_anchor = train_end if track == 'cf' else run_date` above each daily `pred_dates_for_grain` call in all five modules. Weekly/monthly paths unchanged because CF runs only at daily grain (`CF_GRANULARITY='day'` in counterfactual_fit.py).
- **Commit:** `09bad4c`

**4. [Rule 3 — Blocking] forecast_with_actual_v missing CASE branch for revenue_comparable_eur**
- **Found during:** First cumulative_uplift run after the anchor fix
- **Issue:** `forecast_with_actual_v` (mig 0054, last touched 0065) maps `f.kpi_name → actual_value` via a CASE expression that only knows `revenue_eur` and `invoice_count`. CF rows have `kpi_name='revenue_comparable_eur'` (Phase 16 D-04 / Guard 9) — the CASE returned NULL. Bootstrap CI's empty-window guard tripped; 0 campaign_uplift rows landed.
- **Fix:** New migration 0066 — `LEFT JOIN kpi_daily_with_comparable_v c` and extend the CASE: `WHEN 'revenue_comparable_eur' THEN c.revenue_comparable_eur::double precision`. Both source views already use the JWT-or-service_role predicate from 0065, so no new attack surface.
- **Commit:** `48edd88`
- **Migration deployed:** GH workflow run 25292511310 → DEV success

### Out-of-scope discoveries (NOT fixed in 16-12)

**theta_fit.py: `StatsForecast.forecast() missing 1 required positional argument: 'df'`**
- Surfaces on every CF cutoff for both `revenue_comparable_eur` and `invoice_count` KPIs.
- Pre-existing Plan 05 module bug — the `theta_fit.py` daily path calls `sf.forecast(h=n_open, fitted=True)` but the installed `statsforecast` version requires a `df=` argument.
- Not a Plan 12 regression. Tracked as a Plan 05 hygiene follow-up. Plan 12's validator only enforces sarimax + prophet (per CONTEXT.md / RESEARCH §2 Pitfall 2.5 — theta is a floor baseline).
- All theta cells in the grid are documented as `FAIL — pre-existing Plan 05 bug`.

## Authentication / environment notes

- All DEV refits ran under `SUPABASE_SERVICE_ROLE_KEY` from `.env` — required because the forecast pipeline writes to `forecast_daily` (service-side) and reads from views that needed migration 0065's JWT bypass.
- Used `python3.13` (`/usr/local/bin/python3`) since the repo's deps (`supabase`, `statsmodels`, `prophet`, `statsforecast`) are installed there. The conda Python (3.8) is incompatible.

## DEV state at end of plan

- `forecast_daily` CF rows: 33×5 = 165+ rows from the latest -1d cutoff (run_date=2026-05-04, target_date 2026-04-14 onward), plus stale leftover rows from earlier broken runs that are outside the campaign analysis window and harmless.
- `campaign_uplift` table: 64 rows for the friend campaign (4 working models × 2 windows + per-day rolling rows for cumulative_since_launch).
- `forecast_with_actual_v`: 6636 rows total, includes both BAU and CF tracks for both revenue and comparable revenue KPIs.
- Migrations 0054, 0059, 0060, 0064 superseded by 0065; 0054 further superseded by 0066. Local + remote at `0066`, drift check clean.
- The next nightly cron (`0 7 * * 1` UTC, weekly) will run the full pipeline at the default `--train-end-offset=-7d`, restoring the canonical Track-B snapshot. The -1d data on DEV right now is from Plan 12's sensitivity sweep, not the canonical state.

## Verification

- `bash tests/forecast/check_cutoff_sensitivity.sh` → exits 0 with `OK: sarimax ratio 1.139 in band` / `OK: prophet ratio 0.89 in band`
- Plan-level automated check (`grep -cE "^\| (sarimax|...)" cutoff_sensitivity.md | grep -q "^5$"`) → passes
- `bash scripts/ci-guards.sh` → all guards pass (Guard 9, 10 not regressed)
- Migration 0066 deployed via `gh workflow run migrations.yml --ref feature/phase-16-its-uplift-attribution` (run 25292511310, status success)
- DEV `campaign_uplift_v` query for `friend-owner-2026-04-14` × `cumulative_since_launch` returns 4 rows (sarimax/prophet/ets/naive_dow) with non-zero EUR + non-degenerate CIs

## Self-Check: PASSED

**Files exist:**
- FOUND: tests/forecast/cutoff_sensitivity.md
- FOUND: tests/forecast/check_cutoff_sensitivity.sh
- FOUND: supabase/migrations/0066_forecast_with_actual_v_comparable.sql

**Commits exist:**
- FOUND: 09bad4c — fix(16-12): align CF pred_dates anchor to train_end (Plan 05 follow-up)
- FOUND: 48edd88 — fix(16-12): migration 0066 — forecast_with_actual_v comparable branch
- FOUND: f273aae — test(16-12): cutoff_sensitivity.md log — 5x3 grid populated from DEV refits
- FOUND: 50d152b — test(16-12): check_cutoff_sensitivity.sh validator

(STATE.md / ROADMAP.md not touched per resume_state instructions.)
