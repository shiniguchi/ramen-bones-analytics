-- 0031_benchmark_seed.sql
-- North-star retention curve — seed 18 curated sources for 'ramen-bones' tenant
-- (quick-260418-bm2). Companion to 0030_benchmark_schema.sql.
--
-- Each source was selected during cross-language research (JP/US/KR/CN/FR/DE/TW).
-- normalized_value applies the conversion rules documented in conversion_note:
--   Type B (cumulative first-return) → period-active: divide by period count
--   Type C (loyalty member repurchase) → cold-cohort: subtract 15pp
--   Type D (order-level reorder share) → customer-level: multiply by 0.6
--   Type E (drop-off rate) → cum retention via 1 − drop-off, then → period-active
--   Type A (direct cohort active-in-period) → no conversion
--
-- Anchor periods (in weeks): W1, W4 (=M1), W12 (=M3), W26 (=M6), W52 (=M12).
-- 20 data points across 18 sources.
--
-- Idempotent: re-running after a prior partial seed is a no-op if any rows
-- exist for ramen-bones (delete + re-seed via ON DELETE CASCADE would be
-- destructive; operators should delete + re-apply manually if rewriting).

do $$
declare
  v_rid uuid;
  v_already_seeded int;
  v_bloom_all bigint; v_bloom_top bigint; v_bloom_jan bigint; v_bloom_sep bigint;
  v_bloom_ann bigint; v_yogiyo_all bigint; v_yogiyo_top bigint; v_yogiyo_kr bigint;
  v_yjxm bigint; v_paytronix_qsr bigint; v_paytronix_fsr bigint; v_gurunavi bigint;
  v_qualimetrie bigint; v_baemin_launch bigint; v_baemin_m3 bigint; v_cn_smb bigint;
  v_dynac bigint; v_regulr bigint;
begin
  select id into v_rid from public.restaurants where slug = 'ramen-bones';
  if v_rid is null then
    raise exception 'seed aborted: restaurant with slug ''ramen-bones'' not found — ensure 0030 ran first';
  end if;

  select count(*) into v_already_seeded
  from public.benchmark_sources where restaurant_id = v_rid;
  if v_already_seeded > 0 then
    raise notice 'seed skipped: % existing benchmark_sources rows for ramen-bones', v_already_seeded;
    return;
  end if;

  -- ============================================================
  -- Sources (18)
  -- ============================================================
  insert into public.benchmark_sources
    (restaurant_id, label, country, segment, credibility, cuisine_match, metric_type, conversion_note, sample_size, year, url)
  values
    (v_rid, 'Bloom Intelligence', 'US', 'All restaurants', 'HIGH', 1.0, 'B',
     'cum 90-day first-return → period-active', 'Millions of profiles', 2025,
     'https://bloomintelligence.com/blog/state-of-restaurant-guest-retention-2025/')
  returning id into v_bloom_all;

  insert into public.benchmark_sources
    (restaurant_id, label, country, segment, credibility, cuisine_match, metric_type, conversion_note, sample_size, year, url)
  values
    (v_rid, 'Bloom Intelligence', 'US', 'Top performers', 'HIGH', 1.0, 'B',
     'cum 90-day first-return → period-active', 'Millions of profiles', 2025,
     'https://bloomintelligence.com/blog/state-of-restaurant-guest-retention-2025/')
  returning id into v_bloom_top;

  insert into public.benchmark_sources
    (restaurant_id, label, country, segment, credibility, cuisine_match, metric_type, conversion_note, sample_size, year, url)
  values
    (v_rid, 'Bloom Intelligence', 'US', 'Jan 2024 cohort', 'HIGH', 1.0, 'B',
     'cum 90-day first-return → period-active', 'Millions of profiles', 2025,
     'https://bloomintelligence.com/blog/state-of-restaurant-guest-retention-2025/')
  returning id into v_bloom_jan;

  insert into public.benchmark_sources
    (restaurant_id, label, country, segment, credibility, cuisine_match, metric_type, conversion_note, sample_size, year, url)
  values
    (v_rid, 'Bloom Intelligence', 'US', 'Apr–Sep 2024 cohorts', 'HIGH', 1.0, 'B',
     'cum 90-day first-return → period-active', 'Millions of profiles', 2025,
     'https://bloomintelligence.com/blog/state-of-restaurant-guest-retention-2025/')
  returning id into v_bloom_sep;

  insert into public.benchmark_sources
    (restaurant_id, label, country, segment, credibility, cuisine_match, metric_type, conversion_note, sample_size, year, url)
  values
    (v_rid, 'Bloom Intelligence', 'US', 'All (annual retention derived)', 'HIGH', 1.0, 'A',
     '100% − 78.8% annual churn', 'Millions of profiles', 2025,
     'https://bloomintelligence.com/blog/state-of-restaurant-guest-retention-2025/')
  returning id into v_bloom_ann;

  insert into public.benchmark_sources
    (restaurant_id, label, country, segment, credibility, cuisine_match, metric_type, conversion_note, sample_size, year, url)
  values
    (v_rid, 'Yogiyo platform data', 'KR', 'All delivery restaurants', 'HIGH', 1.1, 'D',
     'order reorder share × 0.6 (customer-level)', 'Platform-wide (≥10 orders/mo)', 2023,
     'https://partner.yogiyo.co.kr/content/view/%EC%9A%94%EA%B8%B0%EC%9A%94%EB%8D%B0%EC%9D%B4%ED%84%B0_%EC%9E%AC%EC%A3%BC%EB%AC%B8')
  returning id into v_yogiyo_all;

  insert into public.benchmark_sources
    (restaurant_id, label, country, segment, credibility, cuisine_match, metric_type, conversion_note, sample_size, year, url)
  values
    (v_rid, 'Yogiyo platform data', 'KR', 'Top-decile delivery', 'HIGH', 1.1, 'D',
     'order reorder share × 0.6 (customer-level)', 'Platform-wide (≥10 orders/mo)', 2023,
     'https://partner.yogiyo.co.kr/content/view/%EC%9A%94%EA%B8%B0%EC%9A%94%EB%8D%B0%EC%9D%B4%ED%84%B0_%EC%9E%AC%EC%A3%BC%EB%AC%B8')
  returning id into v_yogiyo_top;

  insert into public.benchmark_sources
    (restaurant_id, label, country, segment, credibility, cuisine_match, metric_type, conversion_note, sample_size, year, url)
  values
    (v_rid, 'Yogiyo platform data', 'KR', 'Korean-cuisine delivery', 'HIGH', 1.1, 'D',
     'order reorder share × 0.6 (customer-level)', 'Platform-wide (≥10 orders/mo)', 2023,
     'https://partner.yogiyo.co.kr/content/view/%EC%9A%94%EA%B8%B0%EC%9A%94%EB%8D%B0%EC%9D%B4%ED%84%B0_%EC%9E%AC%EC%A3%BC%EB%AC%B8')
  returning id into v_yogiyo_kr;

  insert into public.benchmark_sources
    (restaurant_id, label, country, segment, credibility, cuisine_match, metric_type, conversion_note, sample_size, year, url)
  values
    (v_rid, 'Yu Jian Xiao Mian (遇见小面)', 'CN', 'Noodle chain (members)', 'MEDIUM', 1.5, 'C',
     'member-adjusted −15pp for cold-cohort parity', 'Chain-wide members', 2022,
     'https://zhuanlan.zhihu.com/p/490156572')
  returning id into v_yjxm;

  insert into public.benchmark_sources
    (restaurant_id, label, country, segment, credibility, cuisine_match, metric_type, conversion_note, sample_size, year, url)
  values
    (v_rid, 'Paytronix 2024 Loyalty Report', 'US', 'QSR top-decile (members)', 'HIGH', 1.2, 'C',
     'member-adjusted −15pp for cold-cohort parity', 'Multi-brand loyalty', 2024,
     'https://www.paytronix.com/company/news-press/press-releases/paytronix-loyalty-trends-report-top-operators-drive-up-to-37-of-transactions-via-loyalty-members')
  returning id into v_paytronix_qsr;

  insert into public.benchmark_sources
    (restaurant_id, label, country, segment, credibility, cuisine_match, metric_type, conversion_note, sample_size, year, url)
  values
    (v_rid, 'Paytronix 2024 Loyalty Report', 'US', 'FSR top-decile (members)', 'HIGH', 1.0, 'C',
     'member-adjusted −15pp for cold-cohort parity', 'Multi-brand loyalty', 2024,
     'https://www.paytronix.com/company/news-press/press-releases/paytronix-loyalty-trends-report-top-operators-drive-up-to-37-of-transactions-via-loyalty-members')
  returning id into v_paytronix_fsr;

  insert into public.benchmark_sources
    (restaurant_id, label, country, segment, credibility, cuisine_match, metric_type, conversion_note, sample_size, year, url)
  values
    (v_rid, 'Gurunavi member survey', 'JP', 'All restaurants', 'HIGH', 1.2, 'B',
     'cum ≥2 visits to same restaurant in 6mo → period-active', '1,996 adults 20–69', 2024,
     'https://pro.gnavi.co.jp/magazine/t_res/cat_3/a_4289/')
  returning id into v_gurunavi;

  insert into public.benchmark_sources
    (restaurant_id, label, country, segment, credibility, cuisine_match, metric_type, conversion_note, sample_size, year, url)
  values
    (v_rid, 'Qualimétrie / Vertone', 'FR', 'All restaurants', 'MEDIUM', 1.0, 'E',
     '1 − drop-off (20% in 6mo) → cum retention → period-active', '1,000 French adults', 2020,
     'https://www.snacking.fr/actualites/4593-Les-habitudes-des-Francais-au-restaurant-en-15-chiffres-cles/')
  returning id into v_qualimetrie;

  insert into public.benchmark_sources
    (restaurant_id, label, country, segment, credibility, cuisine_match, metric_type, conversion_note, sample_size, year, url)
  values
    (v_rid, 'Baemin operator rule', 'KR', 'Delivery (launch target)', 'MEDIUM', 1.1, 'A',
     'direct (monthly reorder rate)', 'Industry rule of thumb', 2023,
     'https://ceo.baemin.com/')
  returning id into v_baemin_launch;

  insert into public.benchmark_sources
    (restaurant_id, label, country, segment, credibility, cuisine_match, metric_type, conversion_note, sample_size, year, url)
  values
    (v_rid, 'Baemin operator rule', 'KR', 'Delivery (healthy operator M3)', 'MEDIUM', 1.1, 'A',
     'direct (monthly reorder rate)', 'Industry rule of thumb', 2023,
     'https://ceo.baemin.com/')
  returning id into v_baemin_m3;

  insert into public.benchmark_sources
    (restaurant_id, label, country, segment, credibility, cuisine_match, metric_type, conversion_note, sample_size, year, url)
  values
    (v_rid, 'CN SMB industry consensus', 'CN', 'All SMB restaurants', 'MEDIUM', 1.0, 'C',
     'monthly repurchase rate (cold cohort, healthy band midpoint)', 'Multi-source consensus', 2024,
     'https://www.xinlingshou.com/contents/articles/43587.html')
  returning id into v_cn_smb;

  insert into public.benchmark_sources
    (restaurant_id, label, country, segment, credibility, cuisine_match, metric_type, conversion_note, sample_size, year, url)
  values
    (v_rid, 'Dynac Club case study', 'JP', 'Izakaya chain (members)', 'HIGH', 1.0, 'C',
     'member-adjusted −15pp for cold-cohort parity', '290k members', 2017,
     'https://www.inshokuten.com/foodist/article/4264/')
  returning id into v_dynac;

  insert into public.benchmark_sources
    (restaurant_id, label, country, segment, credibility, cuisine_match, metric_type, conversion_note, sample_size, year, url)
  values
    (v_rid, 'Regulr.ai (NRA-cited)', 'US', 'All', 'LOW', 1.0, 'B',
     'cum first-return → period-active; direct at W1', 'Not stated', 2024,
     'https://regulr.ai/for/restaurants')
  returning id into v_regulr;

  -- ============================================================
  -- Data points (20). Unit = weeks (M1=4, M3=12, M6=26, M12=52).
  -- ============================================================
  insert into public.benchmark_points (source_id, period_weeks, raw_value, normalized_value) values
    -- W1 anchor — only direct weekly source we have
    (v_regulr,          1,  18.0, 18.0),

    -- W4 / M1 anchor (5 sources)
    (v_yjxm,            4,  53.0, 38.0),   -- 53 − 15 member-adj
    (v_paytronix_qsr,   4,  62.0, 47.0),   -- 62 − 15 member-adj
    (v_paytronix_fsr,   4,  57.8, 43.0),   -- 57.8 − 15 member-adj
    (v_baemin_launch,   4,  17.5, 17.5),   -- direct
    (v_cn_smb,          4,  30.0, 30.0),   -- direct (midpoint of 20-40% band)

    -- W12 / M3 anchor (8 sources)
    (v_bloom_all,      12,  25.0, 25.0),   -- cum 90-day, take as period-active approx
    (v_bloom_top,      12,  40.0, 40.0),
    (v_bloom_jan,      12,  44.3, 44.0),
    (v_bloom_sep,      12,  19.0, 19.0),
    (v_yogiyo_all,     12,  30.0, 18.0),   -- 30 × 0.6 order→customer
    (v_yogiyo_top,     12,  60.0, 36.0),   -- 60 × 0.6
    (v_yogiyo_kr,      12,  30.0, 18.0),   -- 30 × 0.6
    (v_baemin_m3,      12,  30.0, 30.0),   -- direct

    -- W26 / M6 anchor (3 sources)
    (v_gurunavi,       26,  76.9, 22.0),   -- cum ≥2 in 6mo → period-active (conservative)
    (v_qualimetrie,    26,  80.0, 25.0),   -- 1 − 0.20 drop-off → cum 80% → period-active
    (v_regulr,         26,  45.0, 15.0),   -- cum 45% at M6 → period-active

    -- W52 / M12 anchor (3 sources)
    (v_bloom_ann,      52,  21.0, 21.0),   -- direct Type A (100 − 78.8 churn)
    (v_dynac,          52,  35.0, 20.0),   -- 35 − 15 member-adj
    (v_regulr,         52,  42.0, 18.0);   -- cum 42% at Y1 → period-active

  raise notice 'seed complete: 18 sources, 20 points across anchors W1/W4/W12/W26/W52';
end $$;
