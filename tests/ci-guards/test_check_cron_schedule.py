"""Phase 12 FND-11: pytest cases for scripts/ci-guards/check-cron-schedule.py.

Validates Guard 8's behavior on three scenarios:
  1. POSITIVE — current-repo state passes (sanity check; smoke).
  2. NEGATIVE — two cron entries collide at the same wall-clock time
                in CEST. Helper exits 1 with an OVERLAP violation.
  3. NEGATIVE — two consecutive cascade members fire <60 min apart.
                Helper exits 1 with a CASCADE-GAP violation.

Each negative case uses tmpdir to stage a fake repo skeleton (with the
real check-cron-schedule.py copied in or invoked via a path arg). The
helper script accepts the repo root via REPO_ROOT computation from its
own __file__ path — so we cannot easily redirect it via env var without
refactoring the script. Instead, the negative tests use a temp-clone
of the script with a patched REPO_ROOT, OR they monkeypatch the helper
by writing a tiny wrapper script.

Approach chosen: copy the helper into the tmpdir and invoke it from
there. The helper's REPO_ROOT computation (parents[2]) means a copy at
<tmpdir>/scripts/ci-guards/check-cron-schedule.py points at <tmpdir>.
"""
from __future__ import annotations
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
HELPER = REPO / "scripts" / "ci-guards" / "check-cron-schedule.py"


# ----- positive case: real repo state -----

def test_current_repo_passes():
    """The helper run against the live repo exits 0. Guards 1-7 are
    verified separately; this case is a smoke test for Guard 8 on
    the actually-shipped state."""
    result = subprocess.run(
        [sys.executable, str(HELPER)],
        capture_output=True, text=True, cwd=str(REPO),
    )
    assert result.returncode == 0, (
        f"Guard 8 unexpectedly fired on current repo.\n"
        f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )


# ----- negative-case helpers -----

def _stage_fake_repo(tmpdir: Path, workflows: dict[str, str], migrations: dict[str, str]) -> Path:
    """Copy the helper into a fake repo skeleton at tmpdir, populate
    .github/workflows/*.yml and supabase/migrations/*.sql from the
    provided dicts, and return the path to the staged helper."""
    wf = tmpdir / ".github" / "workflows"
    mig = tmpdir / "supabase" / "migrations"
    helper_dir = tmpdir / "scripts" / "ci-guards"
    wf.mkdir(parents=True, exist_ok=True)
    mig.mkdir(parents=True, exist_ok=True)
    helper_dir.mkdir(parents=True, exist_ok=True)
    for name, content in workflows.items():
        (wf / name).write_text(content)
    for name, content in migrations.items():
        (mig / name).write_text(content)
    # Copy the helper so its REPO_ROOT computation (parents[2]) lands
    # at tmpdir, NOT the real repo.
    staged = helper_dir / "check-cron-schedule.py"
    shutil.copy2(HELPER, staged)
    return staged


# ----- negative case 1: overlap in CEST -----

def test_overlap_in_cest_fails(tmp_path: Path):
    """Two crons at identical UTC time produce identical wall-clock in
    BOTH CET and CEST — a hard collision. Helper must fire."""
    workflows = {
        # Both at 02:00 UTC -> 03:00 CET / 04:00 CEST. Identical.
        "alpha.yml": (
            "name: Alpha\n"
            "on:\n  schedule:\n    - cron: '0 2 * * *'\n"
            "jobs:\n  noop:\n    runs-on: ubuntu-latest\n    steps:\n"
            "      - run: 'true'\n"
        ),
        "beta.yml": (
            "name: Beta\n"
            "on:\n  schedule:\n    - cron: '0 2 * * *'\n"
            "jobs:\n  noop:\n    runs-on: ubuntu-latest\n    steps:\n"
            "      - run: 'true'\n"
        ),
    }
    staged = _stage_fake_repo(tmp_path, workflows=workflows, migrations={})
    result = subprocess.run(
        [sys.executable, str(staged)],
        capture_output=True, text=True, cwd=str(tmp_path),
    )
    assert result.returncode == 1, (
        f"Expected helper to fire on overlap; got exit {result.returncode}.\n"
        f"stdout:\n{result.stdout}"
    )
    assert "OVERLAP" in result.stdout
    assert "Guard 8" in result.stdout


# ----- negative case 2: <60-min cascade gap -----

def test_cascade_gap_too_small_fails(tmp_path: Path):
    """Cascade members 'external-data' and 'forecast-refresh' set 30
    minutes apart in UTC. CET/CEST gaps are also 30 min — below the
    60-min D-13 contract. Helper must fire."""
    workflows = {
        # 00:00 UTC -> 01:00 CET / 02:00 CEST
        "external-data-refresh.yml": (
            "name: External Data Refresh\n"
            "on:\n  schedule:\n    - cron: '0 0 * * *'\n"
            "jobs:\n  fetch:\n    runs-on: ubuntu-latest\n    steps:\n"
            "      - run: 'true'\n"
        ),
        # 00:30 UTC -> 01:30 CET / 02:30 CEST  (only 30 min after external-data)
        "forecast-refresh.yml": (
            "name: Forecast Refresh\n"
            "on:\n  schedule:\n    - cron: '30 0 * * *'\n"
            "jobs:\n  fit:\n    runs-on: ubuntu-latest\n    steps:\n"
            "      - run: 'true'\n"
        ),
    }
    staged = _stage_fake_repo(tmp_path, workflows=workflows, migrations={})
    result = subprocess.run(
        [sys.executable, str(staged)],
        capture_output=True, text=True, cwd=str(tmp_path),
    )
    assert result.returncode == 1, (
        f"Expected helper to fire on cascade-gap; got exit {result.returncode}.\n"
        f"stdout:\n{result.stdout}"
    )
    assert "CASCADE-GAP" in result.stdout
    assert "Guard 8" in result.stdout


# ----- positive synthetic: contract-shape passes -----

def test_synthetic_full_contract_passes(tmp_path: Path):
    """Stage the full D-12 contract — 5 entries with the canonical UTC
    schedule. Helper must exit 0 (no overlap, all cascade gaps >=60 min)."""
    workflows = {
        "external-data-refresh.yml": "name: ED\non:\n  schedule:\n    - cron: '0 0 * * *'\n",
        "its-validity-audit.yml":     "name: IA\non:\n  schedule:\n    - cron: '0 9 * * 1'\n",
        "forecast-refresh.yml":       "name: FR\non:\n  schedule:\n    - cron: '0 1 * * *'\n",
        "forecast-backtest.yml":      "name: FB\non:\n  schedule:\n    - cron: '0 23 * * 2'\n",
    }
    migrations = {
        "0001_refresh_analytics_mvs.sql": (
            "select cron.schedule(\n"
            "  'refresh-analytics-mvs',\n"
            "  '0 3 * * *',\n"
            "  $job$select 1;$job$\n"
            ");\n"
        ),
    }
    staged = _stage_fake_repo(tmp_path, workflows=workflows, migrations=migrations)
    result = subprocess.run(
        [sys.executable, str(staged)],
        capture_output=True, text=True, cwd=str(tmp_path),
    )
    assert result.returncode == 0, (
        f"Expected D-12 contract shape to pass; got exit {result.returncode}.\n"
        f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )
    assert "clean" in result.stdout
