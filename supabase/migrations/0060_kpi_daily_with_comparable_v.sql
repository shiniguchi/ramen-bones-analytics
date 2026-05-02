-- 0060_kpi_daily_with_comparable_v.sql
-- Phase 16 D-03 / UPL-03: kpi_daily_with_comparable_v.
-- Extends kpi_daily_mv with revenue_comparable_eur derived from
-- stg_orderbird_order_items joined to baseline_items_v.
-- View (not MV) per D-03 — small enough to compute on-read; keeps
-- kpi_daily_mv shape unchanged for the rest of the dashboard.
-- Used by counterfactual_fit.py (Plan 05); CF fits MUST source revenue
-- from this view's revenue_comparable_eur column, NEVER from raw
-- kpi_daily_mv.revenue_cents (CI Guard 9 / Plan 11 enforces).
--
-- DEVIATION from 12-PROPOSAL §7 lines 806-825 AND from 16-03-PLAN Task 2's
-- literal SQL (Rule 1 / Rule 3 — schema mismatch in the original sketch):
--
--   The plan body reads `soi.occurred_at AT TIME ZONE r.timezone` and
--   `soi.item_gross_cents`, but `stg_orderbird_order_items` has NEITHER
--   column (see migration 0007 — only csv_date/csv_time text columns and
--   a text-stored item_gross_amount_eur). The canonical join pattern in
--   migrations 0025 / 0029 takes the time anchor from
--   `transactions.occurred_at` via
--     `JOIN public.transactions t
--        ON t.restaurant_id = oi.restaurant_id
--       AND t.source_tx_id  = oi.invoice_number`
--   and reads per-line gross via
--     `coalesce(nullif(oi.item_gross_amount_eur, '')::numeric, 0)`.
--   We mirror that pattern here. This is the SAME deviation Plan 02
--   already applied for migration 0059_baseline_items_v.sql; both views
--   inherited the gap from 12-PROPOSAL §7. The semantic intent
--   ("revenue from items in baseline_items_v only, per business_date")
--   is preserved unchanged.

CREATE OR REPLACE VIEW public.kpi_daily_with_comparable_v AS
WITH comparable AS (
  -- Per (restaurant_id, business_date): sum of gross EUR over line items
  -- that ALSO appear in baseline_items_v (the "comparable" subset).
  -- INNER JOIN to baseline_items_v filters out non-comparable launches
  -- (Onsen EGG, Tantan, Hell beer) per Plan 02 and CONTEXT.md <deferred>.
  -- Mirrors 0029 + 0025 join shape so the codebase has ONE canonical
  -- "item_name -> business_date -> revenue" derivation.
  SELECT
    t.restaurant_id,
    (t.occurred_at AT TIME ZONE r.timezone)::date AS business_date,
    -- item_gross_amount_eur is text in staging; empty string -> 0.
    -- × 100 -> cents (bigint), to match kpi_daily_mv.revenue_cents shape.
    (SUM(COALESCE(NULLIF(oi.item_gross_amount_eur, '')::numeric, 0)) * 100)::bigint
      AS revenue_comparable_cents
  FROM public.stg_orderbird_order_items oi
  JOIN public.transactions t
    ON  t.restaurant_id = oi.restaurant_id
    AND t.source_tx_id  = oi.invoice_number
  JOIN public.restaurants r
    ON r.id = t.restaurant_id
  INNER JOIN public.baseline_items_v b
    ON  b.restaurant_id = oi.restaurant_id
    AND b.item_name     = oi.item_name
  WHERE oi.item_name IS NOT NULL
    AND oi.item_name <> ''
  GROUP BY t.restaurant_id, (t.occurred_at AT TIME ZONE r.timezone)::date
)
-- LEFT JOIN preserves all kpi_daily_mv rows: dates with zero comparable
-- revenue still appear (with 0 via COALESCE), so callers don't need to
-- fill missing dates client-side. This matches the contract tested by
-- test_comparable_zero_when_only_post_campaign_items.
SELECT
  k.restaurant_id,
  k.business_date,
  (k.revenue_cents / 100.0)::numeric(14,2)        AS revenue_eur,
  k.tx_count,
  (k.avg_ticket_cents / 100.0)::numeric(10,2)     AS avg_ticket_eur,
  -- COALESCE turns "no comparable items sold today" into 0, not NULL.
  -- ::numeric(14,2) keeps the column type stable for clients.
  (COALESCE(c.revenue_comparable_cents, 0) / 100.0)::numeric(14,2)
                                                   AS revenue_comparable_eur
FROM public.kpi_daily_mv k
LEFT JOIN comparable c
  ON  c.restaurant_id = k.restaurant_id
  AND c.business_date = k.business_date
-- RLS: tenant-scoped wrapper-view filter. JWT claim is restaurant_id,
-- NEVER tenant_id (Phase 12 D-03 / Guard 7).
WHERE k.restaurant_id = (auth.jwt()->>'restaurant_id')::uuid;

COMMENT ON VIEW public.kpi_daily_with_comparable_v IS
  'Phase 16 D-03: extends kpi_daily_mv with revenue_comparable_eur for Track-B fits.';

GRANT SELECT ON public.kpi_daily_with_comparable_v TO authenticated;
