-- 0058_campaign_calendar.sql
-- Phase 16 D-01: campaign_calendar table per UPL-01.
-- Tenant-scoped via auth.jwt()->>'restaurant_id'. Writes via service_role /
-- Supabase Studio for v1 (admin form deferred to v1.4). Seeded with the
-- 2026-04-14 friend-owner Instagram campaign.
--
-- Mechanical port of 12-PROPOSAL §7 lines 867-880 with the C-01 rename rule
-- (tenant_id -> restaurant_id; Phase 12 D-03 / Guard 7). Replaces the
-- hardcoded CAMPAIGN_START constant retired in Phase 15. Drives EventMarker,
-- baseline_items_v, counterfactual_fit, and cumulative_uplift downstream.
--
-- service_role bypasses RLS at the role level (`bypassrls=true`); the REVOKE
-- below is what gates anon/authenticated writes. Same pattern as 0050 and
-- 0047.

CREATE TABLE public.campaign_calendar (
    campaign_id text PRIMARY KEY,
    restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    start_date date NOT NULL,
    end_date date NOT NULL,
    name text,
    channel text,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (end_date >= start_date)
);

COMMENT ON TABLE public.campaign_calendar IS 'Phase 16 UPL-01: campaign windows for ITS uplift attribution.';

CREATE INDEX campaign_calendar_restaurant_start_idx ON public.campaign_calendar(restaurant_id, start_date);

-- RLS: tenant-scoped read; no insert/update/delete policy (service_role only).
-- Verbatim shape from supabase/migrations/0050_forecast_daily.sql lines 18-21.
ALTER TABLE public.campaign_calendar ENABLE ROW LEVEL SECURITY;
CREATE POLICY campaign_calendar_select ON public.campaign_calendar
    FOR SELECT USING (restaurant_id = (auth.jwt()->>'restaurant_id')::uuid);
REVOKE INSERT, UPDATE, DELETE ON public.campaign_calendar FROM authenticated, anon;
GRANT SELECT ON public.campaign_calendar TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_calendar TO service_role;

-- Idempotent seed: 2026-04-14 friend-owner first paid Instagram campaign.
-- Resolves restaurant_id via subquery (avoids hardcoded UUID — Phase 13 0047
-- pattern). NOT EXISTS guard makes the migration safe to re-run.
INSERT INTO public.campaign_calendar (campaign_id, restaurant_id, start_date, end_date, name, channel, notes)
SELECT 'friend-owner-2026-04-14', r.id, '2026-04-14'::date, '2026-04-14'::date,
       'First paid Instagram campaign', 'instagram',
       'Hardcoded campaign date pre-Phase 16; now generalized via campaign_calendar'
FROM public.restaurants r
WHERE NOT EXISTS (SELECT 1 FROM public.campaign_calendar WHERE campaign_id = 'friend-owner-2026-04-14')
ORDER BY r.created_at
LIMIT 1;
