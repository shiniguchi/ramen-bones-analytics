"""Phase 17 BCK-05/BCK-06: parse the new GHA workflows and assert critical settings.

Catches regressions where a future refactor accidentally removes:
  - push: paths: ['data/**'] trigger on forecast-backtest.yml
  - permissions: contents: write on forecast-backtest.yml
  - permissions: contents: read on forecast-quality-gate.yml (read-only PR check)
  - concurrency.cancel-in-progress=false on backtest, =true on gate
"""
from __future__ import annotations

from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
BACKTEST_YML = REPO_ROOT / '.github' / 'workflows' / 'forecast-backtest.yml'
GATE_YML = REPO_ROOT / '.github' / 'workflows' / 'forecast-quality-gate.yml'


def _load(p: Path) -> dict:
    return yaml.safe_load(p.read_text())


def test_backtest_data_push_trigger():
    """BCK-05: workflow fires on push to data/** (owner drops a new data file)."""
    cfg = _load(BACKTEST_YML)
    on_block = cfg.get('on') or cfg.get(True) or {}
    push = on_block.get('push') or {}
    paths = push.get('paths') or []
    assert any('data/' in p for p in paths), f'data/** push trigger missing; found {paths}'
    # Must NOT have a cron schedule (user controls upload cadence)
    assert not on_block.get('schedule'), 'forecast-backtest.yml must not use a cron schedule'


def test_backtest_permissions_write():
    """D-07: forecast-backtest.yml is the SOLE write-permitted forecast workflow."""
    cfg = _load(BACKTEST_YML)
    perms = cfg.get('permissions') or {}
    assert perms.get('contents') == 'write', f'D-07: contents must be write; got {perms}'


def test_backtest_concurrency_no_cancel():
    """RESEARCH §R5/R6: cancel-in-progress=false on cron + dispatch workflow."""
    cfg = _load(BACKTEST_YML)
    conc = cfg.get('concurrency') or {}
    assert conc.get('group') == 'forecast-backtest'
    assert conc.get('cancel-in-progress') is False


def test_backtest_timeout_minutes():
    """R5: timeout cap to fit GHA budget."""
    cfg = _load(BACKTEST_YML)
    job = cfg['jobs']['backtest']
    assert job.get('timeout-minutes') == 30


def test_backtest_skip_ci_in_commit():
    """[skip ci] prevents recursive trigger of forecast-quality-gate on auto-commit."""
    body = BACKTEST_YML.read_text()
    assert '[skip ci]' in body


@pytest.mark.skipif(not GATE_YML.exists(), reason='gate workflow not yet committed (plan 17-08)')
def test_gate_workflow_permissions_read():
    """BCK-06: forecast-quality-gate.yml is read-only — no commits from PR runs."""
    cfg = _load(GATE_YML)
    perms = cfg.get('permissions') or {}
    assert perms.get('contents') == 'read'


@pytest.mark.skipif(not GATE_YML.exists(), reason='gate workflow not yet committed (plan 17-08)')
def test_gate_workflow_pr_trigger():
    cfg = _load(GATE_YML)
    on_block = cfg.get('on') or cfg.get(True) or {}
    pr = on_block.get('pull_request') or {}
    paths = pr.get('paths') or []
    assert any('scripts/forecast' in p for p in paths)


@pytest.mark.skipif(not GATE_YML.exists(), reason='gate workflow not yet committed (plan 17-08)')
def test_gate_workflow_cancel_on_supersede():
    """BCK-06: superseded PR commits cancel prior runs."""
    cfg = _load(GATE_YML)
    conc = cfg.get('concurrency') or {}
    assert conc.get('cancel-in-progress') is True


@pytest.mark.skipif(not GATE_YML.exists(), reason='gate workflow not yet committed (plan 17-08)')
def test_gate_workflow_5min_timeout():
    cfg = _load(GATE_YML)
    job_name = next(iter(cfg['jobs']))
    assert cfg['jobs'][job_name].get('timeout-minutes') == 5
