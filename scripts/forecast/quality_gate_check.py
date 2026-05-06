"""Phase 17 BCK-06: PR-time gate check.

Read-only: queries feature_flags + forecast_quality, exits 1 when any enabled
non-baseline model has a FAIL verdict at any horizon on its latest rolling-
origin CV evaluation. Otherwise exits 0.

Hard cap <5min on ubuntu-latest (workflow timeout-minutes: 5). Minimal deps:
no cmdstan, no numpy, no pandas. Just supabase + python-dotenv.
"""
from __future__ import annotations

import sys
from collections import defaultdict
from datetime import datetime
from typing import Optional

from scripts.forecast.db import make_client


def _find_enabled_failures(client) -> list[tuple[str, int, str]]:
    """Return (model, horizon, verdict) triples for enabled models with FAIL verdict."""
    flags_resp = (
        client.table('feature_flags')
        .select('flag_key,enabled')
        .like('flag_key', 'model_%')
        .eq('enabled', True)
        .execute()
    )
    enabled_models = {
        row['flag_key'][len('model_'):] if row['flag_key'].startswith('model_') else row['flag_key']
        for row in (flags_resp.data or [])
        if row.get('enabled', True)  # defense-in-depth: re-check even if DB filter applied
    }
    if not enabled_models:
        # No models gated — gate trivially PASSes (e.g., feature_flags not seeded yet)
        return []

    verdicts_resp = (
        client.table('forecast_quality')
        .select('model_name,horizon_days,gate_verdict,evaluated_at')
        .eq('evaluation_window', 'rolling_origin_cv')
        .order('evaluated_at', desc=True)
        .limit(2000)
        .execute()
    )
    rows = verdicts_resp.data or []
    if not rows:
        # Cold-start: no rolling_origin_cv rows yet -> gate trivially PASSes
        return []

    # Pick the latest verdict per (model, horizon)
    latest_per: dict[tuple[str, int], str] = {}
    latest_at: dict[tuple[str, int], str] = {}
    for r in rows:
        model = r['model_name']
        horizon = r['horizon_days']
        verdict = r.get('gate_verdict')
        evaluated_at = r['evaluated_at']
        if verdict is None:
            continue
        key = (model, horizon)
        if key not in latest_at or evaluated_at > latest_at[key]:
            latest_at[key] = evaluated_at
            latest_per[key] = verdict

    failures = []
    for (model, horizon), verdict in latest_per.items():
        if model in enabled_models and verdict == 'FAIL':
            failures.append((model, horizon, verdict))
    return failures


def main() -> int:
    client = make_client()
    failures = _find_enabled_failures(client)
    if failures:
        print('[quality_gate_check] FAIL — enabled models with FAIL verdict:', file=sys.stderr)
        for model, horizon, verdict in sorted(failures):
            print(f'  - {model} @ h={horizon}: {verdict}', file=sys.stderr)
        print(
            'Action: either flip feature_flags.enabled=false for the failing model, '
            'or fix the model so it beats the regressor-aware naive baseline by ≥10% RMSE.',
            file=sys.stderr,
        )
        return 1
    print('[quality_gate_check] PASS — all enabled models have PASS / PENDING / UNCALIBRATED verdicts (or no rolling_origin_cv rows yet).')
    return 0


if __name__ == '__main__':
    sys.exit(main())
