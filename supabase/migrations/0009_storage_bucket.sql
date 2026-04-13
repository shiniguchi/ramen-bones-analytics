-- Phase 2 / ING-01: private bucket for Orderbird pre-joined CSVs.
insert into storage.buckets (id, name, public)
values ('orderbird-raw', 'orderbird-raw', false)
on conflict (id) do nothing;

-- Service role bypasses RLS automatically; explicit policy here documents intent
-- and denies authenticated/anon even if service_role flag is ever stripped.
create policy "orderbird_raw_service_role_read"
  on storage.objects for select to service_role
  using (bucket_id = 'orderbird-raw');

-- Explicit deny for authenticated + anon (defense-in-depth; they have no other policy
-- so default-deny already applies).
