---
phase: 17-backtest-gate-quality-monitoring
reviewed: 2026-05-06T00:00:00Z
depth: standard
files_reviewed: 33
files_reviewed_list:
  - .github/workflows/forecast-backtest.yml
  - .github/workflows/forecast-quality-gate.yml
  - docs/forecast/ACCURACY-LOG.md
  - scripts/forecast/backtest.py
  - scripts/forecast/conformal.py
  - scripts/forecast/ets_fit.py
  - scripts/forecast/naive_dow_fit.py
  - scripts/forecast/naive_dow_with_holidays_fit.py
  - scripts/forecast/prophet_fit.py
  - scripts/forecast/quality_gate_check.py
  - scripts/forecast/run_all.py
  - scripts/forecast/sarimax_fit.py
  - scripts/forecast/tests/test_accuracy_log.py
  - scripts/forecast/tests/test_backtest.py
  - scripts/forecast/tests/test_conformal.py
  - scripts/forecast/tests/test_fit_scripts_argparse.py
  - scripts/forecast/tests/test_gate.py
  - scripts/forecast/tests/test_naive_dow_with_holidays.py
  - scripts/forecast/tests/test_quality_gate_check.py
  - scripts/forecast/tests/test_run_all_feature_flags.py
  - scripts/forecast/tests/test_workflow_yaml.py
  - scripts/forecast/theta_fit.py
  - scripts/forecast/write_accuracy_log.py
  - src/lib/components/CalendarCountsCard.svelte
  - src/lib/components/CalendarRevenueCard.svelte
  - src/lib/components/FreshnessLabel.svelte
  - src/lib/components/ModelAvailabilityDisclosure.svelte
  - src/lib/forecastOverlay.svelte.ts
  - src/lib/i18n/messages.ts
  - src/routes/api/forecast/+server.ts
  - supabase/migrations/0067_phase17_backtest_schema.sql
  - supabase/migrations/0068_phase17_backtest_schema_gap.sql
  - tests/unit/ModelAvailabilityDisclosure.test.ts
  - tests/unit/cards.test.ts
findings:
  blocker: 2
  warning: 9
  total: 11
status: issues_found
---

# Phase 17: Code Review Report

**Reviewed:** 2026-05-06
**Depth:** standard
**Files Reviewed:** 33
**Status:** issues_found

## Summary

Phase 17 implementation (backtest gate, conformal calibration, regressor-aware naive baseline, accuracy log, quality gate workflow, freshness cascade, UI verdict pills) is broadly well-structured with strong test coverage. Two BLOCKER defects affect gate correctness and data hygiene under failure modes:

- **BL-01:** `_gate_decision` in `backtest.py` defaults missing baselines to `float('inf')`, which makes the threshold also `inf`, silently passing every challenger when either baseline RMSE is absent — a security gate bypass.
- **BL-02:** Backtest sentinel row cleanup runs only on the happy path; an exception during phases 1–3 leaves `backtest_fold_*` rows in `forecast_daily`, polluting the BAU dashboard reads.

Nine WARNINGs cover silent-error swallowing, race conditions in scroll auto-positioning, doc/code drift on the cron schedule, NaN persistence, dead imports, hardcoded i18n strings, and timezone-format fragility in ACCURACY-LOG date filtering.

## Blocker Issues

### BL-01: `_gate_decision` silently passes all challengers when a baseline is missing

**File:** `scripts/forecast/backtest.py:344-347`
**Issue:** Both baseline RMSEs default to `float('inf')` when missing from `mean_rmse`. If either baseline failed all folds (subprocess crash, zero aligned rows, etc.), `baseline = max(inf, anything) = inf`, so `threshold = inf * 0.9 = inf`, and **every non-baseline model gets PASS** because `rmse <= inf` is always True. This defeats BCK-04's gate entirely — a buggy/missing baseline run becomes an authorization bypass that promotes failing challengers.

The risk is real: the cold-start guard at line 440 writes PENDING for ALL models when history is short, but if history is sufficient AND a baseline subprocess crashes mid-run, the gate silently returns PASS for every challenger.

```python
# Current — silent gate bypass when a baseline is missing:
baseline_dow = mean_rmse.get('naive_dow', float('inf'))
baseline_dow_h = mean_rmse.get('naive_dow_with_holidays', float('inf'))
baseline = max(baseline_dow, baseline_dow_h)
threshold = baseline * GATE_THRESHOLD
```

**Fix:** Treat missing baseline RMSE as PENDING for the slice — refuse to compute a gate verdict without both baselines. Baselines are R7 always-on; their absence is a data-quality signal, not a free pass.

```python
baseline_dow = mean_rmse.get('naive_dow')
baseline_dow_h = mean_rmse.get('naive_dow_with_holidays')
if baseline_dow is None or baseline_dow_h is None:
    # Missing baseline RMSE for this slice — gate is undecidable.
    # PENDING for all models; do NOT silently pass.
    return {m: 'PENDING' for m in mean_rmse}
baseline = max(baseline_dow, baseline_dow_h)
threshold = baseline * GATE_THRESHOLD
```

### BL-02: Backtest fold cleanup not executed on exception path — leaks `backtest_fold_*` rows into `forecast_daily`

**File:** `scripts/forecast/backtest.py:435-676`
**Issue:** `_cleanup_sentinel_rows()` is called at line 649 inside the `try` block, AFTER all phases (fold writes, conformal calibration, gate decision). If any earlier step raises (DB hiccup, NaN cascade, gate update failure), the `except` handler at line 664 logs and writes `pipeline_runs` failure but **never deletes the `backtest_fold_*` rows already written to `forecast_daily`**. Those rows then appear in BAU reads through `forecast_with_actual_v` and dashboard queries — directly contradicting the docstring claim "Cleans backtest_fold_* rows post-eval."

The MV `forecast_daily_mv` does `DISTINCT ON ... ORDER BY run_date DESC`, so a stale `forecast_track='backtest_fold_3'` row from a crashed run can survive indefinitely if the same (kpi, model, target_date, run_date) combination is never re-written by BAU (which uses `forecast_track='bau'` — different PK partition).

**Fix:** Move the cleanup into a `finally` block so it runs on both success and failure:

```python
try:
    # ... all 4 phases ...
    write_success(...)
    return 0 if total_succeeded > 0 else 1
except Exception as e:
    traceback.print_exc()
    try:
        write_failure(...)
    except Exception:
        pass
    return 1
finally:
    # ALWAYS clean up fold rows, even on exception, so partial writes
    # don't leak into forecast_daily / dashboard reads.
    try:
        _cleanup_sentinel_rows(client, restaurant_id=restaurant_id)
    except Exception as cleanup_err:
        print(f'[backtest] cleanup failed: {cleanup_err}', file=sys.stderr)
```

## Warnings

### WR-01: Silent error swallowing in `createForecastOverlay` re-introduces the dashboard-bug pattern

**File:** `src/lib/forecastOverlay.svelte.ts:135`
**Issue:** `clientFetch(...).catch(() => { forecastData = null; })` swallows any error (including the new Phase 17 `forecast_quality` query failures) and surfaces a silent "no data" state. This is the exact pattern flagged in the project memory `feedback_silent_error_isolation` (2026-04-17 incident), where `.catch(() => [])` masked a Postgres permission error for hours. A 401/403/500 from `/api/forecast` because of an RLS misconfig would manifest only as missing forecast lines, not a visible error — already burned us once.

**Fix:** Log the error before clearing state, so DEV-time / browser-console readers see the failure:

```typescript
.catch((err) => {
  console.error('[forecastOverlay] /api/forecast failed:', err);
  forecastData = null;
});
```

### WR-02: Auto-scroll RAF chain has no cancellation — race condition on rapid effect re-runs

**File:** `src/lib/components/CalendarRevenueCard.svelte:219-244`
**Issue:** The `$effect` schedules `requestAnimationFrame(tryPosition)` recursively up to 30 frames. There's no cleanup function returned from the effect, so when `chartW` / `forecastData` / `pastForecastBuckets` change rapidly (e.g., grain toggle + filter change in quick succession), multiple concurrent RAF chains run and race to mutate `el.scrollLeft`. The user sees scroll jitter; `lastSetScrollLeft` may end up out of sync with the actual scrollLeft if two chains both write.

**Fix:** Track the RAF id and cancel on effect re-run via the cleanup function:

```typescript
$effect(() => {
  // ... existing setup ...
  let rafId: number;
  const tryPosition = () => {
    if (el.scrollLeft !== lastSetScrollLeft) return;
    if (el.scrollWidth < w * 0.9 && attempts < 30) {
      attempts++;
      rafId = requestAnimationFrame(tryPosition);
      return;
    }
    // ... mutate scrollLeft ...
  };
  rafId = requestAnimationFrame(tryPosition);
  return () => cancelAnimationFrame(rafId);
});
```

### WR-03: ACCURACY-LOG header + `write_accuracy_log` docstring claim a weekly cron that doesn't exist

**File:** `docs/forecast/ACCURACY-LOG.md:3`, `scripts/forecast/write_accuracy_log.py:36`
**Issue:** Both files state "Auto-generated weekly by `.github/workflows/forecast-backtest.yml` (Tuesday 23:00 UTC)." But the workflow has NO `schedule:` block — only `push: paths: data/**` and `workflow_dispatch`. The companion test `test_workflow_yaml.py:33` even asserts `not on_block.get('schedule')` — meaning the absence is intentional (owner-driven via data uploads), but the documentation contradicts the code. A future maintainer reading either string will look for a cron job that isn't there and waste time debugging.

**Fix:** Replace with the actual trigger description in both places:

```markdown
Auto-generated by `.github/workflows/forecast-backtest.yml` on every `data/**` push (owner-driven cadence).
```

```python
"""Phase 17 BCK-07: regenerate docs/forecast/ACCURACY-LOG.md from forecast_quality.

Triggered by .github/workflows/forecast-backtest.yml on data/** pushes (owner-driven, not a cron).
...
"""
```

### WR-04: Conformal `qhat` of NaN written to `forecast_quality.qhat` on cold-start

**File:** `scripts/forecast/backtest.py:594` (call site), `scripts/forecast/conformal.py:34, 42`
**Issue:** `calibrate_conformal_h35` returns `{'qhat_h35': float('nan')}` on cold-start. Line 594 then upserts that NaN into the `forecast_quality.qhat` column (`double precision`). Postgres accepts NaN in `double precision`, but downstream consumers querying `WHERE qhat IS NOT NULL` will incorrectly include the NaN row, and `ORDER BY qhat` becomes implementation-defined. The `write_accuracy_log._render_latest_run` formats it via `f'{qhat:.0f} EUR'` — `int(nan)` is undefined, raising at format time if it ever surfaces.

**Fix:** Convert NaN to NULL at the write boundary:

```python
qhat_val_for_db = None if np.isnan(qhat_val) else qhat_val
_write_quality_row(
    client,
    ...
    qhat=qhat_val_for_db,
)
```

Also: `write_accuracy_log.py:224` hardcodes `qhat = 0.0` (it never reads the DB value), so the rendered `qhat_95 = 0 EUR` is a placeholder lie. Either query the latest qhat row or strip the line until BCK-02 wires it through.

### WR-05: `quality_gate_check.py` has 3 dead imports

**File:** `scripts/forecast/quality_gate_check.py:13-15`
**Issue:** Imports `defaultdict`, `datetime`, `Optional` — none are referenced in the module. Dead imports suggest scope creep was abandoned mid-implementation; they trip linters and increase cold-start time on the PR-time gate (which has a 5-minute hard cap).

**Fix:**

```python
import sys

from scripts.forecast.db import make_client
```

### WR-06: `_find_enabled_failures` defensive prefix-strip can leak unprefixed names

**File:** `scripts/forecast/quality_gate_check.py:30-33`
**Issue:**

```python
enabled_models = {
    row['flag_key'][len('model_'):] if row['flag_key'].startswith('model_') else row['flag_key']
    for row in (flags_resp.data or [])
    if row.get('enabled', True)  # defense-in-depth: re-check even if DB filter applied
}
```

The `else row['flag_key']` branch returns the raw `flag_key` string when it doesn't start with `'model_'`. The `.like('flag_key', 'model_%')` filter at line 25 should make this branch unreachable, BUT if the SQL filter ever loosens (or RLS shape changes), a non-model flag like `offweek_reminder` would land literally in `enabled_models` and could match a future `forecast_quality.model_name = 'offweek_reminder'` row — a strange-but-real cross-table contamination.

Also, the comment "defense-in-depth: re-check even if DB filter applied" applies to the `enabled` filter, but the `enabled=True` SQL filter on line 26 ALSO already filtered — making the comprehension's `if row.get('enabled', True)` truthy for any row with missing `enabled` (defaults to True), which is the OPPOSITE of defensive (it admits unknown rows).

**Fix:**

```python
enabled_models = {
    row['flag_key'][len('model_'):]
    for row in (flags_resp.data or [])
    if row['flag_key'].startswith('model_') and row.get('enabled') is True
}
```

### WR-07: Hardcoded English "Backtest" column header in i18n'd table

**File:** `src/lib/components/ModelAvailabilityDisclosure.svelte:143`
**Issue:** Every other `<th>` in this table uses `{t(page.data.locale, 'model_avail_col_*')}`, but the new BCK-01/BCK-02 column is hardcoded `Backtest`. Non-EN users (DE/JA/ES/FR — all 5 locales already have backtest pill keys) see English in the column header while pills below are localized. The i18n keyset already has `model_avail_backtest_*`; adding `model_avail_col_backtest` is a 5-key addition.

**Fix:** Add `model_avail_col_backtest: 'Backtest'` (and translations) to `messages.ts`, then:

```svelte
<th class="pb-1 pl-2 text-left font-medium">{t(page.data.locale, 'model_avail_col_backtest')}</th>
```

### WR-08: `write_accuracy_log` cutoff comparison is fragile across timezone-suffix formats

**File:** `scripts/forecast/write_accuracy_log.py:78-82`
**Issue:**

```python
latest = max(r['evaluated_at'] for r in rows)  # string max
latest_dt = datetime.fromisoformat(latest.replace('Z', '+00:00'))
cutoff = latest_dt.replace(hour=0, minute=0, second=0, microsecond=0)
week_rows = [r for r in rows if r['evaluated_at'] >= cutoff.isoformat()]
```

`cutoff.isoformat()` produces `2026-05-12T00:00:00+00:00`, but Supabase's PostgREST may serialize `evaluated_at` as `2026-05-12T23:00:00Z` (with `Z`) OR `+00:00`, depending on the PG/PostgREST version. String comparison `'...Z' >= '...+00:00'` is wrong because `Z` (0x5A) > `+` (0x2B) lexicographically — so a `Z`-suffixed timestamp at the cutoff time would pass the filter even if it's earlier than the cutoff in `+00:00` form. Mixed input formats produce a wrong-by-a-day filter.

**Fix:** Compare in datetime space, not string space:

```python
cutoff_iso_z = cutoff.isoformat().replace('+00:00', 'Z')
week_rows = [
    r for r in rows
    if datetime.fromisoformat(r['evaluated_at'].replace('Z', '+00:00')) >= cutoff
]
```

### WR-09: `production_model` in ACCURACY-LOG is non-deterministic on multi-PASS challengers

**File:** `scripts/forecast/write_accuracy_log.py:231-235`
**Issue:**

```python
challengers_pass = [
    m for m, info in rendered.items()
    if m not in ('naive_dow', 'naive_dow_with_holidays') and info['verdict'] == 'PASS'
]
production_model = challengers_pass[0] if challengers_pass else 'naive_dow_with_holidays'
```

`rendered` is built via dict iteration over `_group_for_render`'s output, whose `defaultdict` insertion order = order of rows in `week_rows`. If two challengers both PASS (e.g., sarimax and ets), the picked `production_model` depends on which row arrived first from Supabase — which is determined by `evaluated_at DESC` ordering, but with millisecond-resolution timestamps for parallel folds, the order is effectively random. The ACCURACY-LOG header line `**Production model:** sarimax` could become `ets` next week with no actual change in accuracy.

**Fix:** Deterministic tie-break by lowest mean RMSE at h=7 (or sorted alphabetically as a fallback):

```python
challengers_pass = sorted(
    (m for m, info in rendered.items()
     if m not in ('naive_dow', 'naive_dow_with_holidays')
     and info['verdict'] == 'PASS'),
    key=lambda m: rendered[m].get('h7_rmse', float('inf'))  # tie-break by best h=7 RMSE
)
production_model = challengers_pass[0] if challengers_pass else 'naive_dow_with_holidays'
```

(Requires keeping the raw mean RMSE in `rendered` alongside the formatted `h7` cell.)

---

_Reviewed: 2026-05-06_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
