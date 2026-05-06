"""Phase 17 BCK-01: integration test for argparse retrofit on all 5 fit scripts.

Spawns each *_fit.py via `python -m` subprocess and asserts:
  1. --help exits 0 without env vars set (argparse runs FIRST per RESEARCH §Subprocess Fold-Driver Design)
  2. --help output includes --train-end / --eval-start / --fold-index
  3. Passing flags without env vars fails at env-var validation, not argparse parsing
"""
from __future__ import annotations

import os
import subprocess
import sys

import pytest

FIT_SCRIPTS = ['sarimax_fit', 'prophet_fit', 'ets_fit', 'theta_fit', 'naive_dow_fit']
NEW_FLAGS = ['--train-end', '--eval-start', '--fold-index']


def _run(args: list[str], extra_env: dict | None = None) -> subprocess.CompletedProcess:
    """Run a python -m invocation with the project root on PYTHONPATH.

    Strips RESTAURANT_ID / KPI_NAME / RUN_DATE so we can test argparse-first behavior.
    Uses sys.executable to ensure the same Python binary runs the subprocess.
    """
    env = {k: v for k, v in os.environ.items()
           if k not in ('RESTAURANT_ID', 'KPI_NAME', 'RUN_DATE', 'GRANULARITY', 'FORECAST_TRACK')}
    if extra_env:
        env.update(extra_env)
    return subprocess.run(
        [sys.executable, '-m', f'scripts.forecast.{args[0]}', *args[1:]],
        capture_output=True, text=True, env=env, timeout=30,
    )


@pytest.mark.parametrize('script', FIT_SCRIPTS)
def test_help_exits_zero(script):
    """--help works without env vars (argparse runs FIRST — BCK-01 requirement)."""
    result = _run([script, '--help'])
    assert result.returncode == 0, (
        f'{script} --help exited {result.returncode}:\n'
        f'stdout={result.stdout!r}\nstderr={result.stderr!r}'
    )


@pytest.mark.parametrize('script', FIT_SCRIPTS)
def test_help_lists_all_three_flags(script):
    """--help output mentions all 3 new flags (BCK-01 retrofit)."""
    result = _run([script, '--help'])
    for flag in NEW_FLAGS:
        assert flag in result.stdout, (
            f'{script} --help missing {flag}:\n'
            f'stdout={result.stdout!r}'
        )


@pytest.mark.parametrize('script', FIT_SCRIPTS)
def test_argparse_runs_before_env_var_validation(script):
    """Passing --train-end without env vars: argparse parses cleanly, then env-var check fails.

    The error message should mention RESTAURANT_ID/KPI_NAME/RUN_DATE (env validation),
    NOT 'unrecognized argument' (argparse failure). This proves argparse runs BEFORE
    env-var validation — the critical ordering requirement from BCK-01.
    """
    result = _run([script, '--train-end', '2026-04-01'])
    assert result.returncode != 0, (
        f'{script}: expected exit 1 when env vars missing, got exit 0'
    )
    env_var_error = (
        'RESTAURANT_ID' in result.stderr
        or 'RUN_DATE' in result.stderr
        or 'KPI_NAME' in result.stderr
    )
    assert env_var_error, (
        f'{script}: expected env-var error after argparse parsed cleanly:\n'
        f'stderr={result.stderr!r}'
    )
    assert 'unrecognized arguments' not in result.stderr.lower(), (
        f'{script}: argparse rejected --train-end (regression — argparse not first!):\n'
        f'stderr={result.stderr!r}'
    )
