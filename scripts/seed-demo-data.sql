-- scripts/seed-demo-data.sql
-- Phase 04-09 Gap D closure: seed the DEV test restaurant with cohort-shaped
-- demo transactions so the Phase 4 dashboard renders all 9 cards end-to-end
-- and the Playwright happy-path spec + human iPhone UAT have real data to
-- chew on.
--
-- CONTRACT:
--   * Targets restaurant ba1bf707-aae9-46a9-8166-4b6459e6c2fd ONLY.
--   * Touches ONLY rows whose source_tx_id starts with 'demo-' — real ingested
--     data (from the Playwright scraper / CSV loader) is untouched.
--   * Idempotent: re-running produces an identical row count + identical data
--     (values are deterministic, guarded delete wipes prior demo rows first).
--   * Uses `now() - interval` for business_date so the seed stays "fresh"
--     relative to whenever it is run — the freshness label will show a
--     recent last-updated time after refresh_analytics_mvs().
--
-- USAGE:
--   psql "$SUPABASE_DB_URL" -f scripts/seed-demo-data.sql
--   -- then:
--   psql "$SUPABASE_DB_URL" -c "select public.refresh_analytics_mvs();"
--
-- VERIFY (via test_* SECURITY DEFINER helpers from migration 0012):
--   select count(*) from public.test_retention_curve(
--     'ba1bf707-aae9-46a9-8166-4b6459e6c2fd'::uuid);
--   select count(*) from public.test_ltv(
--     'ba1bf707-aae9-46a9-8166-4b6459e6c2fd'::uuid);
--   select count(*) from public.test_frequency(
--     'ba1bf707-aae9-46a9-8166-4b6459e6c2fd'::uuid);
--   select count(*) from public.test_new_vs_returning(
--     'ba1bf707-aae9-46a9-8166-4b6459e6c2fd'::uuid);

begin;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Guarded delete — only demo rows, never real data.
-- ────────────────────────────────────────────────────────────────────────────
delete from public.transactions
where restaurant_id = 'ba1bf707-aae9-46a9-8166-4b6459e6c2fd'
  and source_tx_id like 'demo-%';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Seed data.
--
-- Shape:
--   * 14 days of activity (d0 = 13 days ago .. d13 = today, Berlin-ish local)
--   * 5 distinct card_hash customers → 5 distinct cohorts (one per cohort week
--     if we spread them across the 14 days; we put 4 of them in week 1, then
--     2 more in week 2, so at least 2 weekly cohorts have cohort_size >= 2,
--     one has cohort_size >= 5 after including a shared "returner pool").
--   * Mix of repeat visits so retention at period 1 and period 2 > 0.
--   * 2 cash (card_hash NULL) rows so the new-vs-returning cash_anonymous
--     bucket is non-empty (D-19 / shapeNvr tie-out).
--   * net_cents in 800..3500 (€8..€35 realistic ramen tickets).
--
-- The insert uses a VALUES list driven off `now() - interval 'N days'` so
-- every run produces fresh occurred_at timestamps.
-- ────────────────────────────────────────────────────────────────────────────

with seed as (
  select
    'ba1bf707-aae9-46a9-8166-4b6459e6c2fd'::uuid as restaurant_id,
    v.source_tx_id,
    (now() - (v.days_ago || ' days')::interval)::timestamptz as occurred_at,
    v.card_hash,
    v.gross_cents,
    v.net_cents,
    v.tip_cents,
    v.payment_method,
    v.sales_type
  from (values
    -- ────────── Week 0 (oldest: 13..7 days ago) ──────────
    -- Cohort A: first visit d13, returns d10, d6, d2  (4 visits → '3-5' bucket)
    ('demo-A-01', 13, 'demo-card-A', 1800, 1682, 0,   'Visa',        'INHOUSE'),
    ('demo-A-02', 10, 'demo-card-A', 1400, 1308, 100, 'Visa',        'INHOUSE'),
    ('demo-A-03',  6, 'demo-card-A', 2100, 1963, 200, 'Visa',        'INHOUSE'),
    ('demo-A-04',  2, 'demo-card-A', 1600, 1495, 0,   'Visa',        'TAKEAWAY'),

    -- Cohort B: first visit d12, returns d9, d3  (3 visits → '3-5' bucket)
    ('demo-B-01', 12, 'demo-card-B', 2400, 2243, 100, 'MasterCard',  'INHOUSE'),
    ('demo-B-02',  9, 'demo-card-B', 1900, 1776, 0,   'MasterCard',  'INHOUSE'),
    ('demo-B-03',  3, 'demo-card-B', 2200, 2056, 200, 'MasterCard',  'INHOUSE'),

    -- Cohort C: first visit d11, returns d5  (2 visits → '2' bucket)
    ('demo-C-01', 11, 'demo-card-C', 1500, 1402, 0,   'Visa',        'TAKEAWAY'),
    ('demo-C-02',  5, 'demo-card-C', 1750, 1636, 100, 'Visa',        'INHOUSE'),

    -- Cohort D: first visit d11, single visit  (1 visit → '1' bucket)
    ('demo-D-01', 11, 'demo-card-D',  980,  916, 0,   'Maestro',     'TAKEAWAY'),

    -- Cohort E (shares week-0 cohort): first visit d8, returns d4, d1, d0
    ('demo-E-01',  8, 'demo-card-E', 2600, 2430, 200, 'MasterCard',  'INHOUSE'),
    ('demo-E-02',  4, 'demo-card-E', 2800, 2617, 300, 'MasterCard',  'INHOUSE'),
    ('demo-E-03',  1, 'demo-card-E', 3100, 2897, 200, 'MasterCard',  'INHOUSE'),
    ('demo-E-04',  0, 'demo-card-E', 3500, 3271, 300, 'MasterCard',  'INHOUSE'),

    -- ────────── Week 1 (7..0 days ago — new cohort F, G) ──────────
    -- Cohort F: first visit d6, returns d3, d0  (3 visits → '3-5')
    ('demo-F-01',  6, 'demo-card-F', 1200, 1121, 0,   'Visa',        'TAKEAWAY'),
    ('demo-F-02',  3, 'demo-card-F', 1450, 1355, 100, 'Visa',        'INHOUSE'),
    ('demo-F-03',  0, 'demo-card-F', 1650, 1542, 0,   'Visa',        'INHOUSE'),

    -- Cohort G: first visit d5, returns d2  (2 visits → '2')
    ('demo-G-01',  5, 'demo-card-G', 2000, 1869, 100, 'MasterCard',  'INHOUSE'),
    ('demo-G-02',  2, 'demo-card-G', 2300, 2150, 200, 'MasterCard',  'INHOUSE'),

    -- ────────── High-frequency filler (cohort H — 6 visits for '6-10' bucket) ──────────
    ('demo-H-01', 13, 'demo-card-H',  850,  794, 0,   'Bar',         'INHOUSE'),
    ('demo-H-02', 11, 'demo-card-H',  900,  841, 0,   'Bar',         'INHOUSE'),
    ('demo-H-03',  9, 'demo-card-H',  950,  888, 0,   'Bar',         'INHOUSE'),
    ('demo-H-04',  7, 'demo-card-H', 1000,  935, 0,   'Bar',         'INHOUSE'),
    ('demo-H-05',  4, 'demo-card-H', 1100, 1028, 0,   'Bar',         'INHOUSE'),
    ('demo-H-06',  1, 'demo-card-H', 1200, 1121, 0,   'Bar',         'INHOUSE'),

    -- ────────── Padding cards so all 14 days have activity ──────────
    -- Each adds one visit on an otherwise-thin day. These become single-visit
    -- customers in their own cohort week, adding cohort count density.
    ('demo-I-01', 13, 'demo-card-I', 1350, 1262, 0,   'Visa',        'INHOUSE'),
    ('demo-J-01', 12, 'demo-card-J', 1800, 1682, 100, 'MasterCard',  'INHOUSE'),
    ('demo-K-01', 10, 'demo-card-K', 2100, 1963, 0,   'Visa',        'TAKEAWAY'),
    ('demo-L-01',  9, 'demo-card-L', 1600, 1495, 100, 'Maestro',     'INHOUSE'),
    ('demo-M-01',  8, 'demo-card-M', 2500, 2336, 200, 'MasterCard',  'INHOUSE'),
    ('demo-N-01',  7, 'demo-card-N', 1900, 1776, 0,   'Visa',        'INHOUSE'),
    ('demo-O-01',  7, 'demo-card-O', 2200, 2056, 100, 'V PAY',       'INHOUSE'),
    ('demo-P-01',  6, 'demo-card-P', 1450, 1355, 0,   'Visa',        'TAKEAWAY'),
    ('demo-Q-01',  5, 'demo-card-Q', 1700, 1589, 100, 'MasterCard',  'INHOUSE'),
    ('demo-R-01',  4, 'demo-card-R', 1850, 1729, 100, 'Visa',        'INHOUSE'),
    ('demo-S-01',  3, 'demo-card-S', 2400, 2243, 200, 'MasterCard',  'INHOUSE'),
    ('demo-T-01',  3, 'demo-card-T', 1550, 1449, 0,   'Visa',        'TAKEAWAY'),
    ('demo-U-01',  2, 'demo-card-U', 2750, 2570, 200, 'MasterCard',  'INHOUSE'),
    ('demo-V-01',  1, 'demo-card-V', 2050, 1916, 100, 'Visa',        'INHOUSE'),
    ('demo-W-01',  1, 'demo-card-W', 1350, 1262, 0,   'Maestro',     'TAKEAWAY'),
    ('demo-X-01',  0, 'demo-card-X', 2900, 2710, 300, 'MasterCard',  'INHOUSE'),
    ('demo-Y-01',  0, 'demo-card-Y', 1750, 1636, 100, 'Visa',        'INHOUSE'),

    -- A handful of extra returning visits spread across days so daily tx
    -- counts stay non-trivial and the new-vs-returning card has returning
    -- revenue on most days of the 7d chip window.
    ('demo-A-05',  0, 'demo-card-A', 1900, 1776, 100, 'Visa',        'INHOUSE'),
    ('demo-B-04',  0, 'demo-card-B', 2500, 2336, 200, 'MasterCard',  'INHOUSE'),
    ('demo-F-04',  1, 'demo-card-F', 1800, 1682, 100, 'Visa',        'INHOUSE'),
    ('demo-G-03',  0, 'demo-card-G', 2150, 2009, 0,   'MasterCard',  'TAKEAWAY'),
    ('demo-H-07',  0, 'demo-card-H', 1250, 1168, 0,   'Bar',         'INHOUSE'),

    -- ────────── Extra repeat visits to push volume past the sanity floor ──────────
    -- Pushes total past 60 rows and gives cohort A/E/H richer retention curves.
    ('demo-A-06', 11, 'demo-card-A', 1700, 1589, 100, 'Visa',        'INHOUSE'),
    ('demo-A-07',  7, 'demo-card-A', 2000, 1869, 100, 'Visa',        'INHOUSE'),
    ('demo-B-05',  6, 'demo-card-B', 2300, 2150, 200, 'MasterCard',  'INHOUSE'),
    ('demo-E-05', 10, 'demo-card-E', 2400, 2243, 200, 'MasterCard',  'INHOUSE'),
    ('demo-E-06',  6, 'demo-card-E', 2700, 2523, 200, 'MasterCard',  'INHOUSE'),
    ('demo-H-08',  6, 'demo-card-H', 1150, 1075, 0,   'Bar',         'INHOUSE'),
    ('demo-H-09',  3, 'demo-card-H', 1300, 1215, 0,   'Bar',         'INHOUSE'),
    ('demo-C-03',  1, 'demo-card-C', 1900, 1776, 100, 'Visa',        'INHOUSE'),
    ('demo-F-05',  4, 'demo-card-F', 1700, 1589, 100, 'Visa',        'INHOUSE'),
    ('demo-G-04',  7, 'demo-card-G', 2250, 2103, 150, 'MasterCard',  'INHOUSE'),
    ('demo-D-02',  4, 'demo-card-D', 1050,  981, 0,   'Maestro',     'TAKEAWAY'),
    ('demo-D-03',  0, 'demo-card-D', 1250, 1168, 0,   'Maestro',     'INHOUSE'),

    -- ────────── Cash (card_hash NULL) — cash_anonymous bucket for NVR D-19 ──────────
    ('demo-cash-01', 5, null,  800,  748, 0, 'Bar', 'TAKEAWAY'),
    ('demo-cash-02', 2, null, 1100, 1028, 0, 'Bar', 'INHOUSE'),
    ('demo-cash-03', 0, null,  950,  888, 0, 'Bar', 'TAKEAWAY')
  ) as v(source_tx_id, days_ago, card_hash, gross_cents, net_cents, tip_cents, payment_method, sales_type)
)
insert into public.transactions (
  restaurant_id,
  source_tx_id,
  occurred_at,
  card_hash,
  gross_cents,
  net_cents,
  tip_cents,
  payment_method,
  sales_type
)
select
  restaurant_id,
  source_tx_id,
  occurred_at,
  card_hash,
  gross_cents,
  net_cents,
  tip_cents,
  payment_method,
  sales_type
from seed;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Sanity assertion — catch shape regressions at seed time.
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  tx_count       int;
  distinct_cards int;
  cash_rows      int;
begin
  select count(*),
         count(distinct card_hash) filter (where card_hash is not null),
         count(*) filter (where card_hash is null)
    into tx_count, distinct_cards, cash_rows
  from public.transactions
  where restaurant_id = 'ba1bf707-aae9-46a9-8166-4b6459e6c2fd'
    and source_tx_id like 'demo-%';

  if tx_count < 60 then
    raise exception 'seed-demo-data: expected >= 60 demo rows, got %', tx_count;
  end if;
  if distinct_cards < 4 then
    raise exception 'seed-demo-data: expected >= 4 distinct card_hash cohorts, got %', distinct_cards;
  end if;
  if cash_rows < 1 then
    raise exception 'seed-demo-data: expected >= 1 cash (card_hash NULL) row for NVR tie-out, got %', cash_rows;
  end if;

  raise notice 'seed-demo-data OK — tx_count=% distinct_cards=% cash_rows=%',
    tx_count, distinct_cards, cash_rows;
end $$;

commit;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. (Caller responsibility) refresh the materialized views so cohort_mv +
--    kpi_daily_mv pick up the new rows. Run as a separate statement after
--    this file commits:
--
--      select public.refresh_analytics_mvs();
--
--    The refresh function is SECURITY DEFINER (see migration 0013) and can
--    be called as postgres / service_role.
-- ────────────────────────────────────────────────────────────────────────────

-- ============================================================================
-- Phase 10 seed extensions: 90-day history + menu items + cash rows
-- Source: .planning/phases/10-charts/10-RESEARCH.md §Existing Seed/Fixture Data Gaps
-- Goals (per RESEARCH Concerns #3):
--   - ≥5 weekly cohorts with cohort_size_week ≥ SPARSE_MIN_COHORT_SIZE(=5)
--   - ≥15 cash (card_hash NULL) rows spread across 10+ distinct dates
--   - stg_orderbird_order_items seeded with 8 real menu items + 3 "Other" fillers
--     so VA-08 calendar items chart + top-8 rollup have material to render.
-- Idempotency: new rows use 'demo-phase10-' prefix. The guarded DELETE at the
-- top of this file (`source_tx_id like 'demo-%'`) already wipes them on re-run.
-- Belt-and-suspenders: `on conflict do nothing` on every INSERT.
-- Literal tenant UUID is reused throughout — the restaurants table has no slug.
-- ============================================================================

begin;

-- Phase 10 scoped delete for the staging-items mirror (transactions are already
-- wiped by the `demo-%` delete at line 37; order-items needs its own cleanup
-- because its natural key is invoice_number, not source_tx_id).
delete from public.stg_orderbird_order_items
where restaurant_id = 'ba1bf707-aae9-46a9-8166-4b6459e6c2fd'
  and invoice_number like 'demo-phase10-%';

-- 1. Extend transactions to 90-day history.
-- Source-tx-ids prefixed 'demo-phase10-' so existing guarded delete handles re-runs.
-- Cohort structure: 25 distinct card_hash values (g % 25), first visit keyed off g.
-- Over 76 days (g=15..90), each card appears ~3x → enough to populate ≥5 weekly
-- cohorts above the SPARSE_MIN_COHORT_SIZE=5 threshold.
insert into public.transactions (
  restaurant_id, source_tx_id, occurred_at,
  gross_cents, net_cents, tip_cents,
  card_hash, sales_type, payment_method
)
select
  'ba1bf707-aae9-46a9-8166-4b6459e6c2fd'::uuid,
  'demo-phase10-tx-' || g,
  now() - (g || ' days')::interval,
  (1000 + (g % 3) * 500)::int                                         as gross_cents,
  ((1000 + (g % 3) * 500) * 0.935)::int                               as net_cents,
  0                                                                   as tip_cents,
  case when g % 7 = 0 then null else 'demo-phase10-card-' || (g % 25) end,
  case when g % 3 = 0 then 'TAKEAWAY' else 'INHOUSE' end              as sales_type,
  case when g % 7 = 0 then 'Bar' else 'Visa' end                      as payment_method
from generate_series(15, 90) g
on conflict (restaurant_id, source_tx_id) do nothing;

-- 2. Add 15 cash rows distributed across 10+ distinct dates (g*5 spreads them
-- through the 90-day window). Drives the 9th "cash" segment in VA-04/05 stacks.
insert into public.transactions (
  restaurant_id, source_tx_id, occurred_at,
  gross_cents, net_cents, tip_cents,
  card_hash, sales_type, payment_method
)
select
  'ba1bf707-aae9-46a9-8166-4b6459e6c2fd'::uuid,
  'demo-phase10-cash-' || g,
  now() - (g * 5 || ' days')::interval,
  (700 + g * 50)::int                                                 as gross_cents,
  ((700 + g * 50) * 0.935)::int                                       as net_cents,
  0                                                                   as tip_cents,
  null                                                                as card_hash,
  'INHOUSE'                                                           as sales_type,
  'Bar'                                                               as payment_method
from generate_series(1, 15) g
on conflict (restaurant_id, source_tx_id) do nothing;

-- 3. Seed stg_orderbird_order_items — one row per phase10 transaction.
-- Menu: 8 real items (first 8) + 3 fillers (Coke/Water/Tea) that fall into the
-- top-8 + "Other" rollup. item_name selected by stable hash of source_tx_id.
-- Schema per migration 0007: restaurant_id + invoice_number + row_index is PK,
-- all other columns are text. row_index=1 since each transaction seeds exactly
-- one item line. vat 7 for food (indices 0..4), 19 for drinks/dessert (5..10).
insert into public.stg_orderbird_order_items (
  restaurant_id, invoice_number, row_index,
  item_name, tax_rate_pct, sales_type,
  item_gross_amount_eur, quantity, source_file
)
select
  t.restaurant_id,
  t.source_tx_id                                                      as invoice_number,
  1                                                                   as row_index,
  (array[
     'Tonkotsu Ramen','Miso Ramen','Shoyu Ramen','Gyoza','Edamame',
     'Matcha Ice Cream','Beer','Sake','Coke','Water','Tea'
   ])[1 + (abs(hashtext(t.source_tx_id)) % 11)]                       as item_name,
  case
    when (abs(hashtext(t.source_tx_id)) % 11) in (0,1,2,3,4) then '7'
    else '19'
  end                                                                 as tax_rate_pct,
  t.sales_type,
  round(t.gross_cents::numeric / 100, 2)::text                        as item_gross_amount_eur,
  '1'                                                                 as quantity,
  'seed-phase10'                                                      as source_file
from public.transactions t
where t.restaurant_id = 'ba1bf707-aae9-46a9-8166-4b6459e6c2fd'::uuid
  and t.source_tx_id like 'demo-phase10-%'
on conflict (restaurant_id, invoice_number, row_index) do nothing;

-- Sanity assertion for Phase 10 seed extensions.
do $$
declare
  tx_count     int;
  cash_count   int;
  item_count   int;
  distinct_items int;
begin
  select count(*) into tx_count
    from public.transactions
   where restaurant_id = 'ba1bf707-aae9-46a9-8166-4b6459e6c2fd'
     and source_tx_id like 'demo-phase10-%';

  select count(*) into cash_count
    from public.transactions
   where restaurant_id = 'ba1bf707-aae9-46a9-8166-4b6459e6c2fd'
     and source_tx_id like 'demo-phase10-cash-%';

  select count(*), count(distinct item_name) into item_count, distinct_items
    from public.stg_orderbird_order_items
   where restaurant_id = 'ba1bf707-aae9-46a9-8166-4b6459e6c2fd'
     and invoice_number like 'demo-phase10-%';

  if tx_count < 75 then
    raise exception 'seed-demo-data phase10: expected >= 75 tx rows, got %', tx_count;
  end if;
  if cash_count < 15 then
    raise exception 'seed-demo-data phase10: expected >= 15 cash rows, got %', cash_count;
  end if;
  if item_count < 75 then
    raise exception 'seed-demo-data phase10: expected >= 75 order-item rows, got %', item_count;
  end if;
  if distinct_items < 8 then
    raise exception 'seed-demo-data phase10: expected >= 8 distinct item_name values, got %', distinct_items;
  end if;

  raise notice 'seed-demo-data phase10 OK — tx=% cash=% items=% distinct_items=%',
    tx_count, cash_count, item_count, distinct_items;
end $$;

commit;
