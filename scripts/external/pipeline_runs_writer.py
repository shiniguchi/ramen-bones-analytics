"""Phase 13: pipeline_runs row writer.

Every fetcher invocation in run_all.py writes ONE row via one of:
- write_success(...) — fetch ok, optionally with upstream_freshness_h
- write_fallback(...) — primary upstream failed but cascade can continue
- write_failure(...)  — fetch threw; this fetcher's data is missing

Status taxonomy is fixed: 'success' | 'fallback' | 'failure'. The
dashboard freshness badge (Phase 15) reads upstream_freshness_h, NOT
status — see CONTEXT.md specifics.

error_msg is truncated at 2000 chars + '...' to keep rows compact.
The full traceback lives in the GHA workflow log; pipeline_runs is
the human-triage breadcrumb, not the system-of-record for stack traces.
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Optional
import os

from supabase import Client

ERROR_MSG_CAP = 2000


def _truncate(msg: Optional[str]) -> Optional[str]:
    if msg is None:
        return None
    if len(msg) <= ERROR_MSG_CAP:
        return msg
    return msg[:ERROR_MSG_CAP] + '...'


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _commit_sha() -> Optional[str]:
    return os.environ.get('GITHUB_SHA') or os.environ.get('COMMIT_SHA')


def write_success(
    client: Client,
    *,
    step_name: str,
    started_at: datetime,
    row_count: int,
    upstream_freshness_h: Optional[float] = None,
    restaurant_id: Optional[str] = None,
    commit_sha: Optional[str] = None,
) -> None:
    """Insert a 'success' row."""
    payload = {
        'step_name': step_name,
        'started_at': started_at.isoformat(),
        'finished_at': _now().isoformat(),
        'status': 'success',
        'row_count': row_count,
        'upstream_freshness_h': upstream_freshness_h,
        'error_msg': None,
        'restaurant_id': restaurant_id,
        'commit_sha': commit_sha or _commit_sha(),
    }
    res = client.table('pipeline_runs').insert(payload).execute()
    if getattr(res, 'error', None):
        raise RuntimeError(f'pipeline_runs insert (success) failed: {res.error}')


def write_fallback(
    client: Client,
    *,
    step_name: str,
    started_at: datetime,
    error_msg: str,
    row_count: int = 0,
    upstream_freshness_h: Optional[float] = None,
    restaurant_id: Optional[str] = None,
    commit_sha: Optional[str] = None,
) -> None:
    """Insert a 'fallback' row — primary source failed but cascade may continue."""
    payload = {
        'step_name': step_name,
        'started_at': started_at.isoformat(),
        'finished_at': _now().isoformat(),
        'status': 'fallback',
        'row_count': row_count,
        'upstream_freshness_h': upstream_freshness_h,
        'error_msg': _truncate(error_msg),
        'restaurant_id': restaurant_id,
        'commit_sha': commit_sha or _commit_sha(),
    }
    res = client.table('pipeline_runs').insert(payload).execute()
    if getattr(res, 'error', None):
        raise RuntimeError(f'pipeline_runs insert (fallback) failed: {res.error}')


def write_failure(
    client: Client,
    *,
    step_name: str,
    started_at: datetime,
    error_msg: str,
    restaurant_id: Optional[str] = None,
    commit_sha: Optional[str] = None,
) -> None:
    """Insert a 'failure' row — this source's data is missing this run."""
    payload = {
        'step_name': step_name,
        'started_at': started_at.isoformat(),
        'finished_at': _now().isoformat(),
        'status': 'failure',
        'row_count': 0,
        'upstream_freshness_h': None,
        'error_msg': _truncate(error_msg),
        'restaurant_id': restaurant_id,
        'commit_sha': commit_sha or _commit_sha(),
    }
    res = client.table('pipeline_runs').insert(payload).execute()
    if getattr(res, 'error', None):
        raise RuntimeError(f'pipeline_runs insert (failure) failed: {res.error}')
