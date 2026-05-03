# tests/ci-guards/red-team-cf-revenue-eur.py
# RED-TEAM FIXTURE for Guard 9 (Phase 16 D-04).
#
# This file deliberately contains the regression Guard 9 is meant to catch:
# a write that pairs forecast_track='cf' with kpi_name='revenue_eur'. The
# combination is forbidden — Track-B fits must always source from
# kpi_daily_with_comparable_v.revenue_comparable_eur (UPL-03 / SC#3).
#
# Guard 9 must FAIL the build when this file is included in the scan path
# (i.e., copied into scripts/forecast/). The fixture filename ends in '.py'
# but lives outside scripts/forecast/, so production CI does NOT scan it.
# The harness `test_guard_9.sh` copies it INTO scripts/forecast/ temporarily,
# runs the guard, asserts non-zero exit + 'Guard 9 FAILED' in the output,
# and removes the copy.

# Intentional regression — Guard 9 must catch this:
def fit_track_b_revenue():
    rows = []
    rows.append({
        'forecast_track': 'cf',
        'kpi_name': 'revenue_eur',  # FORBIDDEN with track='cf'
        'yhat': 1234.0,
    })
    return rows
