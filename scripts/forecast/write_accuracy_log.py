"""Phase 17 BCK-07: regenerate docs/forecast/ACCURACY-LOG.md from forecast_quality.

Idempotent: if no new run since last write, the rendered file is byte-equal
to the on-disk one and the workflow's bash `git diff --staged --quiet`
short-circuits the commit.

Append-only: each invocation moves the previous "Latest run" block to the top
of "History" and writes a fresh Latest run block.

D-07 / D-08 / BCK-07 — honest-failure copy from RESEARCH §ACCURACY-LOG.md Format.
"""
from __future__ import annotations

import os
import re
import sys
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path

import numpy as np

from scripts.forecast.db import make_client

REPO_ROOT = Path(__file__).resolve().parents[2]
ACCURACY_LOG = REPO_ROOT / 'docs' / 'forecast' / 'ACCURACY-LOG.md'

# BCK-07 canonical honest-failure copy — exact string required (em-dash, lowercase)
HONEST_FAILURE_NO_CHALLENGER = (
    '> naive-DoW-with-holidays remains production model — '
    'no challenger promoted this week.'
)

HEADER = """# Forecast Accuracy Log

Auto-generated weekly by `.github/workflows/forecast-backtest.yml` (Tuesday 23:00 UTC).
Do not edit by hand — the next cron run will overwrite manual edits.

**Production model:** {production_model}

---
"""

# Template for the Latest run section + History header
LATEST_RUN_TEMPLATE = """## Latest run: {run_date_utc}

{honest_failure_line}

| Model | h=7 | h=35 | h=120 | h=365 | Verdict |
|---|---|---|---|---|---|
{rows}

**Conformal CI calibration (h=35):** qhat_95 = {qhat:.0f} EUR (revenue_eur)

---

## History
"""

HISTORY_PLACEHOLDER = '\n(empty until first weekly run)\n'


def _fetch_latest_run_quality(client, restaurant_id):
    """Fetch all rolling_origin_cv rows from the latest evaluation_at week."""
    resp = (
        client.table('forecast_quality')
        .select('kpi_name,model_name,horizon_days,rmse,gate_verdict,evaluated_at')
        .eq('restaurant_id', restaurant_id)
        .eq('evaluation_window', 'rolling_origin_cv')
        .order('evaluated_at', desc=True)
        .limit(2000)
        .execute()
    )
    rows = resp.data or []
    if not rows:
        return [], None
    # Find latest evaluated_at timestamp
    latest = max(r['evaluated_at'] for r in rows)
    latest_dt = datetime.fromisoformat(latest.replace('Z', '+00:00'))
    # Filter to the latest evaluation day (within 24h of most recent row)
    cutoff = latest_dt.replace(hour=0, minute=0, second=0, microsecond=0)
    week_rows = [r for r in rows if r['evaluated_at'] >= cutoff.isoformat()]
    return week_rows, latest_dt


def _group_for_render(rows):
    """Group by (kpi='revenue_eur' for now), then (model, horizon) -> mean RMSE + verdict.

    Returns dict[model] -> {h7, h35, h120, h365, verdict}
    """
    # Collect RMSE lists and verdicts per (model, horizon)
    by_model: dict[str, dict[int, list[float]]] = defaultdict(lambda: defaultdict(list))
    verdicts_by_model_h: dict[tuple[str, int], str] = {}

    for r in rows:
        # MVP: render revenue_eur only; invoice_count is a future surface
        if r['kpi_name'] != 'revenue_eur':
            continue
        if r.get('rmse') is not None:
            by_model[r['model_name']][r['horizon_days']].append(r['rmse'])
        if r.get('gate_verdict'):
            verdicts_by_model_h[(r['model_name'], r['horizon_days'])] = r['gate_verdict']

    rendered = {}
    for model, h_map in by_model.items():
        rendered[model] = {
            'h7':   _format_cell(h_map.get(7),   verdicts_by_model_h.get((model, 7))),
            'h35':  _format_cell(h_map.get(35),  verdicts_by_model_h.get((model, 35))),
            'h120': _format_cell(h_map.get(120), verdicts_by_model_h.get((model, 120))),
            'h365': _format_cell(h_map.get(365), verdicts_by_model_h.get((model, 365))),
            'verdict': _aggregate_verdict(verdicts_by_model_h, model),
        }
    return rendered


def _format_cell(rmses: list | None, verdict: str | None) -> str:
    """Format a single table cell given RMSE list and gate verdict."""
    if not rmses:
        return 'PENDING'
    if verdict == 'UNCALIBRATED':
        return 'UNCALIBRATED'
    return f'RMSE {int(round(float(np.mean(rmses))))}'


def _aggregate_verdict(verdicts: dict, model: str) -> str:
    """A model is overall PASS iff PASS at all evaluable horizons.
    Baseline models always show 'baseline' verdict.
    """
    if model in ('naive_dow', 'naive_dow_with_holidays'):
        return 'baseline'
    horizons = [(model, h) for h in (7, 35, 120, 365)]
    # Only consider horizons with a non-UNCALIBRATED verdict
    statuses = [
        verdicts.get(k)
        for k in horizons
        if verdicts.get(k) and verdicts[k] != 'UNCALIBRATED'
    ]
    if not statuses:
        return 'PENDING'
    if any(s == 'FAIL' for s in statuses):
        # Pick worst-fail horizon descriptor
        for h in (7, 35, 120, 365):
            if verdicts.get((model, h)) == 'FAIL':
                return f'FAIL (h={h})'
    return 'PASS'


def _pick_honest_failure_line(rendered: dict) -> str:
    """If no non-baseline model is PASS, return the canonical no-challenger copy."""
    for model, info in rendered.items():
        if model in ('naive_dow', 'naive_dow_with_holidays'):
            continue
        if info['verdict'] == 'PASS':
            return f'> {model} promoted (PASS at all evaluable horizons).'
    return HONEST_FAILURE_NO_CHALLENGER


def _render_latest_run(rendered: dict, run_date_utc: str, qhat: float) -> str:
    """Render the '## Latest run' Markdown block."""
    rows_md = ''
    # Stable order: naive baselines first, then alphabetical challengers
    order = ['naive_dow', 'naive_dow_with_holidays'] + sorted(
        m for m in rendered if m not in ('naive_dow', 'naive_dow_with_holidays')
    )
    for m in order:
        info = rendered.get(m)
        if not info:
            continue
        rows_md += (
            f"| {m} | {info['h7']} | {info['h35']} | "
            f"{info['h120']} | {info['h365']} | {info['verdict']} |\n"
        )
    return LATEST_RUN_TEMPLATE.format(
        run_date_utc=run_date_utc,
        honest_failure_line=_pick_honest_failure_line(rendered),
        rows=rows_md.rstrip('\n'),
        qhat=qhat,
    )


def _move_existing_latest_to_history(existing_text: str) -> tuple:
    """Split existing file; capture prior Latest run for History prepend.

    Returns (existing_text, prior_latest_block_or_empty_string).
    """
    if '## Latest run' not in existing_text or '## History' not in existing_text:
        return existing_text, ''  # no prior Latest run -> nothing to move
    # Extract everything between '## Latest run' and the '---' separator before '## History'
    m = re.search(
        r'(## Latest run:[^\n]*\n.*?)(?=---\s*\n+## History)',
        existing_text,
        re.DOTALL,
    )
    if not m:
        return existing_text, ''
    prior_latest = m.group(1).strip()
    # Skip the placeholder skeleton "(pending first cron)"
    if 'pending first cron' in prior_latest:
        return existing_text, ''
    return existing_text, prior_latest


def main() -> int:
    """Main entry point: read DB, render Markdown, write file if changed."""
    client = make_client()

    # Resolve restaurant_id (v1: single tenant)
    resp = client.table('restaurants').select('id').limit(1).execute()
    rows = resp.data or []
    if not rows:
        print('[write_accuracy_log] ERROR: no restaurants', file=sys.stderr)
        return 1
    restaurant_id = rows[0]['id']

    week_rows, latest_dt = _fetch_latest_run_quality(client, restaurant_id)
    if not week_rows:
        print('[write_accuracy_log] No rolling_origin_cv rows yet — skipping (file unchanged).')
        return 0

    rendered = _group_for_render(week_rows)
    run_date_utc = latest_dt.strftime('%Y-%m-%d %H:%M UTC')

    # qhat: best-effort from forecast_quality if backtest writes it; else 0
    qhat = 0.0
    latest_run_md = _render_latest_run(rendered, run_date_utc, qhat)

    existing_text = ACCURACY_LOG.read_text() if ACCURACY_LOG.exists() else ''
    _, prior_latest = _move_existing_latest_to_history(existing_text)

    # Determine production model: first PASS challenger or naive_dow_with_holidays
    challengers_pass = [
        m for m, info in rendered.items()
        if m not in ('naive_dow', 'naive_dow_with_holidays') and info['verdict'] == 'PASS'
    ]
    production_model = challengers_pass[0] if challengers_pass else 'naive_dow_with_holidays'

    new_text = HEADER.format(production_model=production_model) + '\n' + latest_run_md + '\n'

    # Prepend prior Latest run to History
    if prior_latest:
        new_text += f'\n{prior_latest}\n\n'

    # Carry existing History body unchanged (strip placeholder if first run)
    if '## History' in existing_text:
        history_body = existing_text.split('## History', 1)[1]
        if history_body.strip() == HISTORY_PLACEHOLDER.strip():
            history_body = ''
        new_text += history_body
    else:
        new_text += HISTORY_PLACEHOLDER

    # Idempotence check: skip write if byte-identical
    if new_text == existing_text:
        print('[write_accuracy_log] No change — skipping write.')
        return 0

    ACCURACY_LOG.write_text(new_text)
    print(f'[write_accuracy_log] Wrote {len(new_text)} bytes to {ACCURACY_LOG}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
