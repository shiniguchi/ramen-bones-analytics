-- 0015_auth_hook_security_definer.sql
--
-- Phase 4 Gap B remediation. Phase 1 0002 created custom_access_token_hook
-- without SECURITY DEFINER, so GoTrue executed it as supabase_auth_admin,
-- which is neither `authenticated` nor BYPASSRLS, so the SELECT against
-- public.memberships was silently filtered to zero rows by RLS. Every
-- signed-in user got a JWT without restaurant_id and was bounced to
-- /not-provisioned.
--
-- This ALTER is idempotent: re-running it against a function that is
-- already SECURITY DEFINER is a no-op (PG accepts the same setting).
--
-- See .planning/phases/04-mobile-reader-ui/04-VERIFICATION.md §"Gap B"
-- for the full incident writeup.

alter function public.custom_access_token_hook(jsonb) security definer;
