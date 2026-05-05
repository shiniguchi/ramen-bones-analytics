-- 0061_feature_flags.sql
-- Phase 16 D-10 / UPL-07: per-restaurant feature flags table.
-- v1 use case: the `offweek_reminder` flag fires once on or after
-- `remind_on_or_after_date` (default 2026-10-15) so the operator can plan a
-- deliberate off-week, re-anchoring the counterfactual baseline that the
-- 2026-04-14 paid Instagram campaign permanently lifted.
--
-- Atomic-fire-once mechanism (mitigates T-16-02):
--   UPDATE public.feature_flags
--      SET enabled = true, updated_at = now()
--    WHERE flag_key = 'offweek_reminder'
--      AND enabled = false
--      AND remind_on_or_after_date <= current_date;
-- Postgres serializes concurrent UPDATEs on the same row at REPEATABLE READ;
-- only one of two simultaneous GHA cron runs sees `enabled = false` and
-- writes the row. The other receives 0 rows updated and skips the reminder.
-- This is why `remind_on_or_after_date` is a typed `date` column rather than
-- being parsed out of `description` — the predicate must be an indexed,
-- value-comparable filter (RESEARCH §Q4 RESOLVED).
--
-- Phase 17 will extend this table with backtest-gate rows (e.g.
-- `flag_key='backtest_gate'`) without schema regret — the (restaurant_id,
-- flag_key) PK already partitions per flag.
--
-- service_role bypasses RLS at the role level (`bypassrls=true`); the REVOKE
-- below is what gates anon/authenticated writes. Same pattern as 0050 / 0058.

CREATE TABLE public.feature_flags (
    restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    flag_key text NOT NULL,
    enabled boolean NOT NULL DEFAULT false,
    remind_on_or_after_date date,
    description text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (restaurant_id, flag_key)
);

COMMENT ON TABLE public.feature_flags IS 'Phase 16 D-10: per-restaurant feature flags including offweek_reminder.';
COMMENT ON COLUMN public.feature_flags.remind_on_or_after_date IS 'Phase 16 D-10: typed date for atomic predicate `remind_on_or_after_date <= current_date` (RESEARCH §Q4).';

-- RLS: tenant-scoped read; no insert/update/delete policy (service_role only).
-- Verbatim shape from supabase/migrations/0050_forecast_daily.sql lines 18-21.
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY feature_flags_select ON public.feature_flags
    FOR SELECT USING (restaurant_id = (auth.jwt()->>'restaurant_id')::uuid);
REVOKE INSERT, UPDATE, DELETE ON public.feature_flags FROM authenticated, anon;
GRANT SELECT ON public.feature_flags TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feature_flags TO service_role;

-- Idempotent seed: one offweek_reminder row per existing restaurant.
-- ON CONFLICT DO NOTHING makes re-runs safe (no clobber of an already-fired
-- flag where enabled=true).
INSERT INTO public.feature_flags (restaurant_id, flag_key, enabled, remind_on_or_after_date, description)
SELECT r.id, 'offweek_reminder', false, '2026-10-15'::date,
       'Fire on or after 2026-10-15 to re-anchor the counterfactual via a planned off-week.'
FROM public.restaurants r
ON CONFLICT (restaurant_id, flag_key) DO NOTHING;
