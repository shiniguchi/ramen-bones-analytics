-- scripts/seed-recent-transactions.sql
-- Phase 05-09 / Gap 3 closure: seed DEV with ≥50 synthetic transactions across the
-- last 14 business_days so the generate-insight Edge Function has non-zero numbers
-- to feed Haiku (April 2026 Worldline blackout leaves DEV empty — see 02-04-REAL-RUN.md).
--
-- CONTRACT
--   * Targets restaurant ba1bf707-aae9-46a9-8166-4b6459e6c2fd ONLY.
--   * Touches ONLY rows whose source_tx_id starts with 'demo-recent-' — real ingested
--     data AND 05-03's 'demo-*' smoke seed are untouched (different namespace).
--   * Idempotent: ON CONFLICT (restaurant_id, source_tx_id) DO NOTHING. Reruns are safe.
--   * Uses `now() - interval 'N days'` for occurred_at so every run is "recent" relative
--     to wall-clock — kpi_daily_v windows (today / 7d / 30d) stay populated.
--
-- USAGE
--   psql "$SUPABASE_DB_URL" -f scripts/seed-recent-transactions.sql
--   -- then refresh the MVs:
--   psql "$SUPABASE_DB_URL" -c "select public.refresh_analytics_mvs();"
--
-- SCHEMA NOTES
--   transactions has NO business_date column — business_date is derived in kpi_daily_mv
--   via (occurred_at at time zone r.timezone)::date. We therefore stagger occurred_at
--   across the last 14 days and let the MV bucket them.
--   Columns (per 0003 + 0008): restaurant_id, source_tx_id, occurred_at, card_hash,
--   gross_cents (NOT NULL), net_cents (NOT NULL), tip_cents, payment_method, sales_type.

begin;

-- ────────────────────────────────────────────────────────────────────────────
-- Seed: 14 days × ~5 rows/day = 70 rows, 8 distinct card_hash values + cash.
-- Cohort shape:
--   * 4 cards first-visit in week -2 (days 13..7): A, B, C, D
--   * 4 cards first-visit in week -1 (days 6..0):  E, F, G, H
--   * Several cards make repeat visits so retention/LTV/frequency are non-zero
--   * ~30% cash rows (card_hash NULL) for NVR cash_anonymous bucket
-- ────────────────────────────────────────────────────────────────────────────
with seed(source_suffix, days_ago, card_letter, gross_cents, tip_cents, payment_method, sales_type) as (
  values
  -- Week -2 (days 13..7) — cards A,B,C,D first appear here
  ('A-13', 13, 'A', 2400, 100, 'Visa',        'INHOUSE'),
  ('B-13', 13, 'B', 1800,   0, 'MasterCard',  'INHOUSE'),
  ('I-13', 13, NULL, 1500,  0, 'Bar',         'INHOUSE'),  -- cash
  ('A-12', 12, 'A', 2100, 200, 'Visa',        'INHOUSE'),
  ('C-12', 12, 'C', 2700, 100, 'Visa',        'TAKEAWAY'),
  ('D-12', 12, 'D', 1650,   0, 'Maestro',     'INHOUSE'),
  ('B-11', 11, 'B', 2250, 150, 'MasterCard',  'INHOUSE'),
  ('C-11', 11, 'C', 1950,  50, 'Visa',        'INHOUSE'),
  ('I-11', 11, NULL, 1100,  0, 'Bar',         'TAKEAWAY'), -- cash
  ('A-10', 10, 'A', 2850, 250, 'Visa',        'INHOUSE'),
  ('D-10', 10, 'D', 1400,   0, 'Maestro',     'TAKEAWAY'),
  ('B-10', 10, 'B', 2550, 200, 'MasterCard',  'INHOUSE'),
  ('C-09',  9, 'C', 2300, 100, 'Visa',        'INHOUSE'),
  ('I-09',  9, NULL, 1650,  0, 'Bar',         'INHOUSE'),  -- cash
  ('A-09',  9, 'A', 3100, 300, 'Visa',        'INHOUSE'),
  ('B-08',  8, 'B', 1950, 100, 'MasterCard',  'TAKEAWAY'),
  ('D-08',  8, 'D', 1750,   0, 'Maestro',     'INHOUSE'),
  ('A-08',  8, 'A', 2650, 200, 'Visa',        'INHOUSE'),
  ('C-07',  7, 'C', 2200, 100, 'Visa',        'INHOUSE'),
  ('I-07',  7, NULL, 1250,  0, 'Bar',         'TAKEAWAY'), -- cash
  ('B-07',  7, 'B', 2400, 200, 'MasterCard',  'INHOUSE'),
  -- Week -1 (days 6..0) — cards E,F,G,H first appear here + returners from A-D
  ('E-06',  6, 'E', 2900, 300, 'MasterCard',  'INHOUSE'),
  ('F-06',  6, 'F', 1850, 100, 'Visa',        'INHOUSE'),
  ('A-06',  6, 'A', 2450, 200, 'Visa',        'INHOUSE'),  -- A returns
  ('I-06',  6, NULL, 1450,  0, 'Bar',         'INHOUSE'),  -- cash
  ('G-05',  5, 'G', 2100, 100, 'Visa',        'TAKEAWAY'),
  ('E-05',  5, 'E', 3200, 300, 'MasterCard',  'INHOUSE'),
  ('H-05',  5, 'H', 1550,   0, 'Maestro',     'INHOUSE'),
  ('B-05',  5, 'B', 2150, 150, 'MasterCard',  'INHOUSE'),  -- B returns
  ('F-04',  4, 'F', 1950, 100, 'Visa',        'INHOUSE'),
  ('I-04',  4, NULL, 1350,  0, 'Bar',         'TAKEAWAY'), -- cash
  ('G-04',  4, 'G', 2300, 200, 'Visa',        'INHOUSE'),
  ('C-04',  4, 'C', 2050, 100, 'Visa',        'INHOUSE'),  -- C returns
  ('E-03',  3, 'E', 3350, 350, 'MasterCard',  'INHOUSE'),
  ('H-03',  3, 'H', 1700,   0, 'Maestro',     'TAKEAWAY'),
  ('A-03',  3, 'A', 2750, 250, 'Visa',        'INHOUSE'),  -- A returns again
  ('F-03',  3, 'F', 2050, 100, 'Visa',        'INHOUSE'),
  ('I-02',  2, NULL, 1200,  0, 'Bar',         'INHOUSE'),  -- cash
  ('G-02',  2, 'G', 2400, 200, 'Visa',        'INHOUSE'),
  ('B-02',  2, 'B', 2650, 250, 'MasterCard',  'INHOUSE'),  -- B returns
  ('D-02',  2, 'D', 1850,  50, 'Maestro',     'INHOUSE'),  -- D returns
  ('E-01',  1, 'E', 3450, 400, 'MasterCard',  'INHOUSE'),
  ('H-01',  1, 'H', 1800, 100, 'Maestro',     'INHOUSE'),
  ('A-01',  1, 'A', 2950, 300, 'Visa',        'INHOUSE'),  -- A returns
  ('F-01',  1, 'F', 2150, 150, 'Visa',        'TAKEAWAY'),
  ('I-01',  1, NULL, 1550,  0, 'Bar',         'INHOUSE'),  -- cash
  ('G-00',  0, 'G', 2550, 250, 'Visa',        'INHOUSE'),
  ('E-00',  0, 'E', 3600, 400, 'MasterCard',  'INHOUSE'),
  ('H-00',  0, 'H', 1950, 100, 'Maestro',     'INHOUSE'),
  ('C-00',  0, 'C', 2250, 150, 'Visa',        'INHOUSE'),  -- C returns
  ('B-00',  0, 'B', 2850, 300, 'MasterCard',  'INHOUSE'),  -- B returns
  ('I-00',  0, NULL, 1650,  0, 'Bar',         'TAKEAWAY'), -- cash
  ('A-00',  0, 'A', 3250, 350, 'Visa',        'INHOUSE'),  -- A returns
  ('F-00',  0, 'F', 2250, 200, 'Visa',        'INHOUSE')
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
  'ba1bf707-aae9-46a9-8166-4b6459e6c2fd'::uuid,
  'demo-recent-' || source_suffix,
  -- Spread occurred_at across lunch (12:30) / dinner (19:30) by parity so
  -- kpi_daily windows get multiple rows per day at plausible times.
  (now() - (days_ago || ' days')::interval
         - (case when (days_ago % 2) = 0 then interval '4 hours 30 minutes'
                 else interval '11 hours 30 minutes' end))::timestamptz,
  case
    when card_letter is null then null
    else encode(sha256(('demo-recent-card-' || card_letter)::bytea), 'hex')
  end,
  gross_cents,
  round(gross_cents / 1.07)::int,
  tip_cents,
  payment_method,
  sales_type
from seed
on conflict (restaurant_id, source_tx_id) do nothing;

-- ────────────────────────────────────────────────────────────────────────────
-- Sanity assertion — catch shape regressions at seed time.
-- Must: ≥50 total rows, ≥6 distinct non-null card_hash, ≥14 days covered.
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  r_total     int;
  r_cards     int;
  r_days      int;
  r_cash      int;
begin
  select
    count(*),
    count(distinct card_hash) filter (where card_hash is not null),
    count(distinct (occurred_at at time zone 'Europe/Berlin')::date),
    count(*) filter (where card_hash is null)
  into r_total, r_cards, r_days, r_cash
  from public.transactions
  where restaurant_id = 'ba1bf707-aae9-46a9-8166-4b6459e6c2fd'
    and source_tx_id like 'demo-recent-%';

  if r_total < 50 then
    raise exception 'seed-recent: expected >= 50 rows, got %', r_total;
  end if;
  if r_cards < 6 then
    raise exception 'seed-recent: expected >= 6 distinct card_hash, got %', r_cards;
  end if;
  if r_days < 14 then
    raise exception 'seed-recent: expected >= 14 business_days covered, got %', r_days;
  end if;

  raise notice 'seed-recent OK — total=% unique_cards=% days_covered=% cash_rows=%',
    r_total, r_cards, r_days, r_cash;
end $$;

commit;

-- VERIFY: run these after the INSERT to confirm seed shape
-- select count(*) as total,
--        count(distinct card_hash) filter (where card_hash is not null) as unique_cards,
--        count(distinct (occurred_at at time zone 'Europe/Berlin')::date) as days_covered
-- from public.transactions
-- where source_tx_id like 'demo-recent-%';
--
-- select (occurred_at at time zone 'Europe/Berlin')::date as business_date,
--        count(*), sum(gross_cents) as revenue_cents
-- from public.transactions
-- where source_tx_id like 'demo-recent-%'
-- group by 1
-- order by 1 desc;
--
-- -- caller must refresh MVs:
-- select public.refresh_analytics_mvs();
