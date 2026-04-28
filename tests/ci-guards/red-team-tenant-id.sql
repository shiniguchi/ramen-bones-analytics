-- tests/ci-guards/red-team-tenant-id.sql
-- DELIBERATE-VIOLATION fixture for Guard 7 (Phase 12 FND-10).
--
-- NEVER move this file into supabase/migrations/. The Guard 7 unit test
-- in tests/unit/ci-guards.test.ts copies this content into a temp file
-- under supabase/migrations/, runs scripts/ci-guards.sh, asserts the
-- guard fires (exit 1), and removes the temp file.

create view public.evil_v as
select *
from public.transactions x
where x.tenant_id::text = (auth.jwt()->>'tenant_id');
