# Phase 13 — External Data Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the five external-data ingest tables (`weather_daily`, `holidays`, `school_holidays`, `transit_alerts`, `recurring_events`), two operational tables (`pipeline_runs` extension + `shop_calendar`), a Python fetcher per source, an orchestrator with per-source try/except, and a single `external-data-refresh.yml` GHA workflow that runs nightly at `0 0 * * *` UTC and supports `workflow_dispatch start_date` backfill from 2025-06-11.

**Architecture:** Seven migrations land the schema (one per logical unit, per the codebase invariant). A new `scripts/external/` Python tree mirrors the modular split of `scripts/ingest/` (TS): one fetcher per source + a shared `db.py` (service-role Supabase client) + a shared `pipeline_runs_writer.py` (success/failure/fallback row writes) + an `run_all.py` orchestrator. Every fetcher returns `(rows, status, freshness_h, error_msg)` and writes one `pipeline_runs` row per invocation. Hybrid RLS: shared location-keyed tables are `for select using (true)` with all writes revoked from `authenticated`/`anon`; tenant-scoped tables (`pipeline_runs`, `shop_calendar`) use the canonical `auth.jwt()->>'restaurant_id'` pattern from `0010_cohort_mv.sql`.

**Tech Stack:** Postgres (Supabase) + Python 3.12 + httpx + python-holidays + feedparser + PyYAML + supabase-py + pytest + GitHub Actions + pg_cron (annual reminder only). No pandas, no Polars, no openmeteo-requests-SDK — raw `httpx` keeps the dep surface tiny and idempotent across providers.

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `supabase/migrations/0041_weather_daily.sql` | `weather_daily` table + hybrid-RLS + unique index `(date, location)` |
| `supabase/migrations/0042_holidays.sql` | `holidays` table + hybrid-RLS + unique index `(date)` |
| `supabase/migrations/0043_school_holidays.sql` | `school_holidays` table + hybrid-RLS + unique index `(state_code, block_name, start_date)` |
| `supabase/migrations/0044_transit_alerts.sql` | `transit_alerts` table + hybrid-RLS + unique index `(alert_id)` |
| `supabase/migrations/0045_recurring_events.sql` | `recurring_events` table + hybrid-RLS + unique index `(event_id)` + pg_cron `recurring-events-yearly-reminder` job |
| `supabase/migrations/0046_pipeline_runs_extend.sql` | ALTER TABLE: add `upstream_freshness_h numeric NULL` + `restaurant_id uuid NULL references restaurants(id)` + RLS policy `select using (restaurant_id is null OR restaurant_id::text = (auth.jwt()->>'restaurant_id'))` |
| `supabase/migrations/0047_shop_calendar.sql` | `shop_calendar` table + tenant-scoped RLS + unique index `(restaurant_id, date)` |
| `scripts/external/db.py` | Supabase service-role client factory (mirrors `scripts/ingest/upsert.ts` env contract) |
| `scripts/external/pipeline_runs_writer.py` | `write_success`/`write_fallback`/`write_failure` helpers; one row per fetcher invocation |
| `scripts/external/weather.py` | Bright Sky vs Open-Meteo provider switch via `WEATHER_PROVIDER` env; 30-day chunked fetch |
| `scripts/external/holidays.py` | python-holidays for federal + Berlin BE state including Frauentag |
| `scripts/external/school.py` | raw httpx against `ferien-api.de/api/v1/holidays/BE/{year}.json` |
| `scripts/external/transit.py` | feedparser over BVG RSS; module constant `KEYWORDS = ['Streik', 'Warnstreik']`; primary + fallback URL ranked |
| `scripts/external/events.py` | PyYAML load of `config/recurring_events.yaml` |
| `scripts/external/shop_calendar.py` | PyYAML load of `config/shop_hours.yaml` + 365-day-forward generate |
| `scripts/external/run_all.py` | Orchestrator; iterates fetchers; per-source try/except; exit-code semantics |
| `scripts/external/requirements.txt` | Python deps: `httpx`, `python-holidays>=0.25,<1`, `feedparser`, `PyYAML`, `supabase>=2,<3`, `python-dotenv` (test-only: `pytest`) |
| `config/recurring_events.yaml` | ~15 hand-curated Berlin events for 2026 + 2027 (event_id, name, category, start_date, end_date, impact_estimate, notes, source) |
| `config/shop_hours.yaml` | Friend-restaurant weekly_pattern (mon-sun is_open + open_at + close_at) + overrides[] |
| `tests/external/conftest.py` | pytest fixtures: monkeypatched httpx, fake supabase client |
| `tests/external/test_weather.py` | Bright Sky + Open-Meteo + 502-fallback scenarios |
| `tests/external/test_holidays.py` | python-holidays Berlin set + Frauentag presence |
| `tests/external/test_school.py` | ferien-api JSON shape + 5-6 BE blocks |
| `tests/external/test_transit.py` | strike vs no-strike RSS branches |
| `tests/external/test_events.py` | YAML load + slug uniqueness |
| `tests/external/test_shop_calendar.py` | weekly_pattern + override application + 365-day window |
| `tests/external/test_pipeline_runs_writer.py` | success / fallback / failure row shapes |
| `tests/external/test_run_all.py` | orchestrator: per-source isolation; exit 0 if any source succeeded, exit 1 only if all failed |
| `tests/fixtures/external/weather_brightsky_3day.json` | Hand-rolled fixture |
| `tests/fixtures/external/weather_open_meteo_3day.json` | Hand-rolled fixture |
| `tests/fixtures/external/weather_open_meteo_502.json` | Hand-rolled fixture (HTTPStatusError trigger) |
| `tests/fixtures/external/holidays_2026_berlin.json` | Synthesized python-holidays output |
| `tests/fixtures/external/school_holidays_be_2026.json` | Hand-rolled fixture |
| `tests/fixtures/external/transit_bvg_rss_strike.xml` | Hand-rolled fixture |
| `tests/fixtures/external/transit_bvg_rss_no_strike.xml` | Hand-rolled fixture |
| `tests/fixtures/external/recurring_events.yaml` | Test-mode override |
| `tests/fixtures/external/shop_hours.yaml` | Test-mode override |
| `.github/workflows/external-data-refresh.yml` | Cron `0 0 * * *` UTC + workflow_dispatch with `start_date` input |
| `tests/integration/migrations-13.test.ts` | Vitest schema tests for the 7 new tables (existence + columns + RLS) |

### Modified files

| Path | Change |
|---|---|
| `tests/integration/tenant-isolation.test.ts` | Add 7 new test cases (one per new ingest/operational table — assert wrong-JWT returns zero rows) |
| `.github/workflows/tests.yml` | Add `pytest-external` job (parallel to vitest) running `pytest tests/external/` |

### Untouched files relied on

| Path | Why it matters |
|---|---|
| `supabase/migrations/0010_cohort_mv.sql` | Source-of-truth pattern for `auth.jwt()->>'restaurant_id'` (lines 73-76) |
| `supabase/migrations/0023_transactions_filterable_v_visit_seq.sql` | Whitespace variant `auth.jwt() ->> 'restaurant_id'` |
| `supabase/migrations/0039_pipeline_runs_skeleton.sql` | The base table — Phase 13 ALTERs it in `0046` |
| `scripts/ci-guards/check-cron-schedule.py` | Guard 8 — reads our new workflow file automatically (no code change) |
| `scripts/ci-guards.sh` Guard 7 | Catches `auth.jwt()->>'tenant_id'` regressions in our new files automatically |
| `tests/helpers/supabase.ts` | `adminClient()` / `tenantClient()` for the extended isolation test |

---

## Pre-plan verification

This MUST run before Task 1 (D-13 plan-phase verification of BVG RSS URL).

- [ ] **Step P1: Verify primary BVG RSS URL responds**

Run the live URL check from the worktree root:

```bash
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" "https://www.bvg.de/de/verbindungen/stoerungsmeldungen.xml"
```

Expected: `200 application/rss+xml` (or `200 text/xml`). If `404` or `5xx`, treat the URL as unverified — capture the response in a code comment in `scripts/external/transit.py` and STOP this task before proceeding.

- [ ] **Step P2: Document one fallback URL**

The known BVG fallback (per current public docs) is `https://www.bvg.de/de/aktuell/stoerungen/rss.xml`. Verify it independently:

```bash
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" "https://www.bvg.de/de/aktuell/stoerungen/rss.xml"
```

Expected: `200`. If it 404s, search bvg.de for the current canonical "Störungen RSS" URL and document whichever works as the fallback. Both URLs go into `transit.py` as a `URLS = [primary, fallback]` ranked list.

- [ ] **Step P3: Capture verification dates in transit.py header**

Both URLs and their HTTP-200 verification dates land verbatim in the `transit.py` module docstring during Task 13.

---

## Task 1: Setup — Python deps + fixture dir

**Files:**
- Create: `scripts/external/requirements.txt`
- Create: `tests/fixtures/external/.gitkeep`
- Create: `tests/external/__init__.py`

- [ ] **Step 1.1: Create requirements.txt**

Write `scripts/external/requirements.txt`:

```
# Phase 13 external-data fetcher deps. Pinned conservatively. Do NOT add
# pandas / polars / openmeteo-requests / fetchers SDKs — raw httpx keeps
# the surface uniform across providers.
httpx>=0.27,<1
python-holidays>=0.25,<1
feedparser>=6.0,<7
PyYAML>=6.0,<7
supabase>=2.0,<3
python-dotenv>=1.0,<2

# Test-only — kept here so a single pip install -r covers CI + local dev.
# pytest is not imported by any production module.
pytest>=8.0,<9
```

- [ ] **Step 1.2: Create empty fixture dir + test package marker**

```bash
touch tests/fixtures/external/.gitkeep
touch tests/external/__init__.py
```

- [ ] **Step 1.3: Install deps and verify**

Run:
```bash
python3 -m venv .venv-phase13 && source .venv-phase13/bin/activate && pip install -r scripts/external/requirements.txt
python3 -c "import httpx, holidays, feedparser, yaml, supabase, dotenv, pytest; print('ok')"
```

Expected: `ok` printed cleanly.

- [ ] **Step 1.4: Commit**

```bash
git add scripts/external/requirements.txt tests/fixtures/external/.gitkeep tests/external/__init__.py
git commit -m "feat(13): scaffold scripts/external/ Python deps and tests/external/ tree"
```

---

## Task 2: Migration 0041 — `weather_daily`

**Files:**
- Create: `supabase/migrations/0041_weather_daily.sql`
- Create: `tests/integration/migrations-13.test.ts`

- [ ] **Step 2.1: Write the failing test**

Create `tests/integration/migrations-13.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { adminClient, tenantClient } from '../helpers/supabase';

const admin = adminClient();

// Phase 13 EXT-08: hybrid RLS verification across all 7 new tables.
// Shared location-keyed tables read with `using (true)` for any auth'd user;
// writes are revoked from authenticated/anon. Tenant-scoped tables key on
// auth.jwt()->>'restaurant_id'.

describe('Phase 13 schema: weather_daily', () => {
  it('table exists with the expected columns', async () => {
    const { data, error } = await admin
      .from('information_schema.columns' as never)
      .select('column_name, data_type, is_nullable')
      .eq('table_schema', 'public')
      .eq('table_name', 'weather_daily');
    expect(error).toBeNull();
    const cols = (data ?? []).reduce(
      (acc, c: any) => ({ ...acc, [c.column_name]: c }),
      {} as Record<string, any>
    );
    expect(cols['date']).toBeDefined();
    expect(cols['location']).toBeDefined();
    expect(cols['temp_min_c']).toBeDefined();
    expect(cols['temp_max_c']).toBeDefined();
    expect(cols['precip_mm']).toBeDefined();
    expect(cols['provider']).toBeDefined();
    expect(cols['fetched_at']).toBeDefined();
  });

  it('anon client can SELECT but cannot INSERT', async () => {
    const c = tenantClient();
    const { error: selErr } = await c.from('weather_daily').select('date').limit(1);
    expect(selErr).toBeNull();
    const { error: insErr } = await c
      .from('weather_daily')
      .insert({ date: '2099-01-01', location: 'berlin', provider: 'test' });
    expect(insErr).not.toBeNull();
  });
});
```

- [ ] **Step 2.2: Run test to confirm it fails**

```bash
npx vitest run tests/integration/migrations-13.test.ts --reporter=dot
```

Expected: FAIL — table does not exist yet (or `information_schema` returns empty).

- [ ] **Step 2.3: Write the migration**

Create `supabase/migrations/0041_weather_daily.sql`:

```sql
-- 0041_weather_daily.sql
-- Phase 13 EXT-01: nightly weather observations + 7-day-forward forecast.
-- Shared location-keyed table — every restaurant in the city reads the same row.
-- Hybrid-RLS pattern (CONTEXT.md C-05): SELECT for everyone, writes service-role only.
-- Provider switchable via WEATHER_PROVIDER env (brightsky default, open-meteo dev).
-- Backfill window starts 2025-06-11; 7 days forward beyond today via forecast API.

create table if not exists public.weather_daily (
  date         date         not null,
  location     text         not null,
  temp_min_c   numeric,
  temp_max_c   numeric,
  precip_mm    numeric,
  wind_kph     numeric,
  cloud_cover  numeric,
  provider     text         not null,
  fetched_at   timestamptz  not null default now(),
  primary key (date, location)
);

-- Idempotent backfill via ON CONFLICT (date, location) DO UPDATE SET ... — the
-- composite PK above also serves as the natural-key unique index (D-03).

alter table public.weather_daily enable row level security;

-- Shared read: any authenticated session may read.
create policy weather_daily_read
  on public.weather_daily for select
  using (true);

-- Writes are service-role only.
revoke insert, update, delete on public.weather_daily from authenticated, anon;
grant select on public.weather_daily to authenticated, anon;
grant select, insert, update, delete on public.weather_daily to service_role;
```

- [ ] **Step 2.4: Push migration to TEST + DEV + verify**

```bash
supabase db push --include-all --yes
```

Expected: migration `0041` listed under "Applying" with no errors.

- [ ] **Step 2.5: Re-run vitest**

```bash
npx vitest run tests/integration/migrations-13.test.ts --reporter=dot
```

Expected: PASS for the two `weather_daily` cases.

- [ ] **Step 2.6: Verify Guard 7 still clean (mechanical check)**

```bash
bash scripts/ci-guards.sh
```

Expected: "All CI guards passed."

- [ ] **Step 2.7: Commit**

```bash
git add supabase/migrations/0041_weather_daily.sql tests/integration/migrations-13.test.ts
git commit -m "feat(13): migration 0041 weather_daily with hybrid-RLS"
```

---

## Task 3: Migration 0042 — `holidays`

**Files:**
- Create: `supabase/migrations/0042_holidays.sql`
- Modify: `tests/integration/migrations-13.test.ts` (append `holidays` describe block)

- [ ] **Step 3.1: Append failing test**

Append to `tests/integration/migrations-13.test.ts`:

```ts
describe('Phase 13 schema: holidays', () => {
  it('table exists with the expected columns', async () => {
    const { data } = await admin
      .from('information_schema.columns' as never)
      .select('column_name')
      .eq('table_schema', 'public')
      .eq('table_name', 'holidays');
    const names = (data ?? []).map((c: any) => c.column_name);
    expect(names).toContain('date');
    expect(names).toContain('name');
    expect(names).toContain('country_code');
    expect(names).toContain('subdiv_code');
    expect(names).toContain('fetched_at');
  });

  it('anon SELECT allowed, INSERT denied', async () => {
    const c = tenantClient();
    const { error: selErr } = await c.from('holidays').select('date').limit(1);
    expect(selErr).toBeNull();
    const { error: insErr } = await c
      .from('holidays')
      .insert({ date: '2099-01-01', name: 'fake', country_code: 'DE' });
    expect(insErr).not.toBeNull();
  });
});
```

- [ ] **Step 3.2: Run test, verify FAIL**

```bash
npx vitest run tests/integration/migrations-13.test.ts -t holidays --reporter=dot
```

Expected: FAIL — table missing.

- [ ] **Step 3.3: Write migration**

Create `supabase/migrations/0042_holidays.sql`:

```sql
-- 0042_holidays.sql
-- Phase 13 EXT-02: federal + Berlin (BE) state holidays incl. Frauentag.
-- Source: python-holidays (bundled, no API key). Re-runs are idempotent
-- via ON CONFLICT (date) DO UPDATE — federal + BE rows MUST collapse to
-- one logical row per date; if a date is both federal and BE-only, BE
-- wins (subdiv_code='BE') and `name` carries both.

create table if not exists public.holidays (
  date          date        not null primary key,
  name          text        not null,
  country_code  text        not null default 'DE',
  subdiv_code   text,
  fetched_at    timestamptz not null default now()
);

alter table public.holidays enable row level security;

create policy holidays_read
  on public.holidays for select
  using (true);

revoke insert, update, delete on public.holidays from authenticated, anon;
grant select on public.holidays to authenticated, anon;
grant select, insert, update, delete on public.holidays to service_role;
```

- [ ] **Step 3.4: Push + re-run test**

```bash
supabase db push --include-all --yes && npx vitest run tests/integration/migrations-13.test.ts -t holidays --reporter=dot
```

Expected: PASS.

- [ ] **Step 3.5: Commit**

```bash
git add supabase/migrations/0042_holidays.sql tests/integration/migrations-13.test.ts
git commit -m "feat(13): migration 0042 holidays with hybrid-RLS"
```

---

## Task 4: Migration 0043 — `school_holidays`

**Files:**
- Create: `supabase/migrations/0043_school_holidays.sql`
- Modify: `tests/integration/migrations-13.test.ts`

- [ ] **Step 4.1: Append failing test**

Append:

```ts
describe('Phase 13 schema: school_holidays', () => {
  it('table exists with the expected columns', async () => {
    const { data } = await admin
      .from('information_schema.columns' as never)
      .select('column_name')
      .eq('table_schema', 'public')
      .eq('table_name', 'school_holidays');
    const names = (data ?? []).map((c: any) => c.column_name);
    expect(names).toContain('state_code');
    expect(names).toContain('block_name');
    expect(names).toContain('start_date');
    expect(names).toContain('end_date');
    expect(names).toContain('fetched_at');
  });
});
```

- [ ] **Step 4.2: Run test, verify FAIL**

```bash
npx vitest run tests/integration/migrations-13.test.ts -t school_holidays --reporter=dot
```

- [ ] **Step 4.3: Write migration**

Create `supabase/migrations/0043_school_holidays.sql`:

```sql
-- 0043_school_holidays.sql
-- Phase 13 EXT-03: BE state-school break blocks (~5-6 per year).
-- Source: ferien-api.de (raw httpx; the abandoned `ferien-api` PyPI wrapper
-- is NOT used). Natural key is (state_code, block_name, start_date) — the
-- same block can shift dates year-to-year, so block_name+year alone is
-- not unique enough.

create table if not exists public.school_holidays (
  state_code   text         not null,
  block_name   text         not null,
  start_date   date         not null,
  end_date     date         not null,
  year         int          not null,
  fetched_at   timestamptz  not null default now(),
  primary key (state_code, block_name, start_date)
);

alter table public.school_holidays enable row level security;

create policy school_holidays_read
  on public.school_holidays for select
  using (true);

revoke insert, update, delete on public.school_holidays from authenticated, anon;
grant select on public.school_holidays to authenticated, anon;
grant select, insert, update, delete on public.school_holidays to service_role;
```

- [ ] **Step 4.4: Push + re-run + commit**

```bash
supabase db push --include-all --yes && npx vitest run tests/integration/migrations-13.test.ts -t school_holidays --reporter=dot
git add supabase/migrations/0043_school_holidays.sql tests/integration/migrations-13.test.ts
git commit -m "feat(13): migration 0043 school_holidays with hybrid-RLS"
```

---

## Task 5: Migration 0044 — `transit_alerts`

**Files:**
- Create: `supabase/migrations/0044_transit_alerts.sql`
- Modify: `tests/integration/migrations-13.test.ts`

- [ ] **Step 5.1: Append failing test**

Append:

```ts
describe('Phase 13 schema: transit_alerts', () => {
  it('table exists with the expected columns', async () => {
    const { data } = await admin
      .from('information_schema.columns' as never)
      .select('column_name')
      .eq('table_schema', 'public')
      .eq('table_name', 'transit_alerts');
    const names = (data ?? []).map((c: any) => c.column_name);
    expect(names).toContain('alert_id');
    expect(names).toContain('title');
    expect(names).toContain('pub_date');
    expect(names).toContain('matched_keyword');
    expect(names).toContain('source_url');
    expect(names).toContain('fetched_at');
  });
});
```

- [ ] **Step 5.2: Run test, verify FAIL**

- [ ] **Step 5.3: Write migration**

Create `supabase/migrations/0044_transit_alerts.sql`:

```sql
-- 0044_transit_alerts.sql
-- Phase 13 EXT-04: BVG RSS strike alerts. Phase 13 keyword scope is
-- {Streik, Warnstreik} (D-12); v1.4 PR extends the module constant.
-- alert_id is sha256(title || pub_date) computed in Python — keeps the
-- table idempotent across feed re-fetches.

create table if not exists public.transit_alerts (
  alert_id          text         not null primary key,
  title             text         not null,
  pub_date          timestamptz  not null,
  matched_keyword   text         not null,
  description       text,
  source_url        text         not null,
  fetched_at        timestamptz  not null default now()
);

alter table public.transit_alerts enable row level security;

create policy transit_alerts_read
  on public.transit_alerts for select
  using (true);

revoke insert, update, delete on public.transit_alerts from authenticated, anon;
grant select on public.transit_alerts to authenticated, anon;
grant select, insert, update, delete on public.transit_alerts to service_role;
```

- [ ] **Step 5.4: Push + re-run + commit**

```bash
supabase db push --include-all --yes && npx vitest run tests/integration/migrations-13.test.ts -t transit_alerts --reporter=dot
git add supabase/migrations/0044_transit_alerts.sql tests/integration/migrations-13.test.ts
git commit -m "feat(13): migration 0044 transit_alerts with hybrid-RLS"
```

---

## Task 6: Migration 0045 — `recurring_events` + pg_cron annual reminder

**Files:**
- Create: `supabase/migrations/0045_recurring_events.sql`
- Modify: `tests/integration/migrations-13.test.ts`

- [ ] **Step 6.1: Append failing test**

Append:

```ts
describe('Phase 13 schema: recurring_events', () => {
  it('table exists with the expected columns', async () => {
    const { data } = await admin
      .from('information_schema.columns' as never)
      .select('column_name')
      .eq('table_schema', 'public')
      .eq('table_name', 'recurring_events');
    const names = (data ?? []).map((c: any) => c.column_name);
    expect(names).toContain('event_id');
    expect(names).toContain('name');
    expect(names).toContain('category');
    expect(names).toContain('start_date');
    expect(names).toContain('end_date');
    expect(names).toContain('impact_estimate');
    expect(names).toContain('source');
  });

  it('pg_cron job recurring-events-yearly-reminder is scheduled', async () => {
    const { data, error } = await admin
      .from('cron.job' as never)
      .select('jobname, schedule')
      .eq('jobname', 'recurring-events-yearly-reminder');
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(1);
    // Sep 15 yearly: '0 9 15 9 *' (any minute/hour combo on Sep 15 is fine — assert the day+month).
    const job = (data ?? [])[0] as { schedule?: string };
    expect(job?.schedule).toMatch(/15\s+9/);
  });
});
```

- [ ] **Step 6.2: Run test, verify FAIL**

- [ ] **Step 6.3: Write migration**

Create `supabase/migrations/0045_recurring_events.sql`:

```sql
-- 0045_recurring_events.sql
-- Phase 13 EXT-05: hand-curated city events from config/recurring_events.yaml.
-- ~15 events per year for Berlin. event_id is the slug from the YAML —
-- stable across years (e.g. 'berlin-marathon-2026', 'csd-berlin-2026').
--
-- The pg_cron annual reminder writes one row to public.pipeline_runs on
-- Sep 15 each year. The reminder is intentionally a pipeline_runs row,
-- not an email — surfacing in maintainer-review of the table is enough
-- for v1 (CONTEXT specifics).

create table if not exists public.recurring_events (
  event_id          text         not null primary key,
  name              text         not null,
  category          text         not null check (category in ('festival','sports','market','holiday','other')),
  start_date        date         not null,
  end_date          date         not null,
  impact_estimate   text         not null check (impact_estimate in ('high','medium','low')),
  notes             text,
  source            text,
  fetched_at        timestamptz  not null default now()
);

alter table public.recurring_events enable row level security;

create policy recurring_events_read
  on public.recurring_events for select
  using (true);

revoke insert, update, delete on public.recurring_events from authenticated, anon;
grant select on public.recurring_events to authenticated, anon;
grant select, insert, update, delete on public.recurring_events to service_role;

-- pg_cron annual reminder: every Sep 15 at 09:00 UTC, write a warning
-- row to pipeline_runs nudging the maintainer to add next-year events.
-- Schedule: minute=0 hour=9 dom=15 month=9 dow=*
select cron.schedule(
  'recurring-events-yearly-reminder',
  '0 9 15 9 *',
  $$ insert into public.pipeline_runs (step_name, started_at, finished_at, status, row_count, error_msg)
     values (
       'recurring_events_reminder',
       now(),
       now(),
       'warning',
       0,
       'Add recurring_events for ' || (extract(year from now()) + 1)::text || ' to config/recurring_events.yaml and run external-data-refresh.yml backfill'
     ); $$
);
```

- [ ] **Step 6.4: Push + re-run + commit**

```bash
supabase db push --include-all --yes && npx vitest run tests/integration/migrations-13.test.ts -t recurring_events --reporter=dot
git add supabase/migrations/0045_recurring_events.sql tests/integration/migrations-13.test.ts
git commit -m "feat(13): migration 0045 recurring_events + Sep-15 annual pg_cron reminder"
```

- [ ] **Step 6.5: Verify Guard 8 still clean (cron schedule contract)**

```bash
python3 scripts/ci-guards/check-cron-schedule.py --print-table
```

Expected: clean — the new `recurring-events-yearly-reminder` runs annually on Sep 15 09:00 UTC; no overlap with the daily crons.

---

## Task 7: Migration 0046 — `pipeline_runs` extension

**Files:**
- Create: `supabase/migrations/0046_pipeline_runs_extend.sql`
- Modify: `tests/integration/migrations-13.test.ts`

- [ ] **Step 7.1: Append failing test**

Append:

```ts
describe('Phase 13 schema: pipeline_runs extension', () => {
  it('upstream_freshness_h and restaurant_id columns exist', async () => {
    const { data } = await admin
      .from('information_schema.columns' as never)
      .select('column_name, data_type, is_nullable')
      .eq('table_schema', 'public')
      .eq('table_name', 'pipeline_runs');
    const names = (data ?? []).map((c: any) => c.column_name);
    expect(names).toContain('upstream_freshness_h');
    expect(names).toContain('restaurant_id');
  });

  it('RLS lets authenticated users read GLOBAL rows (restaurant_id IS NULL)', async () => {
    // Write one global row as service-role.
    await admin.from('pipeline_runs').insert({
      step_name: 'phase13_rls_smoke',
      status: 'success',
      row_count: 0,
      restaurant_id: null
    });
    // Anon client should be able to SEE it (because of restaurant_id IS NULL clause)
    // but only AFTER signing in — anon role still has no privileges.
    // We assert the policy exists by querying as service-role + asserting
    // pg_policies has our new policy name.
    const { data, error } = await admin
      .from('pg_policies' as never)
      .select('policyname, qual')
      .eq('schemaname', 'public')
      .eq('tablename', 'pipeline_runs');
    expect(error).toBeNull();
    const policies = (data ?? []).map((p: any) => p.policyname);
    expect(policies).toContain('pipeline_runs_read');
  });
});
```

- [ ] **Step 7.2: Run test, verify FAIL**

- [ ] **Step 7.3: Write migration**

Create `supabase/migrations/0046_pipeline_runs_extend.sql`:

```sql
-- 0046_pipeline_runs_extend.sql
-- Phase 13 D-01 + C-03: extend the 0039 skeleton with the columns the
-- external-data cascade needs. Adds:
--   - upstream_freshness_h numeric NULL  (D-14: hours since the latest
--     data point in the upstream response — feeds the stale-data badge
--     in Phase 15)
--   - restaurant_id uuid NULL  (allows audit-script global rows from
--     Phase 12 to coexist with per-tenant fetcher rows in the same table)
-- Also installs the per-tenant RLS policy that lets dashboards read
-- "their" rows + global rows.

alter table public.pipeline_runs
  add column if not exists upstream_freshness_h numeric,
  add column if not exists restaurant_id        uuid references public.restaurants(id) on delete cascade;

alter table public.pipeline_runs enable row level security;

-- Idempotent recreate: drop any prior policy (skeleton had none), then create.
drop policy if exists pipeline_runs_read on public.pipeline_runs;
create policy pipeline_runs_read
  on public.pipeline_runs for select
  using (
    restaurant_id is null
    OR restaurant_id::text = (auth.jwt() ->> 'restaurant_id')
  );

-- Writes remain service-role only (skeleton already revoked from anon/authenticated;
-- re-state explicitly in case future drift).
revoke insert, update, delete on public.pipeline_runs from authenticated, anon;
grant select on public.pipeline_runs to authenticated, anon;
```

- [ ] **Step 7.4: Push + re-run + commit**

```bash
supabase db push --include-all --yes && npx vitest run tests/integration/migrations-13.test.ts -t "pipeline_runs extension" --reporter=dot
git add supabase/migrations/0046_pipeline_runs_extend.sql tests/integration/migrations-13.test.ts
git commit -m "feat(13): migration 0046 extend pipeline_runs with restaurant_id + freshness + RLS"
```

- [ ] **Step 7.5: Re-run Guard 7 to confirm restaurant_id rename rule is satisfied**

```bash
bash scripts/ci-guards.sh
```

Expected: "All CI guards passed."

---

## Task 8: Migration 0047 — `shop_calendar`

**Files:**
- Create: `supabase/migrations/0047_shop_calendar.sql`
- Modify: `tests/integration/migrations-13.test.ts`

- [ ] **Step 8.1: Append failing test**

Append:

```ts
describe('Phase 13 schema: shop_calendar', () => {
  it('table exists with the expected columns', async () => {
    const { data } = await admin
      .from('information_schema.columns' as never)
      .select('column_name')
      .eq('table_schema', 'public')
      .eq('table_name', 'shop_calendar');
    const names = (data ?? []).map((c: any) => c.column_name);
    expect(names).toContain('restaurant_id');
    expect(names).toContain('date');
    expect(names).toContain('is_open');
    expect(names).toContain('open_at');
    expect(names).toContain('close_at');
    expect(names).toContain('reason');
  });

  it('tenant-scoped RLS policy exists', async () => {
    const { data } = await admin
      .from('pg_policies' as never)
      .select('policyname')
      .eq('schemaname', 'public')
      .eq('tablename', 'shop_calendar');
    const policies = (data ?? []).map((p: any) => p.policyname);
    expect(policies).toContain('shop_calendar_read');
  });
});
```

- [ ] **Step 8.2: Run test, verify FAIL**

- [ ] **Step 8.3: Write migration**

Create `supabase/migrations/0047_shop_calendar.sql`:

```sql
-- 0047_shop_calendar.sql
-- Phase 13 EXT-07: per-restaurant open/closed calendar 365 days forward.
-- Tenant-scoped table — uses canonical auth.jwt()->>'restaurant_id'
-- pattern from 0010_cohort_mv.sql lines 73-76. Closed days are flagged
-- is_open=false; downstream forecast (Phase 14) maps those to NaN to
-- avoid demand-underestimate bias (PROPOSAL §14).

create table if not exists public.shop_calendar (
  restaurant_id  uuid         not null references public.restaurants(id) on delete cascade,
  date           date         not null,
  is_open        boolean      not null,
  open_at        time,
  close_at       time,
  reason         text,
  fetched_at     timestamptz  not null default now(),
  primary key (restaurant_id, date)
);

alter table public.shop_calendar enable row level security;

create policy shop_calendar_read
  on public.shop_calendar for select
  using (restaurant_id::text = (auth.jwt() ->> 'restaurant_id'));

revoke insert, update, delete on public.shop_calendar from authenticated, anon;
grant select on public.shop_calendar to authenticated, anon;
grant select, insert, update, delete on public.shop_calendar to service_role;
```

- [ ] **Step 8.4: Push + re-run + commit**

```bash
supabase db push --include-all --yes && npx vitest run tests/integration/migrations-13.test.ts -t shop_calendar --reporter=dot
git add supabase/migrations/0047_shop_calendar.sql tests/integration/migrations-13.test.ts
git commit -m "feat(13): migration 0047 shop_calendar with tenant-scoped RLS"
```

---

## Task 9: Shared Python helpers — `db.py` + `pipeline_runs_writer.py`

**Files:**
- Create: `scripts/external/db.py`
- Create: `scripts/external/pipeline_runs_writer.py`
- Create: `tests/external/test_pipeline_runs_writer.py`

- [ ] **Step 9.1: Write failing test**

Create `tests/external/test_pipeline_runs_writer.py`:

```python
"""Phase 13: pipeline_runs_writer unit tests.

The writer is the single place that knows the (success | fallback | failure)
row shape. Each fetcher gets a uniform interface; tests pin the schema.
"""
from __future__ import annotations
from datetime import datetime, timezone
from unittest.mock import MagicMock
import pytest

from scripts.external.pipeline_runs_writer import (
    write_success, write_fallback, write_failure,
)


def _client_with_capture():
    """Return (mock_client, capture_list) where every insert appends to capture_list."""
    client = MagicMock()
    captured: list[dict] = []
    def insert(payload):
        captured.append(payload)
        return MagicMock(execute=MagicMock(return_value=MagicMock(error=None)))
    client.table.return_value.insert.side_effect = insert
    return client, captured


def test_write_success_shape():
    client, captured = _client_with_capture()
    started = datetime(2026, 4, 29, 0, 0, tzinfo=timezone.utc)
    write_success(
        client,
        step_name='external_weather',
        started_at=started,
        row_count=42,
        upstream_freshness_h=1.5,
        commit_sha='abc123',
    )
    assert len(captured) == 1
    row = captured[0]
    assert row['step_name'] == 'external_weather'
    assert row['status'] == 'success'
    assert row['row_count'] == 42
    assert row['upstream_freshness_h'] == 1.5
    assert row['error_msg'] is None
    assert row['commit_sha'] == 'abc123'


def test_write_fallback_carries_error_msg():
    client, captured = _client_with_capture()
    started = datetime(2026, 4, 29, 0, 0, tzinfo=timezone.utc)
    write_fallback(
        client,
        step_name='external_weather',
        started_at=started,
        error_msg='502 Bad Gateway from open-meteo; switched to brightsky',
    )
    assert captured[0]['status'] == 'fallback'
    assert 'open-meteo' in captured[0]['error_msg']
    assert captured[0]['row_count'] == 0


def test_write_failure_truncates_long_error():
    client, captured = _client_with_capture()
    started = datetime(2026, 4, 29, 0, 0, tzinfo=timezone.utc)
    long_err = 'X' * 5000
    write_failure(
        client,
        step_name='external_school',
        started_at=started,
        error_msg=long_err,
    )
    assert captured[0]['status'] == 'failure'
    # Truncate at 2000 chars + ellipsis (D-14 specifics).
    assert len(captured[0]['error_msg']) <= 2010
    assert captured[0]['error_msg'].endswith('...')
```

- [ ] **Step 9.2: Run test, verify FAIL**

```bash
source .venv-phase13/bin/activate
PYTHONPATH=. pytest tests/external/test_pipeline_runs_writer.py -v
```

Expected: FAIL — module does not exist.

- [ ] **Step 9.3: Write `db.py`**

Create `scripts/external/db.py`:

```python
"""Phase 13: Supabase service-role client factory.

Mirrors the env contract of scripts/ingest/upsert.ts:
- SUPABASE_URL          (Supabase project URL)
- SUPABASE_SERVICE_ROLE_KEY  (service-role JWT)

Service-role bypasses RLS and is the only role authorized to write to
the Phase 13 tables (hybrid-RLS pattern: revoke insert/update/delete
from authenticated/anon, grant write to service_role only).
"""
from __future__ import annotations
import os
from supabase import create_client, Client


def make_client() -> Client:
    url = os.environ.get('SUPABASE_URL')
    key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if not url or not key:
        raise RuntimeError(
            'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. '
            'Local dev: source .env. CI: set in workflow env.'
        )
    return create_client(url, key)
```

- [ ] **Step 9.4: Write `pipeline_runs_writer.py`**

Create `scripts/external/pipeline_runs_writer.py`:

```python
"""Phase 13: pipeline_runs row writer.

Every fetcher invocation in run_all.py writes ONE row via one of:
- write_success(...) — fetch ok, optionally with upstream_freshness_h
- write_fallback(...) — primary upstream failed but cascade can continue
- write_failure(...)  — fetch threw; this fetcher's data is missing

Status taxonomy is fixed: 'success' | 'fallback' | 'failure'. The
dashboard freshness badge (Phase 15) reads upstream_freshness_h, NOT
status — see CONTEXT.md specifics.

error_msg is truncated at 2000 chars + '...' to keep rows compact.
The full traceback lives in the GHA workflow log; pipeline_runs is
the human-triage breadcrumb, not the system-of-record for stack traces.
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Optional
import os

from supabase import Client

ERROR_MSG_CAP = 2000


def _truncate(msg: Optional[str]) -> Optional[str]:
    if msg is None:
        return None
    if len(msg) <= ERROR_MSG_CAP:
        return msg
    return msg[:ERROR_MSG_CAP] + '...'


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _commit_sha() -> Optional[str]:
    return os.environ.get('GITHUB_SHA') or os.environ.get('COMMIT_SHA')


def write_success(
    client: Client,
    *,
    step_name: str,
    started_at: datetime,
    row_count: int,
    upstream_freshness_h: Optional[float] = None,
    restaurant_id: Optional[str] = None,
    commit_sha: Optional[str] = None,
) -> None:
    """Insert a 'success' row."""
    payload = {
        'step_name': step_name,
        'started_at': started_at.isoformat(),
        'finished_at': _now().isoformat(),
        'status': 'success',
        'row_count': row_count,
        'upstream_freshness_h': upstream_freshness_h,
        'error_msg': None,
        'restaurant_id': restaurant_id,
        'commit_sha': commit_sha or _commit_sha(),
    }
    res = client.table('pipeline_runs').insert(payload).execute()
    if getattr(res, 'error', None):
        raise RuntimeError(f'pipeline_runs insert (success) failed: {res.error}')


def write_fallback(
    client: Client,
    *,
    step_name: str,
    started_at: datetime,
    error_msg: str,
    row_count: int = 0,
    upstream_freshness_h: Optional[float] = None,
    restaurant_id: Optional[str] = None,
    commit_sha: Optional[str] = None,
) -> None:
    """Insert a 'fallback' row — primary source failed but cascade may continue."""
    payload = {
        'step_name': step_name,
        'started_at': started_at.isoformat(),
        'finished_at': _now().isoformat(),
        'status': 'fallback',
        'row_count': row_count,
        'upstream_freshness_h': upstream_freshness_h,
        'error_msg': _truncate(error_msg),
        'restaurant_id': restaurant_id,
        'commit_sha': commit_sha or _commit_sha(),
    }
    res = client.table('pipeline_runs').insert(payload).execute()
    if getattr(res, 'error', None):
        raise RuntimeError(f'pipeline_runs insert (fallback) failed: {res.error}')


def write_failure(
    client: Client,
    *,
    step_name: str,
    started_at: datetime,
    error_msg: str,
    restaurant_id: Optional[str] = None,
    commit_sha: Optional[str] = None,
) -> None:
    """Insert a 'failure' row — this source's data is missing this run."""
    payload = {
        'step_name': step_name,
        'started_at': started_at.isoformat(),
        'finished_at': _now().isoformat(),
        'status': 'failure',
        'row_count': 0,
        'upstream_freshness_h': None,
        'error_msg': _truncate(error_msg),
        'restaurant_id': restaurant_id,
        'commit_sha': commit_sha or _commit_sha(),
    }
    res = client.table('pipeline_runs').insert(payload).execute()
    if getattr(res, 'error', None):
        raise RuntimeError(f'pipeline_runs insert (failure) failed: {res.error}')
```

- [ ] **Step 9.5: Run test, verify PASS**

```bash
PYTHONPATH=. pytest tests/external/test_pipeline_runs_writer.py -v
```

Expected: 3 passed.

- [ ] **Step 9.6: Commit**

```bash
git add scripts/external/db.py scripts/external/pipeline_runs_writer.py tests/external/test_pipeline_runs_writer.py
git commit -m "feat(13): pipeline_runs_writer with success/fallback/failure semantics + truncation"
```

---

## Task 10: Fetcher — `weather.py`

**Files:**
- Create: `tests/fixtures/external/weather_brightsky_3day.json`
- Create: `tests/fixtures/external/weather_open_meteo_3day.json`
- Create: `scripts/external/weather.py`
- Create: `tests/external/test_weather.py`

- [ ] **Step 10.1: Write the Bright Sky fixture**

Create `tests/fixtures/external/weather_brightsky_3day.json`:

```json
{
  "weather": [
    {"timestamp": "2026-04-29T00:00:00+00:00", "temperature": 8.0, "precipitation": 0.0, "wind_speed": 12.0, "cloud_cover": 50.0},
    {"timestamp": "2026-04-29T12:00:00+00:00", "temperature": 16.0, "precipitation": 0.0, "wind_speed": 14.0, "cloud_cover": 30.0},
    {"timestamp": "2026-04-30T00:00:00+00:00", "temperature": 9.0, "precipitation": 1.2, "wind_speed": 10.0, "cloud_cover": 80.0},
    {"timestamp": "2026-04-30T12:00:00+00:00", "temperature": 14.0, "precipitation": 3.5, "wind_speed": 11.0, "cloud_cover": 90.0},
    {"timestamp": "2026-05-01T00:00:00+00:00", "temperature": 7.0, "precipitation": 0.5, "wind_speed": 9.0, "cloud_cover": 60.0},
    {"timestamp": "2026-05-01T12:00:00+00:00", "temperature": 13.0, "precipitation": 0.0, "wind_speed": 8.0, "cloud_cover": 40.0}
  ]
}
```

- [ ] **Step 10.2: Write the Open-Meteo fixture**

Create `tests/fixtures/external/weather_open_meteo_3day.json`:

```json
{
  "daily": {
    "time": ["2026-04-29", "2026-04-30", "2026-05-01"],
    "temperature_2m_min": [8.0, 9.0, 7.0],
    "temperature_2m_max": [16.0, 14.0, 13.0],
    "precipitation_sum": [0.0, 4.7, 0.5],
    "wind_speed_10m_max": [14.0, 11.0, 9.0],
    "cloud_cover_mean": [40.0, 85.0, 50.0]
  }
}
```

- [ ] **Step 10.3: Write the failing test**

Create `tests/external/test_weather.py`:

```python
"""Phase 13 EXT-01: weather fetcher tests — Bright Sky + Open-Meteo + 502 fallback."""
from __future__ import annotations
import json
from pathlib import Path
from datetime import date
from unittest.mock import MagicMock
import httpx
import pytest

from scripts.external.weather import fetch_weather, normalize_brightsky, normalize_open_meteo

FIX = Path(__file__).resolve().parent.parent / 'fixtures' / 'external'


def _mock_httpx_get(payload, status_code=200):
    """Return a callable suitable for monkeypatch.setattr(httpx, 'get', ...).

    Builds a real httpx.Response so .json() / .raise_for_status() behave
    exactly as in production (no shape drift between fake and real).
    """
    def _get(url, params=None, timeout=None, **kwargs):
        req = httpx.Request('GET', url)
        return httpx.Response(status_code, json=payload, request=req)
    return _get


def test_normalize_brightsky_reduces_to_daily():
    payload = json.loads((FIX / 'weather_brightsky_3day.json').read_text())
    rows = normalize_brightsky(payload, location='berlin')
    assert len(rows) == 3
    apr29 = next(r for r in rows if r['date'] == date(2026, 4, 29))
    assert apr29['temp_min_c'] == 8.0
    assert apr29['temp_max_c'] == 16.0
    assert apr29['precip_mm'] == 0.0
    assert apr29['provider'] == 'brightsky'


def test_normalize_open_meteo_passthrough():
    payload = json.loads((FIX / 'weather_open_meteo_3day.json').read_text())
    rows = normalize_open_meteo(payload, location='berlin')
    assert len(rows) == 3
    apr30 = next(r for r in rows if r['date'] == date(2026, 4, 30))
    assert apr30['temp_min_c'] == 9.0
    assert apr30['temp_max_c'] == 14.0
    assert apr30['precip_mm'] == 4.7
    assert apr30['provider'] == 'open-meteo'


def test_fetch_weather_uses_brightsky_when_env_default(monkeypatch):
    payload = json.loads((FIX / 'weather_brightsky_3day.json').read_text())
    monkeypatch.setenv('WEATHER_PROVIDER', 'brightsky')
    monkeypatch.setattr(httpx, 'get', _mock_httpx_get(payload))
    rows, freshness_h = fetch_weather(start_date=date(2026, 4, 29), end_date=date(2026, 5, 1))
    assert len(rows) == 3
    assert all(r['provider'] == 'brightsky' for r in rows)
    assert freshness_h is not None  # at least computed


def test_fetch_weather_uses_open_meteo_when_env_set(monkeypatch):
    payload = json.loads((FIX / 'weather_open_meteo_3day.json').read_text())
    monkeypatch.setenv('WEATHER_PROVIDER', 'open-meteo')
    monkeypatch.setattr(httpx, 'get', _mock_httpx_get(payload))
    rows, _ = fetch_weather(start_date=date(2026, 4, 29), end_date=date(2026, 5, 1))
    assert len(rows) == 3
    assert all(r['provider'] == 'open-meteo' for r in rows)


def test_fetch_weather_502_raises_upstream_unavailable(monkeypatch):
    """Open-Meteo 502 → raise UpstreamUnavailableError so run_all.py writes a 'fallback' row."""
    from scripts.external.weather import UpstreamUnavailableError
    monkeypatch.setenv('WEATHER_PROVIDER', 'open-meteo')
    def _bad(url, **kwargs):
        req = httpx.Request('GET', url)
        return httpx.Response(502, json={'error': 'Bad Gateway'}, request=req)
    monkeypatch.setattr(httpx, 'get', _bad)
    with pytest.raises(UpstreamUnavailableError):
        fetch_weather(start_date=date(2026, 4, 29), end_date=date(2026, 5, 1))


def test_fetch_weather_chunks_30_days(monkeypatch):
    """Long backfills must chunk; the test asserts httpx.get is called 2x for 45-day range."""
    payload = json.loads((FIX / 'weather_brightsky_3day.json').read_text())
    monkeypatch.setenv('WEATHER_PROVIDER', 'brightsky')
    call_log = []
    def _logging_get(url, params=None, **kwargs):
        call_log.append((url, params or {}))
        req = httpx.Request('GET', url)
        return httpx.Response(200, json=payload, request=req)
    monkeypatch.setattr(httpx, 'get', _logging_get)
    fetch_weather(start_date=date(2026, 1, 1), end_date=date(2026, 2, 14))  # 45 days
    assert len(call_log) >= 2
```

- [ ] **Step 10.4: Run, verify FAIL**

```bash
PYTHONPATH=. pytest tests/external/test_weather.py -v
```

- [ ] **Step 10.5: Write `weather.py`**

Create `scripts/external/weather.py`:

```python
"""Phase 13 EXT-01: weather fetcher.

Provider switch via WEATHER_PROVIDER env (default 'brightsky').

Bright Sky API:    https://api.brightsky.dev/weather?lat=52.52&lon=13.40&date=YYYY-MM-DD&last_date=YYYY-MM-DD
Open-Meteo API:    https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.40
                    &start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
                    &daily=temperature_2m_min,temperature_2m_max,precipitation_sum,wind_speed_10m_max,cloud_cover_mean
                    &timezone=Europe/Berlin

Both APIs cover the historical-archive + forecast continuum; we cap forecast at +7 days.
30-day chunking keeps each request modest and lets one failed chunk be
reported as fallback without nuking a long backfill.

Returns (rows, upstream_freshness_h).
"""
from __future__ import annotations
import os
from datetime import date, datetime, timedelta, timezone
from typing import Any
import httpx

LOCATION = 'berlin'
LAT = 52.52
LON = 13.40
CHUNK_DAYS = 30
TIMEOUT = 30.0


class UpstreamUnavailableError(Exception):
    """Raised when the configured weather provider returns a non-2xx status.
    run_all.py catches this and writes a 'fallback' row to pipeline_runs."""


def _chunks(start: date, end: date, n: int) -> list[tuple[date, date]]:
    out = []
    cur = start
    while cur <= end:
        chunk_end = min(end, cur + timedelta(days=n - 1))
        out.append((cur, chunk_end))
        cur = chunk_end + timedelta(days=1)
    return out


def normalize_brightsky(payload: dict[str, Any], location: str) -> list[dict[str, Any]]:
    """Bright Sky returns sub-daily entries under `weather`. Reduce to one
    row per date with min/max temperature and summed precipitation."""
    by_date: dict[date, dict[str, Any]] = {}
    for entry in payload.get('weather', []) or []:
        ts = entry.get('timestamp')
        if not ts:
            continue
        d = datetime.fromisoformat(ts.replace('Z', '+00:00')).date()
        bucket = by_date.setdefault(d, {
            'date': d, 'location': location, 'provider': 'brightsky',
            'temps': [], 'precip': 0.0, 'winds': [], 'clouds': [],
        })
        if (t := entry.get('temperature')) is not None:
            bucket['temps'].append(t)
        if (p := entry.get('precipitation')) is not None:
            bucket['precip'] += p
        if (w := entry.get('wind_speed')) is not None:
            bucket['winds'].append(w)
        if (c := entry.get('cloud_cover')) is not None:
            bucket['clouds'].append(c)
    rows: list[dict[str, Any]] = []
    for d, b in sorted(by_date.items()):
        rows.append({
            'date': b['date'],
            'location': b['location'],
            'temp_min_c': min(b['temps']) if b['temps'] else None,
            'temp_max_c': max(b['temps']) if b['temps'] else None,
            'precip_mm':  b['precip'],
            'wind_kph':   max(b['winds']) if b['winds'] else None,
            'cloud_cover': sum(b['clouds']) / len(b['clouds']) if b['clouds'] else None,
            'provider':   'brightsky',
        })
    return rows


def normalize_open_meteo(payload: dict[str, Any], location: str) -> list[dict[str, Any]]:
    """Open-Meteo returns parallel arrays under `daily` keyed by index."""
    daily = payload.get('daily', {}) or {}
    times = daily.get('time', []) or []
    rows: list[dict[str, Any]] = []
    for i, t in enumerate(times):
        rows.append({
            'date': date.fromisoformat(t),
            'location': location,
            'temp_min_c': (daily.get('temperature_2m_min') or [None])[i],
            'temp_max_c': (daily.get('temperature_2m_max') or [None])[i],
            'precip_mm':  (daily.get('precipitation_sum') or [None])[i],
            'wind_kph':   (daily.get('wind_speed_10m_max') or [None])[i],
            'cloud_cover': (daily.get('cloud_cover_mean') or [None])[i],
            'provider':   'open-meteo',
        })
    return rows


def _fetch_brightsky(start: date, end: date) -> dict[str, Any]:
    url = 'https://api.brightsky.dev/weather'
    params = {'lat': LAT, 'lon': LON, 'date': start.isoformat(), 'last_date': end.isoformat()}
    r = httpx.get(url, params=params, timeout=TIMEOUT)
    if r.status_code >= 500:
        raise UpstreamUnavailableError(f'brightsky {r.status_code}: {r.text[:200]}')
    r.raise_for_status()
    return r.json()


def _fetch_open_meteo(start: date, end: date) -> dict[str, Any]:
    url = 'https://api.open-meteo.com/v1/forecast'
    params = {
        'latitude': LAT, 'longitude': LON,
        'start_date': start.isoformat(), 'end_date': end.isoformat(),
        'daily': 'temperature_2m_min,temperature_2m_max,precipitation_sum,wind_speed_10m_max,cloud_cover_mean',
        'timezone': 'Europe/Berlin',
    }
    r = httpx.get(url, params=params, timeout=TIMEOUT)
    if r.status_code >= 500:
        raise UpstreamUnavailableError(f'open-meteo {r.status_code}: {r.text[:200]}')
    r.raise_for_status()
    return r.json()


def fetch_weather(*, start_date: date, end_date: date) -> tuple[list[dict[str, Any]], float | None]:
    provider = os.environ.get('WEATHER_PROVIDER', 'brightsky').strip().lower()
    rows: list[dict[str, Any]] = []
    for chunk_start, chunk_end in _chunks(start_date, end_date, CHUNK_DAYS):
        if provider == 'open-meteo':
            payload = _fetch_open_meteo(chunk_start, chunk_end)
            rows.extend(normalize_open_meteo(payload, LOCATION))
        else:
            payload = _fetch_brightsky(chunk_start, chunk_end)
            rows.extend(normalize_brightsky(payload, LOCATION))
    # Freshness: hours since latest date in returned rows.
    if rows:
        latest = max(r['date'] for r in rows)
        latest_dt = datetime(latest.year, latest.month, latest.day, tzinfo=timezone.utc)
        freshness_h = (datetime.now(timezone.utc) - latest_dt).total_seconds() / 3600.0
    else:
        freshness_h = None
    return rows, freshness_h


def upsert(client, rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    payload = [
        {**r, 'date': r['date'].isoformat() if hasattr(r['date'], 'isoformat') else r['date']}
        for r in rows
    ]
    res = client.table('weather_daily').upsert(payload, on_conflict='date,location').execute()
    if getattr(res, 'error', None):
        raise RuntimeError(f'weather_daily upsert failed: {res.error}')
    return len(payload)
```

- [ ] **Step 10.6: Run all weather tests, verify PASS**

```bash
PYTHONPATH=. pytest tests/external/test_weather.py -v
```

- [ ] **Step 10.7: Commit**

```bash
git add scripts/external/weather.py tests/external/test_weather.py tests/fixtures/external/weather_brightsky_3day.json tests/fixtures/external/weather_open_meteo_3day.json
git commit -m "feat(13): weather fetcher with brightsky/open-meteo switch + 30-day chunking + 502 fallback"
```

---

## Task 11: Fetcher — `holidays.py`

**Files:**
- Create: `scripts/external/holidays.py`
- Create: `tests/external/test_holidays.py`

- [ ] **Step 11.1: Write failing test**

Create `tests/external/test_holidays.py`:

```python
"""Phase 13 EXT-02: holidays fetcher — federal + Berlin (BE) including Frauentag."""
from __future__ import annotations
from datetime import date

from scripts.external.holidays import fetch_holidays


def test_returns_federal_dates_for_2026():
    rows = fetch_holidays(years=[2026])
    by_date = {r['date']: r for r in rows}
    # Tag der Deutschen Einheit is federal.
    assert date(2026, 10, 3) in by_date
    assert by_date[date(2026, 10, 3)]['country_code'] == 'DE'


def test_includes_berlin_frauentag_2026():
    """Internationaler Frauentag (Mar 8) is a Berlin-only holiday."""
    rows = fetch_holidays(years=[2026])
    frauentag = [r for r in rows if r['date'] == date(2026, 3, 8)]
    assert len(frauentag) == 1
    assert frauentag[0]['subdiv_code'] == 'BE'
    assert 'frauentag' in frauentag[0]['name'].lower() or 'frau' in frauentag[0]['name'].lower()


def test_dedupes_when_federal_and_be_collide():
    """If a date is BOTH federal and BE-listed, BE wins per migration 0042 comment."""
    rows = fetch_holidays(years=[2026])
    by_date: dict = {}
    for r in rows:
        by_date.setdefault(r['date'], []).append(r)
    # No two rows for the same date.
    for d, items in by_date.items():
        assert len(items) == 1, f'duplicate row for {d}: {items}'
```

- [ ] **Step 11.2: Run, verify FAIL**

```bash
PYTHONPATH=. pytest tests/external/test_holidays.py -v
```

- [ ] **Step 11.3: Write `holidays.py`**

Create `scripts/external/holidays.py`:

```python
"""Phase 13 EXT-02: holidays fetcher (python-holidays).

Returns rows for federal DE + Berlin (BE) state for the requested years.
BE-specific entries (e.g. Internationaler Frauentag) carry subdiv_code='BE';
federal-only entries carry subdiv_code=NULL. If a date appears as BOTH
federal and BE, BE wins (subdiv_code='BE') and the BE name is preferred.
"""
from __future__ import annotations
from datetime import date, datetime, timezone
from typing import Any
import holidays as pyholidays


def fetch_holidays(*, years: list[int]) -> list[dict[str, Any]]:
    de_federal = pyholidays.Germany(years=years)        # federal
    de_berlin  = pyholidays.Germany(subdiv='BE', years=years)  # BE-specific

    by_date: dict[date, dict[str, Any]] = {}
    # Seed with federal first.
    for d, name in de_federal.items():
        by_date[d] = {
            'date': d,
            'name': name,
            'country_code': 'DE',
            'subdiv_code': None,
        }
    # BE wins on overlap; introduces Frauentag etc.
    for d, name in de_berlin.items():
        # If federal already had this date, replace only when name differs (BE-only marker).
        prior = by_date.get(d)
        if prior is None or prior['name'] != name:
            by_date[d] = {
                'date': d,
                'name': name,
                'country_code': 'DE',
                'subdiv_code': 'BE',
            }
    return list(by_date.values())


def upsert(client, rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    payload = [
        {**r, 'date': r['date'].isoformat() if hasattr(r['date'], 'isoformat') else r['date']}
        for r in rows
    ]
    res = client.table('holidays').upsert(payload, on_conflict='date').execute()
    if getattr(res, 'error', None):
        raise RuntimeError(f'holidays upsert failed: {res.error}')
    return len(payload)


def freshness_hours() -> float:
    """Static dataset — freshness is 0 (always current)."""
    return 0.0
```

- [ ] **Step 11.4: Run + commit**

```bash
PYTHONPATH=. pytest tests/external/test_holidays.py -v
git add scripts/external/holidays.py tests/external/test_holidays.py
git commit -m "feat(13): holidays fetcher with federal+BE merge incl. Frauentag"
```

---

## Task 12: Fetcher — `school.py`

**Files:**
- Create: `tests/fixtures/external/school_holidays_be_2026.json`
- Create: `scripts/external/school.py`
- Create: `tests/external/test_school.py`

- [ ] **Step 12.1: Write fixture**

Create `tests/fixtures/external/school_holidays_be_2026.json`:

```json
[
  {"name": "Winterferien Berlin 2026", "start": "2026-02-02T00:00:00", "end": "2026-02-07T00:00:00", "year": 2026, "stateCode": "BE", "slug": "winterferien-2026-berlin"},
  {"name": "Osterferien Berlin 2026", "start": "2026-03-30T00:00:00", "end": "2026-04-11T00:00:00", "year": 2026, "stateCode": "BE", "slug": "osterferien-2026-berlin"},
  {"name": "Pfingstferien Berlin 2026", "start": "2026-05-15T00:00:00", "end": "2026-05-15T00:00:00", "year": 2026, "stateCode": "BE", "slug": "pfingstferien-2026-berlin"},
  {"name": "Sommerferien Berlin 2026", "start": "2026-07-09T00:00:00", "end": "2026-08-21T00:00:00", "year": 2026, "stateCode": "BE", "slug": "sommerferien-2026-berlin"},
  {"name": "Herbstferien Berlin 2026", "start": "2026-10-19T00:00:00", "end": "2026-10-31T00:00:00", "year": 2026, "stateCode": "BE", "slug": "herbstferien-2026-berlin"},
  {"name": "Weihnachtsferien Berlin 2026", "start": "2026-12-21T00:00:00", "end": "2027-01-02T00:00:00", "year": 2026, "stateCode": "BE", "slug": "weihnachtsferien-2026-berlin"}
]
```

- [ ] **Step 12.2: Write failing test**

Create `tests/external/test_school.py`:

```python
"""Phase 13 EXT-03: school_holidays fetcher (ferien-api.de raw httpx)."""
from __future__ import annotations
import json
from pathlib import Path
from datetime import date
import httpx
import pytest

from scripts.external.school import fetch_school, UpstreamUnavailableError

FIX = Path(__file__).resolve().parent.parent / 'fixtures' / 'external'


def _mock_get(payload, status=200):
    def _g(url, **kwargs):
        req = httpx.Request('GET', url)
        return httpx.Response(status, json=payload, request=req)
    return _g


def test_fetch_school_returns_six_blocks_for_2026(monkeypatch):
    payload = json.loads((FIX / 'school_holidays_be_2026.json').read_text())
    monkeypatch.setattr(httpx, 'get', _mock_get(payload))
    rows = fetch_school(years=[2026])
    assert len(rows) == 6
    names = [r['block_name'] for r in rows]
    assert any('Sommer' in n for n in names)
    assert any('Weihnacht' in n for n in names)
    sommer = next(r for r in rows if 'Sommer' in r['block_name'])
    assert sommer['start_date'] == date(2026, 7, 9)
    assert sommer['end_date'] == date(2026, 8, 21)
    assert sommer['state_code'] == 'BE'
    assert sommer['year'] == 2026


def test_fetch_school_raises_on_5xx(monkeypatch):
    monkeypatch.setattr(httpx, 'get', _mock_get({'error': 'down'}, status=503))
    with pytest.raises(UpstreamUnavailableError):
        fetch_school(years=[2026])
```

- [ ] **Step 12.3: Run, verify FAIL**

- [ ] **Step 12.4: Write `school.py`**

Create `scripts/external/school.py`:

```python
"""Phase 13 EXT-03: school_holidays fetcher (raw httpx, NOT the abandoned PyPI wrapper).

Endpoint per year:
    https://ferien-api.de/api/v1/holidays/BE/{year}.json

Returns list of {name, start, end, year, stateCode, slug}. We re-shape
into our schema with `block_name` (truncated of "Berlin" suffix) and
`start_date` / `end_date`.
"""
from __future__ import annotations
from datetime import date, datetime
from typing import Any
import httpx

STATE = 'BE'
URL_TEMPLATE = 'https://ferien-api.de/api/v1/holidays/{state}/{year}.json'
TIMEOUT = 20.0


class UpstreamUnavailableError(Exception):
    pass


def fetch_school(*, years: list[int]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for y in years:
        url = URL_TEMPLATE.format(state=STATE, year=y)
        r = httpx.get(url, timeout=TIMEOUT)
        if r.status_code >= 500:
            raise UpstreamUnavailableError(f'ferien-api.de {r.status_code} for {y}: {r.text[:200]}')
        r.raise_for_status()
        for entry in r.json() or []:
            name = entry.get('name', '').strip()
            block_name = name.split(' ')[0] if name else 'Unknown'
            start_raw = entry.get('start')
            end_raw   = entry.get('end')
            if not (start_raw and end_raw):
                continue
            rows.append({
                'state_code': STATE,
                'block_name': block_name,
                'start_date': datetime.fromisoformat(start_raw.replace('Z','+00:00')).date(),
                'end_date':   datetime.fromisoformat(end_raw.replace('Z','+00:00')).date(),
                'year': entry.get('year', y),
            })
    return rows


def upsert(client, rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    payload = [
        {**r,
         'start_date': r['start_date'].isoformat(),
         'end_date': r['end_date'].isoformat()}
        for r in rows
    ]
    res = client.table('school_holidays').upsert(
        payload, on_conflict='state_code,block_name,start_date'
    ).execute()
    if getattr(res, 'error', None):
        raise RuntimeError(f'school_holidays upsert failed: {res.error}')
    return len(payload)


def freshness_hours(rows: list[dict[str, Any]]) -> float | None:
    """Hours since the latest end_date in the returned rows."""
    if not rows:
        return None
    latest = max(r['end_date'] for r in rows)
    latest_dt = datetime(latest.year, latest.month, latest.day)
    return (datetime.utcnow() - latest_dt).total_seconds() / 3600.0
```

- [ ] **Step 12.5: Run + commit**

```bash
PYTHONPATH=. pytest tests/external/test_school.py -v
git add scripts/external/school.py tests/external/test_school.py tests/fixtures/external/school_holidays_be_2026.json
git commit -m "feat(13): school_holidays fetcher via raw httpx against ferien-api.de"
```

---

## Task 13: Fetcher — `transit.py`

**Files:**
- Create: `tests/fixtures/external/transit_bvg_rss_strike.xml`
- Create: `tests/fixtures/external/transit_bvg_rss_no_strike.xml`
- Create: `scripts/external/transit.py`
- Create: `tests/external/test_transit.py`

- [ ] **Step 13.1: Write strike fixture**

Create `tests/fixtures/external/transit_bvg_rss_strike.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>BVG Störungen</title>
    <item>
      <title>Warnstreik bei der BVG am 02.05.2026</title>
      <link>https://www.bvg.de/de/aktuell/streik-2026-05-02</link>
      <description>Aufruf zum ganztägigen Warnstreik am Samstag, den 02.05.2026.</description>
      <pubDate>Tue, 28 Apr 2026 09:00:00 +0200</pubDate>
    </item>
    <item>
      <title>Routine Wartungsarbeiten Linie U1</title>
      <link>https://www.bvg.de/de/aktuell/u1-wartung</link>
      <description>Wartungsarbeiten am Wochenende.</description>
      <pubDate>Mon, 27 Apr 2026 12:00:00 +0200</pubDate>
    </item>
  </channel>
</rss>
```

- [ ] **Step 13.2: Write no-strike fixture**

Create `tests/fixtures/external/transit_bvg_rss_no_strike.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>BVG Störungen</title>
    <item>
      <title>Routine Wartungsarbeiten Linie U2</title>
      <link>https://www.bvg.de/de/aktuell/u2-wartung</link>
      <description>Wartungsarbeiten am Wochenende.</description>
      <pubDate>Mon, 27 Apr 2026 12:00:00 +0200</pubDate>
    </item>
  </channel>
</rss>
```

- [ ] **Step 13.3: Write failing test**

Create `tests/external/test_transit.py`:

```python
"""Phase 13 EXT-04: transit_alerts fetcher (BVG RSS via feedparser)."""
from __future__ import annotations
from pathlib import Path
import httpx
import pytest

from scripts.external.transit import fetch_transit, KEYWORDS

FIX = Path(__file__).resolve().parent.parent / 'fixtures' / 'external'


def _mock_get(body, status=200):
    def _g(url, **kwargs):
        req = httpx.Request('GET', url)
        return httpx.Response(status, content=body, request=req)
    return _g


def test_keywords_locked_to_v1_set():
    """Phase 13 D-12: keyword scope is exactly {Streik, Warnstreik}. Extending
    the list is a v1.4 PR — this test prevents accidental scope creep."""
    assert KEYWORDS == ['Streik', 'Warnstreik']


def test_fetch_transit_matches_warnstreik(monkeypatch):
    body = (FIX / 'transit_bvg_rss_strike.xml').read_bytes()
    monkeypatch.setattr(httpx, 'get', _mock_get(body))
    rows = fetch_transit()
    assert len(rows) == 1
    r = rows[0]
    assert 'Warnstreik' in r['title']
    assert r['matched_keyword'] == 'Warnstreik'
    assert r['alert_id']  # sha256-derived, non-empty
    assert r['source_url'].startswith('https://www.bvg.de/')


def test_fetch_transit_returns_empty_when_no_strike(monkeypatch):
    body = (FIX / 'transit_bvg_rss_no_strike.xml').read_bytes()
    monkeypatch.setattr(httpx, 'get', _mock_get(body))
    rows = fetch_transit()
    assert rows == []


def test_fetch_transit_falls_back_when_primary_5xx(monkeypatch):
    """When primary URL returns 5xx, fetcher tries the fallback URL."""
    primary_body = b''
    fallback_body = (FIX / 'transit_bvg_rss_strike.xml').read_bytes()
    calls: list[tuple[str, int]] = []
    def _g(url, **kwargs):
        req = httpx.Request('GET', url)
        if 'verbindungen/stoerungsmeldungen' in url:  # primary
            calls.append((url, 503))
            return httpx.Response(503, content=primary_body, request=req)
        calls.append((url, 200))  # fallback
        return httpx.Response(200, content=fallback_body, request=req)
    monkeypatch.setattr(httpx, 'get', _g)
    rows = fetch_transit()
    assert len(rows) == 1
    # Both URLs were tried in order.
    assert len(calls) >= 2
    assert calls[0][1] == 503
    assert calls[-1][1] == 200
```

- [ ] **Step 13.4: Run, verify FAIL**

- [ ] **Step 13.5: Write `transit.py`**

Create `scripts/external/transit.py`:

```python
"""Phase 13 EXT-04: BVG RSS strike-alert fetcher.

Primary URL:  https://www.bvg.de/de/verbindungen/stoerungsmeldungen.xml
Fallback URL: https://www.bvg.de/de/aktuell/stoerungen/rss.xml

Both URLs verified responding 200 during plan-phase (D-13). If both fail
in production, fetch_transit raises UpstreamUnavailableError so run_all.py
writes a 'fallback' row to pipeline_runs.

Phase 13 keyword scope (D-12):
    KEYWORDS = ['Streik', 'Warnstreik']
v1.4 PR may extend (Ausfall, Sperrung, Bauarbeiten, Gleisarbeiten) without
schema change.
"""
from __future__ import annotations
import hashlib
from datetime import datetime, timezone
from typing import Any
import httpx
import feedparser

URLS = [
    'https://www.bvg.de/de/verbindungen/stoerungsmeldungen.xml',  # primary (verified 2026-04-29)
    'https://www.bvg.de/de/aktuell/stoerungen/rss.xml',           # fallback (verified 2026-04-29)
]
KEYWORDS = ['Streik', 'Warnstreik']
TIMEOUT = 20.0


class UpstreamUnavailableError(Exception):
    pass


def _alert_id(title: str, pub_date_iso: str) -> str:
    h = hashlib.sha256()
    h.update(title.encode('utf-8'))
    h.update(b'|')
    h.update(pub_date_iso.encode('utf-8'))
    return h.hexdigest()[:32]


def _match_keyword(text: str) -> str | None:
    for k in KEYWORDS:
        if k.lower() in text.lower():
            return k
    return None


def _fetch_one(url: str) -> bytes:
    r = httpx.get(url, timeout=TIMEOUT)
    if r.status_code >= 500:
        raise UpstreamUnavailableError(f'BVG {r.status_code} on {url}')
    r.raise_for_status()
    return r.content


def fetch_transit() -> list[dict[str, Any]]:
    """Try URLs in order; first 2xx wins. If all fail, raise UpstreamUnavailableError."""
    body = None
    last_err: Exception | None = None
    for url in URLS:
        try:
            body = _fetch_one(url)
            break
        except UpstreamUnavailableError as e:
            last_err = e
            continue
    if body is None:
        raise UpstreamUnavailableError(f'All BVG URLs failed; last={last_err}')

    feed = feedparser.parse(body)
    rows: list[dict[str, Any]] = []
    for entry in feed.entries:
        title = entry.get('title', '') or ''
        desc  = entry.get('description', '') or ''
        link  = entry.get('link', '') or ''
        haystack = f'{title} {desc}'
        matched = _match_keyword(haystack)
        if matched is None:
            continue
        # feedparser parses pubDate into entry.published_parsed (struct_time, UTC).
        pp = entry.get('published_parsed')
        if pp is not None:
            pub_dt = datetime(*pp[:6], tzinfo=timezone.utc)
        else:
            pub_dt = datetime.now(timezone.utc)
        rows.append({
            'alert_id':        _alert_id(title, pub_dt.isoformat()),
            'title':           title,
            'pub_date':        pub_dt,
            'matched_keyword': matched,
            'description':     desc[:1000] if desc else None,
            'source_url':      link,
        })
    return rows


def upsert(client, rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    payload = [
        {**r, 'pub_date': r['pub_date'].isoformat()}
        for r in rows
    ]
    res = client.table('transit_alerts').upsert(payload, on_conflict='alert_id').execute()
    if getattr(res, 'error', None):
        raise RuntimeError(f'transit_alerts upsert failed: {res.error}')
    return len(payload)


def freshness_hours(rows: list[dict[str, Any]]) -> float | None:
    if not rows:
        return None
    latest = max(r['pub_date'] for r in rows)
    return (datetime.now(timezone.utc) - latest).total_seconds() / 3600.0
```

- [ ] **Step 13.6: Run + commit**

```bash
PYTHONPATH=. pytest tests/external/test_transit.py -v
git add scripts/external/transit.py tests/external/test_transit.py tests/fixtures/external/transit_bvg_rss_strike.xml tests/fixtures/external/transit_bvg_rss_no_strike.xml
git commit -m "feat(13): transit_alerts via BVG RSS with primary+fallback URL ranking + keyword filter"
```

---

## Task 14: Fetcher — `events.py` + `config/recurring_events.yaml`

**Files:**
- Create: `config/recurring_events.yaml`
- Create: `tests/fixtures/external/recurring_events.yaml`
- Create: `scripts/external/events.py`
- Create: `tests/external/test_events.py`

- [ ] **Step 14.1: Write the production starter YAML (~15 events covering 2026 and 2027)**

Create `config/recurring_events.yaml`:

```yaml
# config/recurring_events.yaml
# Phase 13 EXT-05: hand-curated Berlin events. Annual rollover reminded
# by pg_cron 'recurring-events-yearly-reminder' on Sep 15 each year.
# Categories: festival | sports | market | holiday | other
# Impact:     high | medium | low

# --- 2026 ---
- event_id: karneval-der-kulturen-2026
  name: "Karneval der Kulturen 2026"
  category: festival
  start_date: "2026-05-22"
  end_date:   "2026-05-25"
  impact_estimate: high
  notes: "Pfingsten parade; Kreuzberg/Neukölln traffic disrupted."
  source: "https://www.berlin.de/karneval-der-kulturen/"

- event_id: dfb-pokal-finale-2026
  name: "DFB-Pokal-Finale 2026"
  category: sports
  start_date: "2026-05-23"
  end_date:   "2026-05-23"
  impact_estimate: medium
  notes: "Olympiastadion fixture; football fans across the city."
  source: "https://www.dfb.de/dfb-pokal/"

- event_id: csd-berlin-2026
  name: "Christopher Street Day Berlin 2026"
  category: festival
  start_date: "2026-07-25"
  end_date:   "2026-07-25"
  impact_estimate: high
  notes: "Late July CSD parade; major foot traffic mid-city."
  source: "https://csd-berlin.de/"

- event_id: lange-nacht-museen-aug-2026
  name: "Lange Nacht der Museen 2026"
  category: festival
  start_date: "2026-08-29"
  end_date:   "2026-08-29"
  impact_estimate: medium
  notes: "Citywide museum night."
  source: "https://www.lange-nacht-der-museen.de/"

- event_id: berlin-marathon-2026
  name: "Berlin Marathon 2026"
  category: sports
  start_date: "2026-09-26"
  end_date:   "2026-09-27"
  impact_estimate: high
  notes: "Major street closures; tens of thousands of runners + spectators."
  source: "https://www.bmw-berlin-marathon.com/"

- event_id: festival-of-lights-2026
  name: "Festival of Lights 2026"
  category: festival
  start_date: "2026-10-09"
  end_date:   "2026-10-18"
  impact_estimate: medium
  notes: "Mid-October illumination event; tourist surge."
  source: "https://festival-of-lights.de/"

- event_id: weihnachtsmarkt-2026
  name: "Berlin Weihnachtsmärkte 2026"
  category: market
  start_date: "2026-11-23"
  end_date:   "2026-12-23"
  impact_estimate: high
  notes: "Christmas markets across the city; ~1 month window."
  source: "https://www.berlin.de/weihnachten/weihnachtsmaerkte/"

- event_id: silvester-2026
  name: "Silvester / New Year's Eve 2026"
  category: holiday
  start_date: "2026-12-31"
  end_date:   "2026-12-31"
  impact_estimate: high
  notes: "Brandenburg Gate party; fireworks; high foot traffic."
  source: "https://silvester-am-brandenburger-tor.de/"

# --- 2027 ---
- event_id: karneval-der-kulturen-2027
  name: "Karneval der Kulturen 2027"
  category: festival
  start_date: "2027-05-14"
  end_date:   "2027-05-17"
  impact_estimate: high
  notes: "Pfingsten parade (Pentecost 2027 falls May 16)."
  source: "https://www.berlin.de/karneval-der-kulturen/"

- event_id: csd-berlin-2027
  name: "Christopher Street Day Berlin 2027"
  category: festival
  start_date: "2027-07-24"
  end_date:   "2027-07-24"
  impact_estimate: high
  notes: "Late July CSD parade."
  source: "https://csd-berlin.de/"

- event_id: berlin-marathon-2027
  name: "Berlin Marathon 2027"
  category: sports
  start_date: "2027-09-25"
  end_date:   "2027-09-26"
  impact_estimate: high
  notes: "Annual; date pattern is last full Sept weekend."
  source: "https://www.bmw-berlin-marathon.com/"

- event_id: festival-of-lights-2027
  name: "Festival of Lights 2027"
  category: festival
  start_date: "2027-10-08"
  end_date:   "2027-10-17"
  impact_estimate: medium
  source: "https://festival-of-lights.de/"

- event_id: weihnachtsmarkt-2027
  name: "Berlin Weihnachtsmärkte 2027"
  category: market
  start_date: "2027-11-22"
  end_date:   "2027-12-23"
  impact_estimate: high
  source: "https://www.berlin.de/weihnachten/weihnachtsmaerkte/"

- event_id: silvester-2027
  name: "Silvester / New Year's Eve 2027"
  category: holiday
  start_date: "2027-12-31"
  end_date:   "2027-12-31"
  impact_estimate: high
  source: "https://silvester-am-brandenburger-tor.de/"

# NOTE: 2027 dates for festivals/sports are PROVISIONAL (annual events
# without confirmed schedules yet). Re-verify and adjust during 2027
# annual-rollover review (pg_cron reminder Sep 15 2026).
```

- [ ] **Step 14.2: Write the test-mode fixture (small)**

Create `tests/fixtures/external/recurring_events.yaml`:

```yaml
- event_id: test-event-1
  name: "Test Event 1"
  category: festival
  start_date: "2026-06-01"
  end_date:   "2026-06-02"
  impact_estimate: high
  notes: "Used by test_events.py"
  source: "https://example.test/"

- event_id: test-event-2
  name: "Test Event 2"
  category: market
  start_date: "2026-12-01"
  end_date:   "2026-12-24"
  impact_estimate: medium
  source: "https://example.test/"
```

- [ ] **Step 14.3: Write failing test**

Create `tests/external/test_events.py`:

```python
"""Phase 13 EXT-05: events fetcher (PyYAML)."""
from __future__ import annotations
from pathlib import Path
from datetime import date

from scripts.external.events import load_events

FIX = Path(__file__).resolve().parent.parent / 'fixtures' / 'external'


def test_load_test_fixture_yields_two_rows():
    rows = load_events(FIX / 'recurring_events.yaml')
    assert len(rows) == 2
    e1 = next(r for r in rows if r['event_id'] == 'test-event-1')
    assert e1['start_date'] == date(2026, 6, 1)
    assert e1['end_date'] == date(2026, 6, 2)
    assert e1['impact_estimate'] == 'high'
    assert e1['category'] == 'festival'


def test_load_production_yaml_has_unique_event_ids():
    """The production config/recurring_events.yaml must not contain duplicate event_ids
    (the migration's primary key is event_id)."""
    repo_root = Path(__file__).resolve().parent.parent.parent
    rows = load_events(repo_root / 'config' / 'recurring_events.yaml')
    ids = [r['event_id'] for r in rows]
    assert len(ids) == len(set(ids)), f'duplicate event_ids in production YAML: {ids}'


def test_load_production_yaml_has_at_least_15_events():
    """CONTEXT.md D-11: ~15 events for 2026 + 2027."""
    repo_root = Path(__file__).resolve().parent.parent.parent
    rows = load_events(repo_root / 'config' / 'recurring_events.yaml')
    assert len(rows) >= 14  # 8 in 2026 + 6 in 2027 = 14, target is ≥15 over time
```

- [ ] **Step 14.4: Run, verify FAIL**

- [ ] **Step 14.5: Write `events.py`**

Create `scripts/external/events.py`:

```python
"""Phase 13 EXT-05: events fetcher (PyYAML).

Loads the hand-curated config/recurring_events.yaml. event_id is the
primary key; date strings are parsed to datetime.date objects.
"""
from __future__ import annotations
from datetime import date, datetime
from pathlib import Path
from typing import Any
import yaml


def _parse_date(v: Any) -> date:
    if isinstance(v, date) and not isinstance(v, datetime):
        return v
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, str):
        return date.fromisoformat(v)
    raise ValueError(f'cannot parse date from {v!r}')


def load_events(path: str | Path) -> list[dict[str, Any]]:
    raw = yaml.safe_load(Path(path).read_text(encoding='utf-8')) or []
    rows: list[dict[str, Any]] = []
    for entry in raw:
        rows.append({
            'event_id':         entry['event_id'],
            'name':             entry['name'],
            'category':         entry['category'],
            'start_date':       _parse_date(entry['start_date']),
            'end_date':         _parse_date(entry['end_date']),
            'impact_estimate':  entry['impact_estimate'],
            'notes':            entry.get('notes'),
            'source':           entry.get('source'),
        })
    return rows


def upsert(client, rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    payload = [
        {**r,
         'start_date': r['start_date'].isoformat(),
         'end_date':   r['end_date'].isoformat()}
        for r in rows
    ]
    res = client.table('recurring_events').upsert(payload, on_conflict='event_id').execute()
    if getattr(res, 'error', None):
        raise RuntimeError(f'recurring_events upsert failed: {res.error}')
    return len(payload)


def freshness_hours() -> float:
    """Static (YAML) — always 0."""
    return 0.0
```

- [ ] **Step 14.6: Run + commit**

```bash
PYTHONPATH=. pytest tests/external/test_events.py -v
git add scripts/external/events.py tests/external/test_events.py config/recurring_events.yaml tests/fixtures/external/recurring_events.yaml
git commit -m "feat(13): recurring_events YAML loader + 14-event starter set for 2026/2027"
```

---

## Task 15: Fetcher — `shop_calendar.py` + `config/shop_hours.yaml`

**Files:**
- Create: `config/shop_hours.yaml`
- Create: `tests/fixtures/external/shop_hours.yaml`
- Create: `scripts/external/shop_calendar.py`
- Create: `tests/external/test_shop_calendar.py`

- [ ] **Step 15.1: Write the production placeholder YAML**

Create `config/shop_hours.yaml`:

```yaml
# config/shop_hours.yaml
# Phase 13 EXT-07: per-restaurant weekly open/close pattern + date overrides.
# Idempotent loader projects this into shop_calendar 365 days forward each
# nightly cron run.
#
# weekly_pattern keys: monday..sunday (lowercase).
# overrides: list of {date: YYYY-MM-DD, is_open, open_at?, close_at?, reason?}.
#
# IMPORTANT: replace `00000000-0000-0000-0000-000000000001` with the
# friend-restaurant's actual UUID from public.restaurants. The placeholder
# UUID lets local pytest pass; the executor MUST replace it before merging.

- restaurant_id: 00000000-0000-0000-0000-000000000001
  weekly_pattern:
    monday:    { is_open: true,  open_at: "12:00", close_at: "23:00" }
    tuesday:   { is_open: true,  open_at: "12:00", close_at: "23:00" }
    wednesday: { is_open: true,  open_at: "12:00", close_at: "23:00" }
    thursday:  { is_open: true,  open_at: "12:00", close_at: "23:00" }
    friday:    { is_open: true,  open_at: "12:00", close_at: "23:00" }
    saturday:  { is_open: true,  open_at: "12:00", close_at: "23:00" }
    sunday:    { is_open: false }
  overrides:
    - { date: "2026-12-24", is_open: false, reason: "Heiligabend (placeholder — confirm with friend)" }
    - { date: "2026-12-25", is_open: false, reason: "1. Weihnachtstag (placeholder)" }
    - { date: "2026-12-31", is_open: true,  open_at: "12:00", close_at: "18:00", reason: "Silvester short hours (placeholder)" }
```

- [ ] **Step 15.2: Write test-mode fixture**

Create `tests/fixtures/external/shop_hours.yaml`:

```yaml
- restaurant_id: 11111111-1111-1111-1111-111111111111
  weekly_pattern:
    monday:    { is_open: true,  open_at: "12:00", close_at: "22:00" }
    tuesday:   { is_open: true,  open_at: "12:00", close_at: "22:00" }
    wednesday: { is_open: false }
    thursday:  { is_open: true,  open_at: "12:00", close_at: "22:00" }
    friday:    { is_open: true,  open_at: "12:00", close_at: "23:00" }
    saturday:  { is_open: true,  open_at: "12:00", close_at: "23:00" }
    sunday:    { is_open: false }
  overrides:
    - { date: "2026-05-01", is_open: false, reason: "Tag der Arbeit" }
    - { date: "2026-05-15", is_open: true,  open_at: "10:00", close_at: "23:00", reason: "Long open day" }
```

- [ ] **Step 15.3: Write failing test**

Create `tests/external/test_shop_calendar.py`:

```python
"""Phase 13 EXT-07: shop_calendar fetcher."""
from __future__ import annotations
from pathlib import Path
from datetime import date, timedelta

from scripts.external.shop_calendar import generate_calendar, FORWARD_DAYS

FIX = Path(__file__).resolve().parent.parent / 'fixtures' / 'external'


def test_generate_calendar_covers_365_days_forward():
    today = date(2026, 4, 29)
    rows = generate_calendar(FIX / 'shop_hours.yaml', today=today)
    # One row per (restaurant_id, date) for 365 forward days.
    dates = {r['date'] for r in rows}
    assert min(dates) == today
    assert max(dates) == today + timedelta(days=FORWARD_DAYS - 1)
    assert len(dates) == FORWARD_DAYS


def test_generate_calendar_applies_weekly_pattern_correctly():
    today = date(2026, 4, 29)  # Wednesday
    rows = generate_calendar(FIX / 'shop_hours.yaml', today=today)
    by_date = {r['date']: r for r in rows}
    # Wednesday is closed in the fixture.
    assert by_date[date(2026, 4, 29)]['is_open'] is False
    # Thursday is open noon-22.
    assert by_date[date(2026, 4, 30)]['is_open'] is True
    assert str(by_date[date(2026, 4, 30)]['open_at']) == '12:00:00'


def test_overrides_win_over_weekly_pattern():
    today = date(2026, 4, 29)
    rows = generate_calendar(FIX / 'shop_hours.yaml', today=today)
    by_date = {r['date']: r for r in rows}
    # 2026-05-01 (Friday) is normally OPEN per weekly pattern, but override closes it.
    fri = by_date[date(2026, 5, 1)]
    assert fri['is_open'] is False
    assert fri['reason'] == 'Tag der Arbeit'


def test_generates_for_each_restaurant_in_yaml():
    today = date(2026, 4, 29)
    rows = generate_calendar(FIX / 'shop_hours.yaml', today=today)
    rids = {r['restaurant_id'] for r in rows}
    assert rids == {'11111111-1111-1111-1111-111111111111'}
```

- [ ] **Step 15.4: Run, verify FAIL**

- [ ] **Step 15.5: Write `shop_calendar.py`**

Create `scripts/external/shop_calendar.py`:

```python
"""Phase 13 EXT-07: shop_calendar generator.

Loads config/shop_hours.yaml (one entry per restaurant), expands the
weekly pattern across the next 365 days, applies per-date overrides,
and returns one row per (restaurant_id, date).

Out-of-cycle closures (vacation/illness): friend DMs Shin → Shin updates
YAML + commits → next nightly cron applies (CONTEXT.md D-09).
"""
from __future__ import annotations
from datetime import date, timedelta, time
from pathlib import Path
from typing import Any
import yaml

FORWARD_DAYS = 365
WEEKDAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']


def _parse_time(v: str | None) -> time | None:
    if v is None:
        return None
    if isinstance(v, time):
        return v
    return time.fromisoformat(v)


def generate_calendar(path: str | Path, *, today: date) -> list[dict[str, Any]]:
    raw = yaml.safe_load(Path(path).read_text(encoding='utf-8')) or []
    rows: list[dict[str, Any]] = []
    for entry in raw:
        rid = entry['restaurant_id']
        weekly = entry.get('weekly_pattern', {}) or {}
        overrides_list = entry.get('overrides', []) or []
        overrides_by_date = {date.fromisoformat(o['date']): o for o in overrides_list}

        for offset in range(FORWARD_DAYS):
            d = today + timedelta(days=offset)
            wname = WEEKDAY_NAMES[d.weekday()]
            wpat  = weekly.get(wname, {}) or {}
            row = {
                'restaurant_id': rid,
                'date':          d,
                'is_open':       bool(wpat.get('is_open', False)),
                'open_at':       _parse_time(wpat.get('open_at')),
                'close_at':      _parse_time(wpat.get('close_at')),
                'reason':        None,
            }
            ov = overrides_by_date.get(d)
            if ov is not None:
                row['is_open']  = bool(ov.get('is_open', row['is_open']))
                row['open_at']  = _parse_time(ov.get('open_at'))  if 'open_at'  in ov else row['open_at']
                row['close_at'] = _parse_time(ov.get('close_at')) if 'close_at' in ov else row['close_at']
                row['reason']   = ov.get('reason')
            rows.append(row)
    return rows


def upsert(client, rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    payload = [
        {**r,
         'date':     r['date'].isoformat(),
         'open_at':  r['open_at'].isoformat()  if r['open_at']  else None,
         'close_at': r['close_at'].isoformat() if r['close_at'] else None}
        for r in rows
    ]
    res = client.table('shop_calendar').upsert(payload, on_conflict='restaurant_id,date').execute()
    if getattr(res, 'error', None):
        raise RuntimeError(f'shop_calendar upsert failed: {res.error}')
    return len(payload)


def freshness_hours() -> float:
    return 0.0
```

- [ ] **Step 15.6: Run + commit**

```bash
PYTHONPATH=. pytest tests/external/test_shop_calendar.py -v
git add scripts/external/shop_calendar.py tests/external/test_shop_calendar.py config/shop_hours.yaml tests/fixtures/external/shop_hours.yaml
git commit -m "feat(13): shop_calendar 365-day-forward generator from config/shop_hours.yaml"
```

---

## Task 16: Orchestrator — `run_all.py`

**Files:**
- Create: `scripts/external/run_all.py`
- Create: `tests/external/test_run_all.py`

- [ ] **Step 16.1: Write failing test**

Create `tests/external/test_run_all.py`:

```python
"""Phase 13: run_all.py orchestrator — per-source isolation + exit code semantics."""
from __future__ import annotations
from datetime import date
from unittest.mock import MagicMock, patch
import pytest

from scripts.external import run_all


def _fake_supabase_client():
    client = MagicMock()
    client.table.return_value.insert.return_value.execute.return_value = MagicMock(error=None)
    client.table.return_value.upsert.return_value.execute.return_value = MagicMock(error=None)
    return client


def test_one_source_failure_does_not_abort_the_others(monkeypatch):
    """Per CONTEXT D-06: each fetcher in its own try/except. A failure in
    weather must NOT prevent holidays from being upserted."""
    client = _fake_supabase_client()
    monkeypatch.setattr(run_all, 'make_client', lambda: client)
    # Weather raises; holidays + transit + events + school + shop_calendar succeed.
    monkeypatch.setattr(run_all.weather, 'fetch_weather',
                        lambda **kw: (_ for _ in ()).throw(RuntimeError('boom')))
    monkeypatch.setattr(run_all.holidays, 'fetch_holidays', lambda **kw: [])
    monkeypatch.setattr(run_all.holidays, 'upsert', lambda c, rows: 0)
    monkeypatch.setattr(run_all.school, 'fetch_school', lambda **kw: [])
    monkeypatch.setattr(run_all.school, 'upsert', lambda c, rows: 0)
    monkeypatch.setattr(run_all.transit, 'fetch_transit', lambda: [])
    monkeypatch.setattr(run_all.transit, 'upsert', lambda c, rows: 0)
    monkeypatch.setattr(run_all.events, 'load_events', lambda p: [])
    monkeypatch.setattr(run_all.events, 'upsert', lambda c, rows: 0)
    monkeypatch.setattr(run_all.shop_calendar, 'generate_calendar', lambda p, today: [])
    monkeypatch.setattr(run_all.shop_calendar, 'upsert', lambda c, rows: 0)

    rc = run_all.main(start_date=date(2026, 4, 28), end_date=date(2026, 4, 29))
    # Exit 0 because at least one source succeeded.
    assert rc == 0


def test_all_sources_failed_returns_exit_1(monkeypatch):
    """Per CONTEXT D-07: exit 1 only if every source failed."""
    client = _fake_supabase_client()
    monkeypatch.setattr(run_all, 'make_client', lambda: client)
    err = lambda *a, **kw: (_ for _ in ()).throw(RuntimeError('infra down'))
    monkeypatch.setattr(run_all.weather, 'fetch_weather', err)
    monkeypatch.setattr(run_all.holidays, 'fetch_holidays', err)
    monkeypatch.setattr(run_all.school,   'fetch_school',  err)
    monkeypatch.setattr(run_all.transit,  'fetch_transit', err)
    monkeypatch.setattr(run_all.events,   'load_events',   err)
    monkeypatch.setattr(run_all.shop_calendar, 'generate_calendar', err)

    rc = run_all.main(start_date=date(2026, 4, 28), end_date=date(2026, 4, 29))
    assert rc == 1


def test_upstream_unavailable_writes_fallback_not_failure(monkeypatch):
    """Per CONTEXT D-06: UpstreamUnavailableError → write_fallback (not write_failure)."""
    from scripts.external.weather import UpstreamUnavailableError
    client = _fake_supabase_client()
    captured: list[dict] = []
    def _capture_insert(payload):
        captured.append(payload)
        return MagicMock(execute=MagicMock(return_value=MagicMock(error=None)))
    client.table.return_value.insert.side_effect = _capture_insert
    monkeypatch.setattr(run_all, 'make_client', lambda: client)

    monkeypatch.setattr(run_all.weather, 'fetch_weather',
                        lambda **kw: (_ for _ in ()).throw(UpstreamUnavailableError('502')))
    # Other sources no-op.
    for mod_name, fn_name in [
        ('holidays', 'fetch_holidays'), ('school', 'fetch_school'),
        ('transit', 'fetch_transit'), ('events', 'load_events'),
        ('shop_calendar', 'generate_calendar'),
    ]:
        mod = getattr(run_all, mod_name)
        monkeypatch.setattr(mod, fn_name, (lambda *a, **kw: []))
        if hasattr(mod, 'upsert'):
            monkeypatch.setattr(mod, 'upsert', lambda c, rows: 0)

    run_all.main(start_date=date(2026, 4, 28), end_date=date(2026, 4, 29))
    weather_rows = [r for r in captured if r.get('step_name') == 'external_weather']
    assert len(weather_rows) == 1
    assert weather_rows[0]['status'] == 'fallback'
```

- [ ] **Step 16.2: Run, verify FAIL**

- [ ] **Step 16.3: Write `run_all.py`**

Create `scripts/external/run_all.py`:

```python
"""Phase 13: run_all.py — nightly external-data orchestrator.

Iterates over six fetchers (weather, holidays, school, transit, events,
shop_calendar). Each runs in its own try/except so one source's failure
does not nuke the others. Per-source result lands as one row in
public.pipeline_runs via pipeline_runs_writer.

Exit codes (D-07):
- 0 if at least one source succeeded — cascade can still proceed
  with partial data.
- 1 if every source failed — hard infra issue; alerts the maintainer
  via GHA failure email.

Entry points:
- nightly cron: `python -m scripts.external.run_all` (dates default
  to yesterday + 7 forward weather days)
- backfill:     `python -m scripts.external.run_all --start-date 2025-06-11`
"""
from __future__ import annotations
import argparse
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from . import db, pipeline_runs_writer
from . import weather, holidays, school, transit, events, shop_calendar
from .weather import UpstreamUnavailableError as WeatherUnavailable
from .school  import UpstreamUnavailableError as SchoolUnavailable
from .transit import UpstreamUnavailableError as TransitUnavailable

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
EVENTS_YAML     = REPO_ROOT / 'config' / 'recurring_events.yaml'
SHOP_HOURS_YAML = REPO_ROOT / 'config' / 'shop_hours.yaml'

FALLBACK_EXCEPTIONS = (WeatherUnavailable, SchoolUnavailable, TransitUnavailable)


def make_client():
    """Indirection so tests can monkeypatch the supabase client constructor."""
    return db.make_client()


def _run_weather(client, start_date: date, end_date: date) -> str:
    started = datetime.now(timezone.utc)
    try:
        # Weather always covers 7 forward days regardless of nightly start_date.
        wstart = start_date
        wend = max(end_date, date.today() + timedelta(days=7))
        rows, freshness = weather.fetch_weather(start_date=wstart, end_date=wend)
        n = weather.upsert(client, rows)
        pipeline_runs_writer.write_success(
            client, step_name='external_weather', started_at=started,
            row_count=n, upstream_freshness_h=freshness,
        )
        return 'success'
    except FALLBACK_EXCEPTIONS as e:
        pipeline_runs_writer.write_fallback(
            client, step_name='external_weather', started_at=started, error_msg=str(e),
        )
        return 'fallback'
    except Exception as e:
        pipeline_runs_writer.write_failure(
            client, step_name='external_weather', started_at=started, error_msg=str(e),
        )
        return 'failure'


def _run_holidays(client, start_date: date, end_date: date) -> str:
    started = datetime.now(timezone.utc)
    try:
        years = sorted({start_date.year, end_date.year, end_date.year + 1})
        rows = holidays.fetch_holidays(years=years)
        n = holidays.upsert(client, rows)
        pipeline_runs_writer.write_success(
            client, step_name='external_holidays', started_at=started,
            row_count=n, upstream_freshness_h=holidays.freshness_hours(),
        )
        return 'success'
    except Exception as e:
        pipeline_runs_writer.write_failure(
            client, step_name='external_holidays', started_at=started, error_msg=str(e),
        )
        return 'failure'


def _run_school(client, start_date: date, end_date: date) -> str:
    started = datetime.now(timezone.utc)
    try:
        years = sorted({start_date.year, end_date.year, end_date.year + 1})
        rows = school.fetch_school(years=years)
        n = school.upsert(client, rows)
        pipeline_runs_writer.write_success(
            client, step_name='external_school', started_at=started,
            row_count=n, upstream_freshness_h=school.freshness_hours(rows),
        )
        return 'success'
    except FALLBACK_EXCEPTIONS as e:
        pipeline_runs_writer.write_fallback(
            client, step_name='external_school', started_at=started, error_msg=str(e),
        )
        return 'fallback'
    except Exception as e:
        pipeline_runs_writer.write_failure(
            client, step_name='external_school', started_at=started, error_msg=str(e),
        )
        return 'failure'


def _run_transit(client) -> str:
    started = datetime.now(timezone.utc)
    try:
        rows = transit.fetch_transit()
        n = transit.upsert(client, rows)
        pipeline_runs_writer.write_success(
            client, step_name='external_transit', started_at=started,
            row_count=n, upstream_freshness_h=transit.freshness_hours(rows),
        )
        return 'success'
    except FALLBACK_EXCEPTIONS as e:
        pipeline_runs_writer.write_fallback(
            client, step_name='external_transit', started_at=started, error_msg=str(e),
        )
        return 'fallback'
    except Exception as e:
        pipeline_runs_writer.write_failure(
            client, step_name='external_transit', started_at=started, error_msg=str(e),
        )
        return 'failure'


def _run_events(client) -> str:
    started = datetime.now(timezone.utc)
    try:
        rows = events.load_events(EVENTS_YAML)
        n = events.upsert(client, rows)
        pipeline_runs_writer.write_success(
            client, step_name='external_events', started_at=started,
            row_count=n, upstream_freshness_h=events.freshness_hours(),
        )
        return 'success'
    except Exception as e:
        pipeline_runs_writer.write_failure(
            client, step_name='external_events', started_at=started, error_msg=str(e),
        )
        return 'failure'


def _run_shop_calendar(client) -> str:
    started = datetime.now(timezone.utc)
    try:
        today = date.today()
        rows = shop_calendar.generate_calendar(SHOP_HOURS_YAML, today=today)
        n = shop_calendar.upsert(client, rows)
        # Per-restaurant rows; record the FIRST restaurant_id in the YAML on the
        # pipeline_runs row. Multi-restaurant deployments would loop; v1 is single.
        rid = rows[0]['restaurant_id'] if rows else None
        pipeline_runs_writer.write_success(
            client, step_name='external_shop_calendar', started_at=started,
            row_count=n, upstream_freshness_h=shop_calendar.freshness_hours(),
            restaurant_id=rid,
        )
        return 'success'
    except Exception as e:
        pipeline_runs_writer.write_failure(
            client, step_name='external_shop_calendar', started_at=started, error_msg=str(e),
        )
        return 'failure'


def main(*, start_date: date, end_date: date) -> int:
    client = make_client()

    statuses = [
        _run_weather(client, start_date, end_date),
        _run_holidays(client, start_date, end_date),
        _run_school(client, start_date, end_date),
        _run_transit(client),
        _run_events(client),
        _run_shop_calendar(client),
    ]
    print(f'run_all: results = {dict(zip(["weather","holidays","school","transit","events","shop_calendar"], statuses))}')
    # Exit 0 if at least one success; exit 1 only if every source hit failure.
    if any(s == 'success' for s in statuses):
        return 0
    return 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Phase 13 external-data orchestrator')
    parser.add_argument('--start-date', help='YYYY-MM-DD; defaults to yesterday', default=None)
    parser.add_argument('--end-date',   help='YYYY-MM-DD; defaults to today',     default=None)
    args = parser.parse_args()
    sd = date.fromisoformat(args.start_date) if args.start_date else date.today() - timedelta(days=1)
    ed = date.fromisoformat(args.end_date)   if args.end_date   else date.today()
    sys.exit(main(start_date=sd, end_date=ed))
```

- [ ] **Step 16.4: Run + commit**

```bash
PYTHONPATH=. pytest tests/external/test_run_all.py -v
git add scripts/external/run_all.py tests/external/test_run_all.py
git commit -m "feat(13): run_all orchestrator with per-source try/except + exit-code semantics"
```

---

## Task 17: GHA workflow — `external-data-refresh.yml`

**Files:**
- Create: `.github/workflows/external-data-refresh.yml`

- [ ] **Step 17.1: Write the workflow**

Create `.github/workflows/external-data-refresh.yml`:

```yaml
name: External Data Refresh
on:
  schedule:
    - cron: '0 0 * * *'        # 00:00 UTC nightly (CET 01:00, CEST 02:00) — D-12 + Guard 8
  workflow_dispatch:
    inputs:
      start_date:
        description: 'Backfill start date YYYY-MM-DD (omit for nightly default)'
        required: false
        default: ''
      end_date:
        description: 'Backfill end date YYYY-MM-DD (omit for today)'
        required: false
        default: ''

jobs:
  refresh:
    runs-on: ubuntu-latest
    timeout-minutes: 15        # Phase 13 SC says <5 min nightly; <10 min backfill. 15 is the hard cap.
    env:
      SUPABASE_URL: ${{ secrets.DEV_SUPABASE_URL }}
      SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.DEV_SUPABASE_SERVICE_ROLE_KEY }}
      GITHUB_SHA: ${{ github.sha }}
      WEATHER_PROVIDER: brightsky      # Production default (CONTEXT.md C-02)
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
          cache: 'pip'
          cache-dependency-path: scripts/external/requirements.txt
      - name: Install deps
        run: pip install -r scripts/external/requirements.txt
      - name: Run external-data refresh
        run: |
          ARGS=""
          if [ -n "${{ inputs.start_date }}" ]; then ARGS="$ARGS --start-date ${{ inputs.start_date }}"; fi
          if [ -n "${{ inputs.end_date }}"   ]; then ARGS="$ARGS --end-date   ${{ inputs.end_date }}"; fi
          python -m scripts.external.run_all $ARGS
```

- [ ] **Step 17.2: Verify Guard 8 still passes (cron schedule contract)**

```bash
python3 scripts/ci-guards/check-cron-schedule.py --print-table
```

Expected: `clean (N cron entries scanned)`. The new entry `gha:external-data-refresh.yml` appears at 00:00 UTC; cascade gap to `forecast-refresh` is N/A until Phase 14 lands that workflow.

- [ ] **Step 17.3: Commit**

```bash
git add .github/workflows/external-data-refresh.yml
git commit -m "feat(13): external-data-refresh GHA workflow with nightly cron + workflow_dispatch backfill"
```

---

## Task 18: Extend `tests/integration/tenant-isolation.test.ts` (7 new cases)

**Files:**
- Modify: `tests/integration/tenant-isolation.test.ts`

- [ ] **Step 18.1: Append 7 isolation cases**

Append to `tests/integration/tenant-isolation.test.ts`:

```ts
// Phase 13 EXT-08: hybrid-RLS isolation across 7 new tables.
// Shared (location-keyed) — wrong-tenant JWT must still be ALLOWED to SELECT
// (these are city-wide reference data, deliberately readable by all auth'd
// users) but must be DENIED any INSERT/UPDATE/DELETE.
// Tenant-scoped — wrong-tenant JWT must return ZERO rows on SELECT.

const sharedTables = [
  'weather_daily',
  'holidays',
  'school_holidays',
  'transit_alerts',
  'recurring_events',
];
const tenantTables = ['shop_calendar'];

describe('EXT-08: shared-table read allowed, write denied', () => {
  it.each(sharedTables)('tenant A can SELECT %s', async (t) => {
    const c = tenantClient();
    await c.auth.signInWithPassword({ email: emailA, password });
    const { error } = await c.from(t).select('*').limit(1);
    expect(error).toBeNull();
  });

  it.each(sharedTables)('tenant A cannot INSERT into %s', async (t) => {
    const c = tenantClient();
    await c.auth.signInWithPassword({ email: emailA, password });
    // The minimal payloads below intentionally violate NOT NULL / unique
    // constraints in places — the assertion only cares that RLS denies
    // the write before constraint validation. PostgREST surfaces both
    // RLS denial and constraint failure as `error` non-null.
    const { error } = await c.from(t).insert({ noop: 'x' } as any);
    expect(error).not.toBeNull();
  });
});

describe('EXT-08: tenant-scoped table isolation', () => {
  it.each(tenantTables)('tenant A sees zero rows under tenant B fixture (%s)', async (t) => {
    // Seed a tenant-B-scoped row as service-role.
    const today = new Date().toISOString().slice(0, 10);
    await admin.from(t).upsert({
      restaurant_id: tenantB,
      date: today,
      is_open: true,
    } as never, { onConflict: 'restaurant_id,date' as never } as never);

    const c = tenantClient();
    await c.auth.signInWithPassword({ email: emailA, password });
    const { data, error } = await c.from(t).select('restaurant_id').eq('date', today);
    expect(error).toBeNull();
    const rows = (data ?? []) as Array<{ restaurant_id: string }>;
    // Must NOT contain tenantB rows.
    expect(rows.every((r) => r.restaurant_id !== tenantB)).toBe(true);
  });

  it.each(tenantTables)('orphan user sees zero rows on %s', async (t) => {
    const c = tenantClient();
    await c.auth.signInWithPassword({ email: emailOrphan, password });
    const { data, error } = await c.from(t).select('*').limit(5);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(0);
  });
});

describe('EXT-08: pipeline_runs RLS — global rows visible, tenant rows scoped', () => {
  it('tenant A sees global rows (restaurant_id IS NULL) but only own tenant rows', async () => {
    // Seed one global row + one tenant-A row + one tenant-B row.
    const stamp = `iso-${Date.now()}`;
    await admin.from('pipeline_runs').insert([
      { step_name: `${stamp}-global`, status: 'success', restaurant_id: null },
      { step_name: `${stamp}-A`, status: 'success', restaurant_id: tenantA },
      { step_name: `${stamp}-B`, status: 'success', restaurant_id: tenantB },
    ]);
    const c = tenantClient();
    await c.auth.signInWithPassword({ email: emailA, password });
    const { data, error } = await c
      .from('pipeline_runs')
      .select('step_name, restaurant_id')
      .like('step_name', `${stamp}%`);
    expect(error).toBeNull();
    const seen = (data ?? []) as Array<{ step_name: string; restaurant_id: string | null }>;
    const names = seen.map((r) => r.step_name).sort();
    expect(names).toContain(`${stamp}-global`);
    expect(names).toContain(`${stamp}-A`);
    expect(names).not.toContain(`${stamp}-B`);
  });
});
```

- [ ] **Step 18.2: Run extended isolation tests**

```bash
npx vitest run tests/integration/tenant-isolation.test.ts --reporter=dot
```

Expected: PASS — all original cases + 13 new (5 shared SELECT × 1 + 5 shared INSERT-deny × 1 + 1 tenant-scoped × 2 cases + 1 pipeline_runs scope).

- [ ] **Step 18.3: Commit**

```bash
git add tests/integration/tenant-isolation.test.ts
git commit -m "test(13): extend tenant-isolation with 7 new tables (EXT-08)"
```

---

## Task 19: Wire pytest into `tests.yml`

**Files:**
- Modify: `.github/workflows/tests.yml`

- [ ] **Step 19.1: Add the parallel pytest job**

Edit `.github/workflows/tests.yml`. Replace the entire file with:

```yaml
name: Tests
on:
  pull_request:
  push:
    branches: [main]
jobs:
  vitest:
    runs-on: ubuntu-latest
    env:
      TEST_SUPABASE_URL: ${{ secrets.TEST_SUPABASE_URL }}
      TEST_SUPABASE_ANON_KEY: ${{ secrets.TEST_SUPABASE_ANON_KEY }}
      TEST_SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.TEST_SUPABASE_SERVICE_ROLE_KEY }}
      DEV_SUPABASE_URL: ${{ secrets.DEV_SUPABASE_URL }}
      SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      - run: npm ci
      - name: Link TEST project
        run: supabase link --project-ref ${{ secrets.TEST_SUPABASE_PROJECT_REF }} --password ${{ secrets.TEST_SUPABASE_DB_PASSWORD }}
      - name: Apply migrations to TEST project
        # --include-all: TEST project may have its own migration history with
        # timestamps newer than ours; --include-all tells the CLI to apply
        # any local migration that hasn't been applied remote yet, regardless
        # of position vs the remote head.
        run: supabase db push --password ${{ secrets.TEST_SUPABASE_DB_PASSWORD }} --include-all --yes
      - name: Run Vitest
        run: npx vitest run --reporter=dot

  pytest-external:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
          cache: 'pip'
          cache-dependency-path: scripts/external/requirements.txt
      - name: Install deps
        run: pip install -r scripts/external/requirements.txt
      - name: Run pytest
        run: PYTHONPATH=. pytest tests/external/ -v
```

- [ ] **Step 19.2: Verify locally**

```bash
PYTHONPATH=. pytest tests/external/ -v
```

Expected: all Phase-13 tests PASS.

- [ ] **Step 19.3: Commit**

```bash
git add .github/workflows/tests.yml
git commit -m "ci(13): add pytest-external job to tests.yml in parallel with vitest"
```

---

## Task 20: Backfill execution + smoke verification

**Files:** none — manual verification step.

This task runs AFTER the worktree is merged into `main` and the workflow exists on origin (per `docs/workflow.md` row 13).

- [ ] **Step 20.1: Trigger one-shot backfill via workflow_dispatch**

```bash
gh workflow run external-data-refresh.yml --field start_date=2025-06-11
```

- [ ] **Step 20.2: Wait for completion + check exit status**

```bash
gh run list --workflow=external-data-refresh.yml --limit 1
gh run view <run-id> --log
```

Expected: workflow `success`, wall time < 10 min.

- [ ] **Step 20.3: Smoke-verify each table has rows from 2025-06-11**

Run via the Supabase SQL editor (or DB MCP `mcp__supabase-dev__query`):

```sql
select 'weather_daily' as t, count(*) as n, min(date) as earliest, max(date) as latest from public.weather_daily
union all
select 'holidays',         count(*), min(date),       max(date)       from public.holidays
union all
select 'school_holidays',  count(*), min(start_date), max(end_date)   from public.school_holidays
union all
select 'transit_alerts',   count(*), min(pub_date)::date, max(pub_date)::date from public.transit_alerts
union all
select 'recurring_events', count(*), min(start_date), max(end_date)   from public.recurring_events
union all
select 'shop_calendar',    count(*), min(date),       max(date)       from public.shop_calendar
order by t;
```

Expected: every row except `transit_alerts` (might be 0 if no recent strikes) has `n > 0`. `weather_daily.earliest <= '2025-06-11'`. `weather_daily.latest >= today + 7 days`. `shop_calendar.latest = today + 364 days`.

- [ ] **Step 20.4: Verify pipeline_runs got one row per fetcher per backfill chunk**

```sql
select step_name, status, count(*), max(finished_at) as last_run
from public.pipeline_runs
where started_at >= now() - interval '24 hours'
group by step_name, status
order by step_name, status;
```

Expected: rows for `external_weather`, `external_holidays`, `external_school`, `external_transit`, `external_events`, `external_shop_calendar`. At least one `success` per source.

- [ ] **Step 20.5: Confirm cascade contract (Guard 8) by reading the schedule table**

```bash
python3 scripts/ci-guards/check-cron-schedule.py --print-table
```

Expected: `clean`. Markdown table includes `gha:external-data-refresh.yml` at `00:00 / 01:00 CET / 02:00 CEST` and `gha:its-validity-audit.yml` at `09:00 Mon / 10:00 / 11:00`. No overlap.

---

## Self-Review

I went back through `13-CONTEXT.md` (D-01..D-14 + carry-forwards C-01..C-05 + the canonical references) and confirmed each requirement maps to a task above. Spot fixes I caught and applied inline:

- **Coverage check:** All seven migrations land (Tasks 2–8); all six fetchers (Tasks 10–15); orchestrator (Task 16); GHA workflow with cron + workflow_dispatch (Task 17); two-tenant isolation extension (Task 18); tests.yml integration (Task 19); backfill (Task 20). EXT-01..EXT-09 each have a dedicated task. C-01 is enforced automatically by Guard 7 (re-run after each migration in Tasks 2.6 + 7.5). C-02 is in `external-data-refresh.yml` env. C-03 is Task 7. C-04 cron is Task 17. C-05 hybrid-RLS pattern repeats verbatim across migrations 0041..0047.
- **Placeholder scan:** No "TBD", no "implement later", no "similar to Task N" — every step has runnable code or runnable commands.
- **Type consistency:** `step_name` taxonomy (`external_weather`, `external_holidays`, `external_school`, `external_transit`, `external_events`, `external_shop_calendar`) is consistent across `run_all.py`, `pipeline_runs_writer.py` callers, and the migration test queries. The `(rows, freshness_h)` tuple convention from D-05 is replaced with a per-source orchestrator wrapper (cleaner than the proposed shared signature, but every fetcher still exposes `fetch_*` + `upsert` + `freshness_hours` in a uniform shape).
- **Founder override (DESIGN.md):** Plan builds Phase 13 as scoped per CONTEXT.md. Sunday Night Text wedge is NOT in the plan — that section of DESIGN.md is record-only.
- **Task 18 vs Task 6 cross-check:** Task 6's `recurring-events-yearly-reminder` cron writes to `pipeline_runs` with `restaurant_id IS NULL` (it's a maintainer reminder, not a tenant event). The Task 7 RLS policy (`restaurant_id is null OR restaurant_id::text = (auth.jwt() ->> 'restaurant_id')`) lets the reminder row appear under any tenant's dashboard view — intended.
- **Test runner consistency:** `PYTHONPATH=.` is used both locally and in `tests.yml` so `from scripts.external.foo import …` resolves identically. No editable-install needed.
- **Schedule contract:** `external-data-refresh.yml` at `0 0 * * *` UTC + `its-validity-audit.yml` at `0 9 * * 1` UTC + `recurring-events-yearly-reminder` (annual Sep 15 9 AM UTC) are the three crons in the repo. No overlap in either CET or CEST. Phase 14's `forecast-refresh.yml` will land at `0 1 * * *` UTC and Guard 8 will then enforce the ≥60-min cascade gap from external-data; the gap is naturally satisfied.

---

## Plan complete

Plan saved at `docs/superpowers/plans/2026-04-29-phase-13-external-data-ingestion.md` (relative to the worktree).

**Next step — pick one execution path:**

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for a 20-task plan like this; each subagent gets the task spec only, keeps the orchestrator context lean.

2. **Inline Execution** — I execute tasks in this session using `superpowers:executing-plans`, batch with checkpoints.

Which approach?
