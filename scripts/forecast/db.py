"""Phase 14: Supabase service-role client factory.

Mirrors the env contract of scripts/external/db.py (Phase 13):
- SUPABASE_URL          (Supabase project URL)
- SUPABASE_SERVICE_ROLE_KEY  (service-role JWT)

Service-role bypasses RLS and is the only role authorized to write to
the forecast tables (hybrid-RLS pattern: revoke insert/update/delete
from authenticated/anon, grant write to service_role only).
"""
from __future__ import annotations
import os
from supabase import create_client, Client


def make_client() -> Client:
    url = os.environ.get('SUPABASE_URL')
    key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if not url or not key:
        raise RuntimeError(
            'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. '
            'Local dev: source .env. CI: set in workflow env.'
        )
    return create_client(url, key)
