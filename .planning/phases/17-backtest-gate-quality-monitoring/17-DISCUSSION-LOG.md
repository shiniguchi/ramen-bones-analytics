# Phase 17: Backtest Gate & Quality Monitoring — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-06
**Phase:** 17-Backtest Gate & Quality Monitoring
**Areas discussed:** CV implementation approach, Promotion gate mechanics, ACCURACY-LOG commit strategy, Quality badge surface

---

## CV Implementation Approach

### Q1: Rolling-origin CV loop design

| Option | Description | Selected |
|--------|-------------|----------|
| Manual rolling-origin loop (Recommended) | backtest.py calls existing *_fit.py subprocesses per fold, same as run_all.py pattern. No adapters needed. | ✓ |
| statsforecast.cross_validation for all | Write thin adapter classes wrapping SARIMAX and Prophet. More upfront work, cleaner long-term if more native models added. | |
| Hybrid | statsforecast.cross_validation for ETS+Theta (native); manual subprocess loop for SARIMAX+Prophet. Two code paths. | |

**User's choice:** Manual rolling-origin loop (Recommended)

---

### Q2: Number of folds per horizon

| Option | Description | Selected |
|--------|-------------|----------|
| 4 folds per horizon (Recommended) | Aligns with ConformalIntervals(n_windows=4). Short horizons feasible now. Long horizons PENDING. <5 min runtime. | ✓ |
| 8 folds per horizon | More robust estimates. Doubles runtime. Long horizons still PENDING. Worthwhile only after 2+ years of data. | |
| You decide | Leave fold count to planner based on data depth profiling. | |

**User's choice:** 4 folds (after plain-language clarification of "rolling-origin folds" and "horizons")
**Notes:** User initially asked for clarification on terms. Explained: horizon = how many days ahead we predict; fold = one test run with a cutoff date; 4 folds = 4 test runs per horizon. User confirmed understanding and selected 4 folds.

**Side issue raised:** User noted Sunday forecast values show as zero even though the shop now runs 7 days/week since Feb/March. Captured as deferred pipeline hotfix (closed_days.py Sunday mask). The relative RMSE comparison in the backtest remains valid — all models equally affected on Sundays.

---

### Q3: Subprocess pattern for fold execution

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse subprocess pattern (Recommended) | backtest.py calls *_fit.py with --train-end and --eval-start flags per fold. Zero code duplication. | ✓ |
| Import model functions directly | Refactor *_fit.py to expose trainable functions; backtest.py calls in-process. Faster but touches every *_fit.py. | |

**User's choice:** Reuse subprocess pattern (Recommended)

---

## Promotion Gate Mechanics

### Q4: Per-model feature_flags DB rows

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — seed + gate-controlled rows (Recommended) | Add 5 rows to feature_flags (one per model). backtest.py flips enabled. run_all.py reads flags. Matches BCK-04 spec. | ✓ |
| No — keep env-var only, pure CI gate | FORECAST_ENABLED_MODELS env var continues to control. No new DB rows. Simpler but diverges from BCK-04. | |

**User's choice:** Yes — seed + gate-controlled rows (Recommended)

---

### Q5: Regressor-aware naive baseline

| Option | Description | Selected |
|--------|-------------|----------|
| New naive_dow_with_holidays.py (Recommended) | New standalone script; naive_dow_fit.py unchanged. Holiday-adjusted multiplicative naive baseline. | ✓ |
| Extend naive_dow_fit.py with a flag | Add --with-holidays CLI flag to existing naive_dow_fit.py. Fewer files but risks changing existing model behavior. | |

**User's choice:** New naive_dow_with_holidays.py (Recommended)

---

### Q6: Initial feature_flags state on deploy

| Option | Description | Selected |
|--------|-------------|----------|
| Start all enabled=true (Recommended) | Existing models keep running immediately. Gate runs next Tuesday and flips only failing models. No forecast outage. | ✓ |
| Start all enabled=false | All models paused until first backtest completes (0-7 day gap). Ensures gate runs before "production" label. | |

**User's choice:** Start all enabled=true (Recommended)

---

## ACCURACY-LOG Commit Strategy

### Q7: Commit location and mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Commit to main directly (Recommended) | forecast-backtest.yml gets permissions: contents: write; uses GITHUB_TOKEN to push ACCURACY-LOG.md to main. | ✓ |
| Orphan accuracy-log branch | Separate git orphan branch holds only ACCURACY-LOG.md. Main history stays clean. Slightly more setup. | |
| GitHub Actions artifact only | Workflow generates artifact / job summary. No repo write needed. Viewable only via GHA UI. Diverges from BCK-07. | |

**User's choice:** Commit to main directly (Recommended)

---

### Q8: ACCURACY-LOG format

| Option | Description | Selected |
|--------|-------------|----------|
| Append-only table rows (Recommended) | Latest week summary at top + append-only history section below. Diffs always additive. Easy to scan on GitHub. | ✓ |
| Replace full table each week | Whole file regenerated each run. Compact. No history in file itself — git log is the history. | |

**User's choice:** Append-only table rows (Recommended)

---

## Quality Badge Surface

### Q9: Badge location

| Option | Description | Selected |
|--------|-------------|----------|
| Extend ModelAvailabilityDisclosure (Recommended) | Add backtest status row to existing component. Calendar* cards inherit automatically. No new component. | ✓ |
| New ForecastQualityBadge component | Standalone component slotted into Calendar* cards. More targeted but more files. | |
| Skip UI in Phase 17 | Write to DB only. Future phase surfaces quality info. Faster Phase 17 scope. | |

**User's choice:** Extend ModelAvailabilityDisclosure (Recommended)

---

### Q10: Freshness SLO extension (BCK-08)

| Option | Description | Selected |
|--------|-------------|----------|
| Extend data_freshness_v with forecast stages (Recommended) | Add forecast cascade rows to existing view. No new SSR subrequest. FreshnessLabel surfaces badge automatically. | ✓ |
| Separate forecast_freshness query in +page.server.ts | New DB view + new SSR query. Cleaner separation but adds subrequest (currently ~8/50 CF Pages budget). | |

**User's choice:** Extend data_freshness_v with forecast stages (Recommended)

---

## Claude's Discretion

- Exact CLI flag names (`--train-end` / `--eval-start`) — planner checks existing CLI signatures first, adds flags only where missing
- DB column additions to `forecast_quality` for `rolling_origin_cv` rows (fold_index, train_end_date, eval_start_date) — planner assesses if current schema covers it or if migration needed
- Whether `run_all.py` reads `feature_flags` via bulk query or lazy per-model check
- Exact `data_freshness_v` extension approach (UNION branch vs. joined view)
- Data path for ModelAvailabilityDisclosure backtest status (new `forecast_quality_summary_v` view vs. API payload expansion)

## Deferred Ideas

- **Sunday zeros hotfix** — `closed_days.py` Sunday mask needs updating for shops now open 7 days/week. Raised by user during fold-count discussion. Separate pipeline patch, not Phase 17 scope.
- **Conformal CI rendering in Calendar* charts** — Phase 17 writes calibrated CI to DB; chart rendering is Phase 18+.
- **Phase 18+ quality dashboard** — Dedicated model quality view beyond ModelAvailabilityDisclosure rows.
