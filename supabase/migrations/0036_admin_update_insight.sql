-- 0036_admin_update_insight.sql
-- Admin-only inline-edit path for public.insights.
--
-- The Dashboard InsightCard lets restaurant owners correct the auto-generated
-- headline/body/bullets directly in the browser. Authentication + authorization
-- run through a SECURITY DEFINER function so authenticated users never touch the
-- underlying table (its grants remain service_role-only per 0016's design).
--
-- Authorization rule: caller must have role='owner' in public.memberships for
-- the SAME restaurant_id as the target insight. Viewers and cross-tenant users
-- get EXCEPTION 42501.
--
-- The write itself sets fallback_used=false — the row is no longer template-
-- generated once a human edits it.

CREATE OR REPLACE FUNCTION public.admin_update_insight(
  p_id uuid,
  p_headline text,
  p_body text,
  p_action_points text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid         uuid  := auth.uid();
  v_restaurant  uuid;
  v_role        public.membership_role;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'admin_update_insight: no authenticated user' USING ERRCODE = '42501';
  END IF;

  -- Resolve the target insight's tenant.
  SELECT restaurant_id INTO v_restaurant
  FROM public.insights
  WHERE id = p_id;
  IF v_restaurant IS NULL THEN
    RAISE EXCEPTION 'admin_update_insight: insight % not found', p_id USING ERRCODE = 'P0002';
  END IF;

  -- Caller must be an owner of that restaurant.
  SELECT role INTO v_role
  FROM public.memberships
  WHERE user_id = v_uid AND restaurant_id = v_restaurant;
  IF v_role IS NULL OR v_role <> 'owner' THEN
    RAISE EXCEPTION 'admin_update_insight: caller lacks owner role' USING ERRCODE = '42501';
  END IF;

  -- Basic length sanity — keeps pathological payloads out of the card.
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

  UPDATE public.insights
     SET headline      = p_headline,
         body          = p_body,
         action_points = COALESCE(p_action_points, ARRAY[]::text[]),
         fallback_used = false,
         generated_at  = now()
   WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_insight(uuid, text, text, text[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_insight(uuid, text, text, text[]) TO authenticated;

COMMENT ON FUNCTION public.admin_update_insight(uuid, text, text, text[]) IS
  'Admin inline-edit path for public.insights. Caller must hold role=''owner'' in memberships for the target restaurant. Sets fallback_used=false (human-curated).';
