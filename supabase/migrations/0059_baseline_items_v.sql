-- 0059_baseline_items_v.sql
-- Phase 16 D-02 / UPL-03: baseline_items_v.
-- Items first seen >=7 days BEFORE the tenant's earliest
-- campaign_calendar.start_date. The 7-day buffer matches the anticipation
-- cutoff (Phase 12 D-01 / C-04). Excludes Onsen EGG, Tantan, Hell beer
-- (campaign-era launches) per tools/its_validity_audit.py findings
-- 2026-04-27 and CONTEXT.md <deferred>.
--
-- Wrapper view; RLS via WHERE clause. We deliberately do NOT set the
-- security-invoker option on the view (Pitfall 2 from cohort_mv,
-- migration 0010 lines 62-77) — postgres-15 default is fine.
--
-- DEVIATION from 12-PROPOSAL §7 lines 787-804 (Rule 1 / Rule 3 — schema
-- mismatch in the original sketch):
--   The §7 sketch reads `MIN(occurred_at::date) FROM stg_orderbird_order_items`
--   but `stg_orderbird_order_items` has NO `occurred_at` column (see
--   migration 0007 — it has csv_date text and joins to transactions for
--   the time anchor). We mirror the canonical join pattern from
--   0025_item_counts_daily_mv.sql lines 18-21:
--     `JOIN public.transactions t
--        ON t.restaurant_id = oi.restaurant_id
--       AND t.source_tx_id  = oi.invoice_number`
--   then take `MIN(t.occurred_at::date)` for first_seen_date.
--   The 12-PROPOSAL semantic ("first seen >= 7d before earliest campaign")
--   is preserved unchanged; only the time anchor source is corrected.

CREATE OR REPLACE VIEW public.baseline_items_v AS
WITH first_seen AS (
  -- Per (restaurant_id, item_name): the earliest business_date the item
  -- was sold. Mirrors 0025 join shape so the view matches the codebase's
  -- canonical "item_name -> occurred_at" derivation.
  SELECT
    oi.restaurant_id,
    oi.item_name,
    MIN(t.occurred_at::date) AS first_seen_date
  FROM public.stg_orderbird_order_items oi
  JOIN public.transactions t
    ON t.restaurant_id = oi.restaurant_id
   AND t.source_tx_id  = oi.invoice_number
  WHERE oi.item_name IS NOT NULL
    AND oi.item_name <> ''
  GROUP BY oi.restaurant_id, oi.item_name
),
min_campaign AS (
  -- Per restaurant: earliest campaign start. INNER JOIN below means
  -- tenants with NO campaign_calendar rows return ZERO baseline rows
  -- (defensive — D-02: "no campaign means no derived baseline").
  SELECT
    restaurant_id,
    MIN(start_date) AS earliest_campaign_start
  FROM public.campaign_calendar
  GROUP BY restaurant_id
)
SELECT
  fs.restaurant_id,
  fs.item_name,
  fs.first_seen_date
FROM first_seen fs
INNER JOIN min_campaign mc
  ON mc.restaurant_id = fs.restaurant_id
WHERE fs.first_seen_date <= mc.earliest_campaign_start - INTERVAL '7 days'
  -- RLS: tenant-scoped wrapper-view filter. JWT claim is restaurant_id,
  -- NEVER tenant_id (Phase 12 D-03 / Guard 7).
  AND fs.restaurant_id = (auth.jwt()->>'restaurant_id')::uuid;

COMMENT ON VIEW public.baseline_items_v IS
  'Phase 16 D-02 / UPL-03: items first seen >=7d before earliest campaign_start; comparable-revenue baseline for ITS counterfactual fits.';

GRANT SELECT ON public.baseline_items_v TO authenticated;
