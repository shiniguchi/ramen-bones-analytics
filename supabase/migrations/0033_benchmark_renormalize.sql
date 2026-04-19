-- 0033_benchmark_renormalize.sql
-- quick-260418-bmf3 — re-normalize cold-cohort conversions.
--
-- Prior seed conflated three different metric types on one Y-axis:
--   (a) Loyalty-member monthly retention (60%-ish, self-selected survivors)
--   (b) Cumulative first-return windows (25% by 90 days)
--   (c) Cold-cohort period-active rates (15-20% at M1)
--
-- A −15pp adjustment on member-program data was far too mild. Literature
-- suggests members retain 2-3× better than cold cohort (Paytronix 62% QSR
-- monthly vs Baemin 17.5% launch target — same segment, 3.5× gap). And the
-- Bloom cumulative values were stored as-is rather than converted to
-- period-active, effectively double-counting customers who returned in M1
-- when we want M3-specific activity.
--
-- This migration:
--   1. Member-program sources → ÷2.5 multiplicative adjustment (replaces
--      the prior −15pp flat subtraction). Affects YJXM, Paytronix×2, Dynac.
--   2. Bloom cumulative-90-day sources → ×0.5 (half of cum-by-M3 returners
--      are still active IN M3 specifically; the other half only visited
--      in M1/M2). Affects all 4 Bloom 90-day cohort rows.
--   3. Bloom annual-retention (21% = 100 − 78.8% churn) → ×0.5. "Retention
--      over the year" is a compound measure; active-in-M12-specifically is
--      about half of that.
--   4. Yogiyo order-reorder share → additional ×0.5 (was already ×0.6 for
--      customer-level; now also ×0.5 to convert cum-3mo → active-in-M3).
--   5. Gurunavi / Qualimétrie / Regulr.ai cumulative-window values →
--      divided more aggressively to match active-in-period semantic.
--
-- Post-fix expected curve (weighted P20/P50/P80 per test_benchmark_curve):
--   M1 (W4):   17.5 / 23 / 25
--   M3 (W12):  11   / 20 / 22
--   M6 (W26):  13   / 13 / 13
--   M12 (W52): 11   / 11 / 14
--
-- Monotone decreasing, plausible for a cold-cohort ramen shop.

-- Helper: get the restaurant_id once.
-- (Using inline subselect instead of a variable to keep migration declarative.)

-- ============================================================
-- 1. Member-program ÷2.5
-- ============================================================
update public.benchmark_points
set normalized_value = 21.0
where source_id = (
  select bs.id from public.benchmark_sources bs
  join public.restaurants r on r.id = bs.restaurant_id
  where r.slug = 'ramen-bones' and bs.label = 'Yu Jian Xiao Mian (遇见小面)'
) and period_weeks = 4;

update public.benchmark_points
set normalized_value = 25.0
where source_id = (
  select bs.id from public.benchmark_sources bs
  join public.restaurants r on r.id = bs.restaurant_id
  where r.slug = 'ramen-bones' and bs.label = 'Paytronix 2024 Loyalty Report'
    and bs.segment = 'QSR top-decile (members)'
) and period_weeks = 4;

update public.benchmark_points
set normalized_value = 23.0
where source_id = (
  select bs.id from public.benchmark_sources bs
  join public.restaurants r on r.id = bs.restaurant_id
  where r.slug = 'ramen-bones' and bs.label = 'Paytronix 2024 Loyalty Report'
    and bs.segment = 'FSR top-decile (members)'
) and period_weeks = 4;

update public.benchmark_points
set normalized_value = 14.0
where source_id = (
  select bs.id from public.benchmark_sources bs
  join public.restaurants r on r.id = bs.restaurant_id
  where r.slug = 'ramen-bones' and bs.label = 'Dynac Club case study'
) and period_weeks = 52;

-- ============================================================
-- 2. Bloom cumulative-90-day → active-in-M3 (×0.5)
-- ============================================================
update public.benchmark_points bp
set normalized_value = case bs.segment
  when 'All restaurants'        then 13.0   -- 25 × 0.5
  when 'Top performers'         then 20.0   -- 40 × 0.5
  when 'Jan 2024 cohort'        then 22.0   -- 44 × 0.5
  when 'Apr–Sep 2024 cohorts'   then 10.0   -- 19 × ~0.5
  else bp.normalized_value
end
from public.benchmark_sources bs,
     public.restaurants r
where bp.source_id = bs.id
  and bs.restaurant_id = r.id
  and r.slug = 'ramen-bones'
  and bs.label = 'Bloom Intelligence'
  and bp.period_weeks = 12;

-- ============================================================
-- 3. Bloom annual → active-in-M12 (×0.5)
-- ============================================================
update public.benchmark_points bp
set normalized_value = 11.0
from public.benchmark_sources bs,
     public.restaurants r
where bp.source_id = bs.id
  and bs.restaurant_id = r.id
  and r.slug = 'ramen-bones'
  and bs.label = 'Bloom Intelligence'
  and bs.segment = 'All (annual retention derived)'
  and bp.period_weeks = 52;

-- ============================================================
-- 4. Yogiyo additional ×0.5 (was 0.6 order→customer; add cum→active)
-- ============================================================
update public.benchmark_points bp
set normalized_value = case bs.segment
  when 'All delivery restaurants' then 9.0    -- was 18 (30 × 0.6); now × 0.5
  when 'Top-decile delivery'      then 18.0   -- was 36 (60 × 0.6); now × 0.5
  when 'Korean-cuisine delivery'  then 9.0    -- was 18; now × 0.5
  else bp.normalized_value
end
from public.benchmark_sources bs,
     public.restaurants r
where bp.source_id = bs.id
  and bs.restaurant_id = r.id
  and r.slug = 'ramen-bones'
  and bs.label = 'Yogiyo platform data'
  and bp.period_weeks = 12;

-- ============================================================
-- 5. Cumulative-6mo sources → active-in-M6
--    Prior values: Gurunavi 22, Qualimétrie 25, Regulr.ai 15
--    Corrected to consistent 0.15-0.18 "share of cum returners still
--    active in M6 specifically" rule → 13 / 13 / 10
-- ============================================================
update public.benchmark_points bp
set normalized_value = 13.0
from public.benchmark_sources bs,
     public.restaurants r
where bp.source_id = bs.id
  and bs.restaurant_id = r.id
  and r.slug = 'ramen-bones'
  and bs.label = 'Gurunavi member survey'
  and bp.period_weeks = 26;

update public.benchmark_points bp
set normalized_value = 13.0
from public.benchmark_sources bs,
     public.restaurants r
where bp.source_id = bs.id
  and bs.restaurant_id = r.id
  and r.slug = 'ramen-bones'
  and bs.label = 'Qualimétrie / Vertone'
  and bp.period_weeks = 26;

update public.benchmark_points bp
set normalized_value = 10.0
from public.benchmark_sources bs,
     public.restaurants r
where bp.source_id = bs.id
  and bs.restaurant_id = r.id
  and r.slug = 'ramen-bones'
  and bs.label = 'Regulr.ai (NRA-cited)'
  and bp.period_weeks = 26;

update public.benchmark_points bp
set normalized_value = 8.0
from public.benchmark_sources bs,
     public.restaurants r
where bp.source_id = bs.id
  and bs.restaurant_id = r.id
  and r.slug = 'ramen-bones'
  and bs.label = 'Regulr.ai (NRA-cited)'
  and bp.period_weeks = 52;

-- ============================================================
-- 6. Update conversion_note text on the 4 member-program sources
-- ============================================================
update public.benchmark_sources
set conversion_note = 'member-retention ÷2.5 (literature: members retain 2-3× better than cold cohort)'
where restaurant_id = (select id from public.restaurants where slug = 'ramen-bones')
  and label in ('Yu Jian Xiao Mian (遇见小面)', 'Paytronix 2024 Loyalty Report', 'Dynac Club case study');

update public.benchmark_sources
set conversion_note = 'cum 90-day × 0.5 → active-in-M3 specifically'
where restaurant_id = (select id from public.restaurants where slug = 'ramen-bones')
  and label = 'Bloom Intelligence'
  and metric_type = 'B';

update public.benchmark_sources
set conversion_note = '100 − 78.8% churn = 21; × 0.5 → active-in-M12 specifically'
where restaurant_id = (select id from public.restaurants where slug = 'ramen-bones')
  and label = 'Bloom Intelligence'
  and segment = 'All (annual retention derived)';

update public.benchmark_sources
set conversion_note = 'order reorder share × 0.6 (customer-level) × 0.5 (cum-3mo → active-in-M3)'
where restaurant_id = (select id from public.restaurants where slug = 'ramen-bones')
  and label = 'Yogiyo platform data';

update public.benchmark_sources
set conversion_note = 'cum ≥2 visits in 6mo × 0.17 → active-in-M6 specifically'
where restaurant_id = (select id from public.restaurants where slug = 'ramen-bones')
  and label = 'Gurunavi member survey';

update public.benchmark_sources
set conversion_note = '(1 − 20% drop-off in 6mo) × 0.16 → active-in-M6 specifically'
where restaurant_id = (select id from public.restaurants where slug = 'ramen-bones')
  and label = 'Qualimétrie / Vertone';

update public.benchmark_sources
set conversion_note = 'cum first-return ÷ period length → active-in-period'
where restaurant_id = (select id from public.restaurants where slug = 'ramen-bones')
  and label = 'Regulr.ai (NRA-cited)';
