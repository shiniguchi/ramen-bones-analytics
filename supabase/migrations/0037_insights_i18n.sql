-- 0037_insights_i18n.sql
-- Adds a `jsonb` `i18n` column to `public.insights` so each row can carry the
-- headline/body/action_points in multiple UI languages (en, de, ja, es, fr).
--
-- LLM-generated insight copy is the only dynamic, per-row text in the app —
-- static UI labels live in src/lib/i18n/messages.ts, not here. The Haiku
-- tool-use call at supabase/functions/generate-insight emits all 5 locales
-- in one request (migration delivered alongside this one).
--
-- Schema choice (jsonb map over child table):
--   - Scales to new languages with zero schema migrations — just extend the
--     src/lib/i18n/locales.ts LOCALES array.
--   - Preserves the single-row fetch path used by +page.server.ts — no join.
--   - Single append-only CREATE OR REPLACE VIEW update (column order
--     constraint satisfied: new column at the end).
--
-- Backward compatibility: the pre-i18n scalar columns (headline, body,
-- action_points) remain. A BEFORE INSERT/UPDATE trigger keeps them in sync
-- with `i18n -> 'en'` in both directions, so the existing admin_update_insight
-- RPC (4-arg, pre-0038) and any legacy reader that ignores `i18n` keep
-- working for the English locale.

-- 1. Add the column. DEFAULT '{}' makes re-runs idempotent; NOT NULL is
--    enforced once the backfill in step 2 is done.
ALTER TABLE public.insights
  ADD COLUMN IF NOT EXISTS i18n jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 2. Backfill. Any existing row whose `i18n` is empty OR missing the `en`
--    block gets the current scalar columns projected in. Safe to re-run.
UPDATE public.insights
   SET i18n = jsonb_set(
     COALESCE(i18n, '{}'::jsonb),
     '{en}',
     jsonb_build_object(
       'headline', headline,
       'body', body,
       'action_points', to_jsonb(COALESCE(action_points, ARRAY[]::text[]))
     )
   )
 WHERE NOT (i18n ? 'en');

-- 3. Check constraint: `i18n -> 'en'` must always exist with the required
--    sub-fields of the right JSON type. Enforces the "English is the safety
--    net" invariant the InsightCard's fallback logic relies on.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'insights_i18n_has_en'
  ) THEN
    ALTER TABLE public.insights
      ADD CONSTRAINT insights_i18n_has_en CHECK (
        jsonb_typeof(i18n -> 'en' -> 'headline') = 'string'
        AND jsonb_typeof(i18n -> 'en' -> 'body') = 'string'
        AND jsonb_typeof(i18n -> 'en' -> 'action_points') = 'array'
      );
  END IF;
END$$;

-- 4. Sync trigger. Two-way projection between scalars and `i18n -> 'en'`:
--    - If `i18n` is the thing being changed (edge function or new admin RPC
--      writes all 5 locales), project `i18n -> 'en'` back to the scalar
--      columns so legacy readers still see the latest English copy.
--    - If only the scalars are being changed (legacy 4-arg
--      admin_update_insight from pre-0038), project them into `i18n -> 'en'`
--      so the new read path stays consistent.
--    The net effect: `i18n -> 'en'` and the scalar columns are always
--    mirrors of each other, regardless of which signature the writer used.
CREATE OR REPLACE FUNCTION public.insights_sync_en() RETURNS trigger AS $$
DECLARE
  v_i18n_changed boolean;
BEGIN
  v_i18n_changed := (TG_OP = 'INSERT') OR (NEW.i18n IS DISTINCT FROM OLD.i18n);

  IF v_i18n_changed AND (NEW.i18n ? 'en') THEN
    -- i18n is authoritative — project en → scalars.
    NEW.headline := NEW.i18n -> 'en' ->> 'headline';
    NEW.body     := NEW.i18n -> 'en' ->> 'body';
    NEW.action_points := COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(NEW.i18n -> 'en' -> 'action_points')),
      ARRAY[]::text[]
    );
  ELSE
    -- Scalars changed without i18n — project scalars → en.
    NEW.i18n := jsonb_set(
      COALESCE(NEW.i18n, '{}'::jsonb),
      '{en}',
      jsonb_build_object(
        'headline', NEW.headline,
        'body', NEW.body,
        'action_points', to_jsonb(COALESCE(NEW.action_points, ARRAY[]::text[]))
      )
    );
  END IF;

  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS insights_sync_en_bi ON public.insights;
CREATE TRIGGER insights_sync_en_bi
  BEFORE INSERT OR UPDATE ON public.insights
  FOR EACH ROW EXECUTE FUNCTION public.insights_sync_en();

-- 5. Expose `i18n` via the tenant-facing wrapper view. CREATE OR REPLACE VIEW
--    cannot insert a column in the middle of the SELECT list (SQLSTATE
--    42P16) — column order is cosmetic, so we append. security_invoker=false
--    preserved from 0035 per the wrapper-view pattern documented there.
CREATE OR REPLACE VIEW public.insights_v
  WITH (security_invoker = false) AS
SELECT
  id,
  restaurant_id,
  business_date,
  generated_at,
  headline,
  body,
  model,
  fallback_used,
  action_points,
  i18n
FROM public.insights
WHERE restaurant_id::text = (auth.jwt()->>'restaurant_id');

GRANT SELECT ON public.insights_v TO authenticated;

COMMENT ON COLUMN public.insights.i18n IS
  'Per-locale dashboard insight copy. Shape: {"<locale>": {"headline": text, "body": text, "action_points": text[]}, ...}. Must always contain an "en" block (enforced by insights_i18n_has_en). Locales in sync with src/lib/i18n/locales.ts LOCALES.';
