-- 0038_admin_update_insight_i18n.sql
-- Extends public.admin_update_insight (0036) with a p_locale parameter so
-- owners can correct the InsightCard per-language.
--
-- The function writes into public.insights.i18n via jsonb_set. The BEFORE
-- trigger from 0037 keeps i18n->'en' mirrored into the scalar headline/body/
-- action_points columns, so the 4-arg legacy signature's behavior is
-- preserved when p_locale defaults to 'en'.
--
-- Signature change: the 4-arg function is dropped and replaced with a 5-arg
-- function with a DEFAULT. Existing callers passing 4 args keep working
-- (p_locale defaults to 'en'); new callers passing 5 args target any
-- supported locale.

DROP FUNCTION IF EXISTS public.admin_update_insight(uuid, text, text, text[]);

CREATE OR REPLACE FUNCTION public.admin_update_insight(
  p_id uuid,
  p_headline text,
  p_body text,
  p_action_points text[],
  p_locale text DEFAULT 'en'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid        uuid  := auth.uid();
  v_restaurant uuid;
  v_role       public.membership_role;
  -- Keep in sync with src/lib/i18n/locales.ts LOCALES. Forkers adding a
  -- language must append here.
  v_locales    text[] := ARRAY['en', 'de', 'ja', 'es', 'fr'];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'admin_update_insight: no authenticated user' USING ERRCODE = '42501';
  END IF;

  IF NOT (p_locale = ANY (v_locales)) THEN
    RAISE EXCEPTION 'admin_update_insight: locale % not in supported set', p_locale
      USING ERRCODE = '22023';
  END IF;

  SELECT restaurant_id INTO v_restaurant
  FROM public.insights
  WHERE id = p_id;
  IF v_restaurant IS NULL THEN
    RAISE EXCEPTION 'admin_update_insight: insight % not found', p_id USING ERRCODE = 'P0002';
  END IF;

  SELECT role INTO v_role
  FROM public.memberships
  WHERE user_id = v_uid AND restaurant_id = v_restaurant;
  IF v_role IS NULL OR v_role <> 'owner' THEN
    RAISE EXCEPTION 'admin_update_insight: caller lacks owner role' USING ERRCODE = '42501';
  END IF;

  IF char_length(p_headline) > 240 THEN
    RAISE EXCEPTION 'headline too long (% chars, max 240)', char_length(p_headline)
      USING ERRCODE = '22001';
  END IF;
  IF char_length(p_body) > 2000 THEN
    RAISE EXCEPTION 'body too long (% chars, max 2000)', char_length(p_body)
      USING ERRCODE = '22001';
  END IF;
  IF array_length(p_action_points, 1) IS NOT NULL
     AND array_length(p_action_points, 1) > 5 THEN
    RAISE EXCEPTION 'too many action_points (max 5)' USING ERRCODE = '22001';
  END IF;

  -- Merge into i18n[p_locale]. The 0037 BEFORE trigger mirrors i18n->'en'
  -- back to the scalar columns when p_locale='en'; for other locales the
  -- scalar columns are untouched (English remains the base-row copy).
  UPDATE public.insights
     SET i18n = jsonb_set(
           COALESCE(i18n, '{}'::jsonb),
           ARRAY[p_locale],
           jsonb_build_object(
             'headline', p_headline,
             'body', p_body,
             'action_points', to_jsonb(COALESCE(p_action_points, ARRAY[]::text[]))
           )
         ),
         fallback_used = false,
         generated_at  = now()
   WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_insight(uuid, text, text, text[], text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_insight(uuid, text, text, text[], text) TO authenticated;

COMMENT ON FUNCTION public.admin_update_insight(uuid, text, text, text[], text) IS
  'Admin inline-edit path for public.insights, per locale. Writes into i18n[p_locale] jsonb; default locale is en. Caller must hold role=''owner'' in memberships for the target restaurant. Sets fallback_used=false (human-curated). 4-arg legacy calls still work — p_locale defaults to ''en''.';
