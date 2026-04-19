-- 0030_benchmark_schema.sql
-- North-star retention curve infrastructure (quick-260418-bm1).
--
-- Adds three pieces:
--   1. restaurants.slug — stable identifier for seed lookups (e.g. 'ramen-bones')
--   2. benchmark_sources + benchmark_points — tenant-scoped consulting IP curated
--      per restaurant (each tenant sees only their own curation via RLS)
--   3. benchmark_curve_v (weighted-quantile P20/P50/P80) + benchmark_sources_v
--      (attribution) — both use explicit JWT-filter pattern, uniform with 0012/
--      0024/0025/0027 (post-0026 convention, NOT security_invoker)
--
-- Weight formula for the quantile view:
--   weight = credibility_score * cuisine_match * type_factor
--     credibility_score: HIGH=3, MEDIUM=2, LOW=1
--     cuisine_match:     0.5..2.0 (1.0 baseline; ramen-relevant sources bumped)
--     type_factor:       Type-A (cohort active-in-period) = 1.0; converted = 0.7
--
-- Quantile computation uses cumulative-weight window function because
-- percentile_cont() does not support weights in Postgres.

-- ============================================================
-- 1. Restaurants.slug
-- ============================================================
alter table public.restaurants add column if not exists slug text;

update public.restaurants
set slug = 'ramen-bones'
where name = 'Ramen Shop (v1 tenant)'
  and slug is null;

alter table public.restaurants alter column slug set not null;

-- Idempotent unique constraint (skip if already present)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.restaurants'::regclass
      and conname  = 'restaurants_slug_unique'
  ) then
    alter table public.restaurants
      add constraint restaurants_slug_unique unique (slug);
  end if;
end $$;

-- ============================================================
-- 2. benchmark_sources — one row per study/report per tenant
-- ============================================================
create table public.benchmark_sources (
  id              bigserial primary key,
  restaurant_id   uuid not null references public.restaurants(id) on delete cascade,
  label           text not null,
  country         text not null,
  segment         text not null,
  credibility     text not null check (credibility in ('HIGH','MEDIUM','LOW')),
  cuisine_match   numeric not null check (cuisine_match between 0.5 and 2.0),
  metric_type     char(1) not null check (metric_type in ('A','B','C','D','E')),
  conversion_note text,
  sample_size     text,
  year            int not null,
  url             text,
  created_at      timestamptz not null default now()
);

create index benchmark_sources_tenant
  on public.benchmark_sources (restaurant_id);

alter table public.benchmark_sources enable row level security;

create policy benchmark_sources_tenant_read
  on public.benchmark_sources
  for select to authenticated
  using (restaurant_id::text = (auth.jwt()->>'restaurant_id'));

-- ============================================================
-- 3. benchmark_points — normalized data points per source/period
-- ============================================================
create table public.benchmark_points (
  id               bigserial primary key,
  source_id        bigint not null references public.benchmark_sources(id) on delete cascade,
  period_weeks     int not null check (period_weeks >= 0),
  raw_value        numeric not null,
  normalized_value numeric not null,
  unique (source_id, period_weeks)
);

create index benchmark_points_period
  on public.benchmark_points (period_weeks);

alter table public.benchmark_points enable row level security;

-- Tenancy inherits via sources (FK cascade + EXISTS subquery policy).
create policy benchmark_points_tenant_read
  on public.benchmark_points
  for select to authenticated
  using (exists (
    select 1
    from public.benchmark_sources bs
    where bs.id = benchmark_points.source_id
      and bs.restaurant_id::text = (auth.jwt()->>'restaurant_id')
  ));

-- ============================================================
-- 4. benchmark_curve_v — weighted-quantile view (P20/P50/P80)
--    Explicit JWT filter in body (matches 0012/0024/0025/0027).
-- ============================================================
create view public.benchmark_curve_v as
with weighted as (
  select
    bp.period_weeks,
    bp.normalized_value as v,
    (case bs.credibility
       when 'HIGH'   then 3
       when 'MEDIUM' then 2
       else 1
     end)::numeric
    * bs.cuisine_match
    * (case bs.metric_type when 'A' then 1.0 else 0.7 end) as w
  from public.benchmark_points bp
  join public.benchmark_sources bs on bs.id = bp.source_id
  where bs.restaurant_id::text = (auth.jwt()->>'restaurant_id')
),
cum as (
  select
    period_weeks, v, w,
    sum(w) over (
      partition by period_weeks order by v
      rows between unbounded preceding and current row
    ) as cw,
    sum(w) over (partition by period_weeks) as tw
  from weighted
)
select
  period_weeks,
  coalesce(min(v) filter (where cw >= 0.2 * tw), min(v)) as lower_p20,
  coalesce(min(v) filter (where cw >= 0.5 * tw), min(v)) as mid_p50,
  coalesce(min(v) filter (where cw >= 0.8 * tw), max(v)) as upper_p80,
  count(*)::int as source_count,
  sum(w)        as total_weight
from cum
group by period_weeks
order by period_weeks;

grant select on public.benchmark_curve_v to authenticated;

-- ============================================================
-- 5. benchmark_sources_v — attribution view for the tooltip popup
--    Returns one row per (source, period) with full attribution.
-- ============================================================
create view public.benchmark_sources_v as
select
  bp.period_weeks,
  bs.id,
  bs.label,
  bs.country,
  bs.segment,
  bs.credibility,
  bs.cuisine_match,
  bs.metric_type,
  bs.conversion_note,
  bs.sample_size,
  bs.year,
  bs.url,
  bp.raw_value,
  bp.normalized_value
from public.benchmark_sources bs
join public.benchmark_points bp on bp.source_id = bs.id
where bs.restaurant_id::text = (auth.jwt()->>'restaurant_id')
order by bp.period_weeks,
         case bs.credibility when 'HIGH' then 0 when 'MEDIUM' then 1 else 2 end,
         bs.label;

grant select on public.benchmark_sources_v to authenticated;

-- ============================================================
-- 6. Test helper — SECURITY DEFINER RPC for integration tests.
--    Mirrors public.test_retention_curve_monthly from 0027.
-- ============================================================
create or replace function public.test_benchmark_curve(rid uuid)
returns table (
  period_weeks  int,
  lower_p20     numeric,
  mid_p50       numeric,
  upper_p80     numeric,
  source_count  int,
  total_weight  numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('restaurant_id', rid::text)::text, true);
  return query select * from public.benchmark_curve_v;
end;
$$;
revoke all on function public.test_benchmark_curve(uuid) from public, anon, authenticated;
grant execute on function public.test_benchmark_curve(uuid) to service_role;
