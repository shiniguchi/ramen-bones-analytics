-- 0032_benchmark_drop_w1_anchor.sql
-- quick-260418-bmf2 — remove the W1 anchor from Regulr.ai.
--
-- Why: the W1 data point (18% cumulative first-return by end of week 1) uses
-- a different methodology than our W4/W12/W26/W52 anchors (monthly or
-- cumulative-by-month retention). Mixing these on one Y-axis produced a
-- nonsensical upward step from W1=18% → W4=38% — retention can't increase.
--
-- The Regulr.ai SOURCE is kept (still contributes at W26 and W52); only its
-- W1 point is removed. This:
--   1. Restores monotone-decreasing shape to the north-star curve
--   2. Makes the Lin/Log interpolation toggle visually meaningful (the big
--      interpolated gap is now W0=100% → W4=38%, where linear vs log-linear
--      differ by 6-10pp at W1 — clearly visible)
--
-- Idempotent: DELETE is a no-op if the row is already gone.

delete from public.benchmark_points
where period_weeks = 1
  and source_id in (
    select bs.id
    from public.benchmark_sources bs
    join public.restaurants r on r.id = bs.restaurant_id
    where r.slug = 'ramen-bones'
      and bs.label = 'Regulr.ai (NRA-cited)'
  );
