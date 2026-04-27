# Architecture Research

**Domain:** Free, forkable, mobile-first restaurant POS analytics (Orderbird → Supabase → SvelteKit/Cloudflare)
**Researched:** 2026-04-13
**Confidence:** HIGH for the data-plane pattern (Supabase/pg_cron/RLS/MV patterns are well-documented and match the stack research); MEDIUM for the idempotency and narrative-insights details (opinionated).

---

## Executive Take

This is a **nightly batch analytics pipeline with a static-edge reader UI**. There are only four moving parts — an extractor, a Postgres warehouse, a reader app, and an insight Edge Function — and the entire correctness story hinges on three rules:

1. **RLS + security-definer wrapper views must exist before the first materialized view is built.** Retrofitting tenant scoping onto MVs after the fact means rewriting every view.
2. **Raw ingest is idempotent via a natural-key unique index (`restaurant_id, source_tx_id`) with upsert.** No batch tables, no "last run timestamp" state — re-running yesterday's extract must be a no-op.
3. **Every read path goes through the wrapper views, never the MV or the raw tables.** One enforcement point for RLS.

Everything else (scraper resilience, Claude prompt, cron orchestration) is recoverable. Violating those three is the rewrite path.

---

## Standard Architecture

### System Overview

```
┌───────────────────────────────────────────────────────────────────┐
│                         EXTRACTION LAYER                           │
│                  (runs outside Supabase, stateless)                │
├───────────────────────────────────────────────────────────────────┤
│    ┌──────────────────────────────────────────────────────┐       │
│    │  GitHub Actions (cron: 0 2 * * *)                    │       │
│    │    └─ Python 3.12 + Playwright                       │       │
│    │         └─ my.orderbird.com login (storageState)     │       │
│    │         └─ CSV export download                       │       │
│    │         └─ pandas shape → card_hash + normalized row │       │
│    │         └─ supabase-py UPSERT → stg_orderbird_tx     │       │
│    └──────────────────────────────────────────────────────┘       │
└──────────────────────────────┬────────────────────────────────────┘
                               │ service_role key (server-only)
                               │ upsert on (restaurant_id, source_tx_id)
                               ▼
┌───────────────────────────────────────────────────────────────────┐
│                          DATA PLANE (Supabase Postgres)            │
├───────────────────────────────────────────────────────────────────┤
│   ┌─────────────────┐   ┌──────────────────┐   ┌──────────────┐   │
│   │ stg_orderbird_tx│──▶│  transactions    │──▶│ cohort_mv    │   │
│   │ (raw CSV rows)  │   │  (normalized,    │   │ ltv_mv       │   │
│   │   RLS: deny all │   │   RLS: tenant)   │   │ kpi_daily_mv │   │
│   └─────────────────┘   └──────────────────┘   │ freq_mv      │   │
│          ▲                       ▲              │ (no RLS)     │   │
│          │                       │              └──────┬───────┘   │
│          │                       │                     │           │
│          │               ┌───────┴──────┐      ┌────────┴───────┐  │
│          │               │ SECURITY     │      │ SECURITY       │  │
│          │               │ DEFINER      │      │ DEFINER        │  │
│          │               │ VIEWS        │      │ WRAPPER VIEWS  │  │
│          │               │ (raw-path)   │      │ cohort_v       │  │
│          │               │ rarely used  │      │ ltv_v          │  │
│          │               └──────────────┘      │ kpi_daily_v    │  │
│          │                                     │ freq_v         │  │
│          │                                     └────────┬───────┘  │
│          │                                              │          │
│   ┌──────┴──────────┐                           ┌──────┴──────┐   │
│   │ pg_cron jobs    │                           │  RLS: tenant │   │
│   │  02:30 normalize│                           │  filter via  │   │
│   │  03:00 refresh  │                           │  auth.jwt()  │   │
│   │  03:30 insights │                           └──────┬──────┘   │
│   └──────┬──────────┘                                  │          │
│          │                                             │          │
│          │ pg_net http_post                            │          │
│          ▼                                             │          │
│   ┌──────────────────────┐                             │          │
│   │ Edge Function:       │                             │          │
│   │ generate-insights    │◀── ANTHROPIC_API_KEY        │          │
│   │   └─ read kpi deltas │    (Supabase secret)        │          │
│   │   └─ call Claude     │                             │          │
│   │   └─ write insights  │                             │          │
│   └──────────┬───────────┘                             │          │
│              ▼                                         │          │
│   ┌─────────────────────┐                              │          │
│   │ insights table      │◀─────────────────────────────┘          │
│   │  RLS: tenant        │                                         │
│   └──────────┬──────────┘                                         │
└──────────────┼─────────────────────────────────────────────────────┘
               │ anon key + user JWT (cookie)
               │ only SELECT on *_v wrapper views
               ▼
┌───────────────────────────────────────────────────────────────────┐
│                         READER LAYER                              │
├───────────────────────────────────────────────────────────────────┤
│    ┌──────────────────────────────────────────────────────┐       │
│    │  Cloudflare Pages (SvelteKit 2 + adapter-cloudflare) │       │
│    │    ├─ hooks.server.ts: @supabase/ssr cookie session  │       │
│    │    ├─ +layout.server.ts: getUser() → restaurant_id   │       │
│    │    ├─ +page.server.ts: SELECT from *_v views only    │       │
│    │    └─ +page.svelte: LayerChart cards, mobile-first   │       │
│    └──────────────────────────────────────────────────────┘       │
│                               ▲                                    │
│                               │ HTTPS                              │
│                         ┌─────┴─────┐                              │
│                         │ Phone     │                              │
│                         │ browser   │                              │
│                         └───────────┘                              │
└───────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Implementation | Secrets Held |
|-----------|---------------|----------------|--------------|
| **GitHub Actions scraper** | Daily Orderbird login, CSV export, normalize, upsert to `stg_orderbird_tx` | Python 3.12 + Playwright 1.48 + pandas + supabase-py; cron `0 2 * * *` | `ORDERBIRD_USER/PASS`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STORAGE_STATE_B64` |
| **`stg_orderbird_tx` (staging table)** | Raw-ish landing zone; preserves source row for debugging | Postgres table, RLS deny-all except `service_role` | — |
| **`transactions` (fact table)** | Normalized, tenant-scoped, deduped per-transaction truth | Postgres table with `restaurant_id` + RLS | — |
| **Cohort/LTV/KPI materialized views** | Precomputed analytical shapes for cheap reads | `REFRESH MATERIALIZED VIEW CONCURRENTLY` nightly | — |
| **Security-definer wrapper views (`*_v`)** | The only surface SvelteKit touches; enforce RLS over MVs | `CREATE VIEW ... WITH (security_invoker=off)` filtered by `auth.jwt()->>'restaurant_id'` | — |
| **pg_cron** | Orchestrates normalize → refresh → insights chain nightly | `cron.schedule` jobs, chained by timestamp offsets | — |
| **Edge Function `generate-insights`** | Reads KPI deltas, calls Claude, writes one-sentence narrative row | Deno runtime, invoked via `pg_net.http_post` from pg_cron | `ANTHROPIC_API_KEY` (Supabase secret) |
| **`insights` table** | Persists nightly narrative cards keyed by `(restaurant_id, date)` | Postgres table with RLS | — |
| **SvelteKit app on CF Pages** | SSR the dashboard, handle auth cookies, query wrapper views | `@sveltejs/adapter-cloudflare` + `@supabase/ssr` + LayerChart | anon key only (public) |
| **Supabase Auth** | Issues JWTs with `restaurant_id` claim in `app_metadata` | Email/password, custom access token hook to inject claim | — |

**Boundary rules (enforced, not aspirational):**
- The scraper touches **only** `stg_orderbird_tx`. It never writes to `transactions` directly.
- SvelteKit touches **only** `*_v` wrapper views and `insights`. It never touches raw tables or MVs.
- The Edge Function touches **only** `kpi_daily_v` (read) and `insights` (write), using the service role scoped to one tenant via `restaurant_id` param.
- pg_cron is the **only** thing that runs `REFRESH MATERIALIZED VIEW` and the `stg → transactions` normalization.

---

## Data Flow

### Nightly pipeline (02:00 → 03:45 UTC)

```
02:00 GHA cron fires
  └─ Playwright logs in (reuses storageState.json)
     └─ Downloads CSV for yesterday + 2-day overlap window
        └─ pandas: compute card_hash = sha256(card_pan_token + restaurant_id)
           └─ supabase-py.upsert(stg_orderbird_tx,
                                 on_conflict='restaurant_id,source_tx_id')
              └─ exits; GHA job success/fail posts Slack webhook

02:30 pg_cron 'normalize-transactions'
  └─ INSERT INTO transactions
     SELECT ... FROM stg_orderbird_tx s
     WHERE s.ingested_at > (SELECT max(ingested_at) FROM transactions)
     ON CONFLICT (restaurant_id, source_tx_id) DO UPDATE SET ...
     → idempotent; re-running produces zero diffs

03:00 pg_cron 'refresh-analytical-mvs'
  └─ REFRESH MATERIALIZED VIEW CONCURRENTLY cohort_mv;
  └─ REFRESH MATERIALIZED VIEW CONCURRENTLY ltv_mv;
  └─ REFRESH MATERIALIZED VIEW CONCURRENTLY kpi_daily_mv;
  └─ REFRESH MATERIALIZED VIEW CONCURRENTLY freq_mv;
     (ordering matters only if MVs reference each other — avoid chaining MVs in v1)

03:30 pg_cron 'trigger-insights'
  └─ SELECT net.http_post(
       url := 'https://<ref>.supabase.co/functions/v1/generate-insights',
       headers := jsonb_build_object('Authorization','Bearer '||service_role),
       body    := jsonb_build_object('restaurant_id', r.id))
     FROM restaurants r;
  └─ Edge Function: reads kpi_daily_v for last 14 days,
                    builds delta prompt,
                    calls Claude Haiku,
                    INSERT INTO insights.
```

### Read path (user opens phone)

```
Phone GET https://app.ramenbones.com/
   ↓ Cloudflare Pages edge
+hooks.server.ts
   ↓ createServerClient(cookies)   (@supabase/ssr)
+layout.server.ts
   ↓ const { data:{user} } = await supabase.auth.getUser()
   ↓ const restaurant_id = user.app_metadata.restaurant_id
   ↓ (abort 401 if missing)
+page.server.ts
   ↓ parallel:
   ↓   supabase.from('kpi_daily_v').select().gte('d', since)
   ↓   supabase.from('cohort_v').select().gte('cohort_week', since)
   ↓   supabase.from('ltv_v').select()
   ↓   supabase.from('freq_v').select()
   ↓   supabase.from('insights').select().order('d',desc).limit(1)
+page.svelte
   ↓ render LayerChart cards, single column, <150kb JS
Response → phone
```

Every `*_v` view transparently filters by `auth.jwt()->>'restaurant_id'`, so the SvelteKit code looks single-tenant but is actually multi-tenant-safe.

---

## Schema Sketch

```sql
-- ─── tenancy root ──────────────────────────────────────────────
create table restaurants (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,
  name         text not null,
  timezone     text not null default 'Europe/Berlin',
  created_at   timestamptz not null default now()
);

-- link Supabase Auth users to a restaurant (many users per tenant, one tenant per user in v1)
create table memberships (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  role          text not null default 'owner'
);

-- ─── custom access token hook: inject restaurant_id into JWT ──
-- configured in supabase/config.toml [auth.hook.custom_access_token]
create or replace function public.add_restaurant_claim(event jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  rid uuid;
begin
  select restaurant_id into rid
  from memberships
  where user_id = (event->>'user_id')::uuid;

  if rid is not null then
    event := jsonb_set(event, '{claims,app_metadata,restaurant_id}', to_jsonb(rid::text));
  end if;
  return event;
end $$;

-- ─── staging (service_role only) ──────────────────────────────
create table stg_orderbird_tx (
  restaurant_id   uuid not null references restaurants(id),
  source_tx_id    text not null,              -- orderbird order id
  raw             jsonb not null,             -- full row for replay
  ingested_at     timestamptz not null default now(),
  primary key (restaurant_id, source_tx_id)
);
alter table stg_orderbird_tx enable row level security;
-- no policies = deny all; only service_role bypasses RLS

-- ─── fact table ───────────────────────────────────────────────
create table transactions (
  restaurant_id  uuid not null references restaurants(id),
  source_tx_id   text not null,
  occurred_at    timestamptz not null,
  card_hash      text,                        -- sha256(pan_token || restaurant_id), nullable for cash
  gross_cents    integer not null,
  net_cents      integer not null,
  item_count     integer not null,
  payment_method text,
  channel        text,
  created_at     timestamptz not null default now(),
  primary key (restaurant_id, source_tx_id)   -- natural-key dedup
);
create index on transactions (restaurant_id, occurred_at);
create index on transactions (restaurant_id, card_hash) where card_hash is not null;

alter table transactions enable row level security;
create policy tx_tenant_read on transactions
  for select using (restaurant_id::text = auth.jwt()->'app_metadata'->>'restaurant_id');
-- no insert/update/delete policies → only service_role writes

-- ─── cohort materialized view ─────────────────────────────────
create materialized view cohort_mv as
with first_visits as (
  select restaurant_id, card_hash,
         date_trunc('week', min(occurred_at))::date as cohort_week
  from transactions
  where card_hash is not null
  group by 1,2
)
select
  fv.restaurant_id,
  fv.cohort_week,
  date_trunc('week', t.occurred_at)::date as active_week,
  count(distinct t.card_hash) as active_customers,
  sum(t.gross_cents) as gross_cents
from first_visits fv
join transactions t using (restaurant_id, card_hash)
group by 1,2,3;

-- mandatory for CONCURRENTLY refresh
create unique index on cohort_mv (restaurant_id, cohort_week, active_week);

-- ─── security-definer wrapper view (THE READ SURFACE) ─────────
create view cohort_v
with (security_invoker = off)   -- runs as view owner, bypasses MV-has-no-RLS limitation
as
select *
from cohort_mv
where restaurant_id::text = auth.jwt()->'app_metadata'->>'restaurant_id';

grant select on cohort_v to authenticated;
revoke all on cohort_mv from authenticated, anon;  -- force all access through _v

-- ─── insights (Claude output) ─────────────────────────────────
create table insights (
  restaurant_id uuid not null references restaurants(id),
  d             date not null,
  headline      text not null,
  body          text not null,
  model         text not null,
  created_at    timestamptz not null default now(),
  primary key (restaurant_id, d)
);
alter table insights enable row level security;
create policy insights_tenant_read on insights for select
  using (restaurant_id::text = auth.jwt()->'app_metadata'->>'restaurant_id');
```

The same `_v` wrapper pattern applies to `ltv_mv`, `kpi_daily_mv`, and `freq_mv`.

---

## Multi-Tenancy Pattern

- **Tenant column:** `restaurant_id uuid` on every fact/staging table and every MV.
- **JWT claim:** `app_metadata.restaurant_id` injected by a custom access token hook at login; **never** accept tenant id as a query param.
- **RLS on tables:** policy compares `restaurant_id::text = auth.jwt()->'app_metadata'->>'restaurant_id'`.
- **RLS on MVs:** impossible directly. Solved via `security_invoker=off` wrapper views (`cohort_v`, etc.) that filter by the same JWT claim. `REVOKE ALL` on the underlying MVs from `authenticated`/`anon` so the wrapper is the only path.
- **Writes:** only `service_role` writes (scraper + Edge Function + pg_cron). No user ever inserts.
- **v1 → multi-tenant switch:** add one row to `restaurants`, one row to `memberships`, and ship. No schema change, no rewrite.

---

## Build Order (Dependency-Enforced)

This is the **only** valid ordering. Deviations cause rewrites.

1. **Supabase project + `restaurants`, `memberships`, access-token hook** → without the JWT claim mechanism, nothing downstream can enforce tenancy.
2. **RLS policies on `restaurants` and `memberships`** → close the auth boundary before any fact data exists.
3. **`stg_orderbird_tx` + `transactions` tables with RLS** → tables must be RLS-enabled from the CREATE, not added later (easy to forget a policy).
4. **Seed a second throwaway `restaurant_id` row** → even in v1. Every query must be tested against two tenants from day 1 or tenancy bugs hide until it's too late.
5. **First materialized view (`kpi_daily_mv`) + unique index + `_v` wrapper + `REVOKE` on the MV** → this is the template. Get it right once, copy for the rest.
6. **Python scraper writing to `stg_orderbird_tx` only** → proves extraction works without touching the read path.
7. **`normalize-transactions` pg_cron job** → moves staged rows to `transactions`.
8. **Additional MVs (`cohort_mv`, `ltv_mv`, `freq_mv`) each with wrapper view** → follow the template from step 5.
9. **`refresh-analytical-mvs` pg_cron** → schedule after normalize.
10. **SvelteKit app reading `kpi_daily_v` first** → end-to-end vertical slice before adding more views.
11. **Remaining SvelteKit views (cohort, LTV, freq)** → each one is now cheap because the pattern is set.
12. **`insights` table + Edge Function + `trigger-insights` pg_cron** → last, because it's the only non-blocking component.

**The load-bearing rule:** steps 1-5 must be complete before **any** analytical SQL is written. If you write `cohort_mv` before step 5, the wrapper-view pattern won't be muscle memory and you'll leak tenant data through a direct MV query at some point.

---

## Idempotency & Deduplication

**Principle:** every stage must be safely re-runnable with no state outside the database.

| Stage | Idempotency Mechanism | Failure Replay |
|-------|----------------------|----------------|
| Scraper CSV download | Re-download is free; Orderbird serves the same file | Just re-run the GHA workflow |
| `stg_orderbird_tx` upsert | `PRIMARY KEY (restaurant_id, source_tx_id)` + `ON CONFLICT DO UPDATE` | Scraper always pulls a **2-day overlap window** (yesterday + day before) so a missed run catches up automatically |
| `transactions` normalize | Same PK, `INSERT ... ON CONFLICT DO UPDATE`; derived from `stg_*` deterministically | Re-running the cron job is a no-op |
| MV refresh | `REFRESH MATERIALIZED VIEW CONCURRENTLY` is idempotent by definition | Re-run |
| Insights | `PRIMARY KEY (restaurant_id, d)` + `ON CONFLICT DO UPDATE` | Re-trigger the Edge Function |

**What makes CSV reuploads safe:** the `source_tx_id` is Orderbird's own order ID — stable across exports. The scraper never generates surrogate IDs. Card hash is deterministic: `sha256(pan_token || restaurant_id)`, so the same card always hashes identically. Result: uploading the same CSV twice, ten times, or mixing overlapping day windows produces **zero** double-counting.

**Anti-pattern to avoid:** "batch" or "ingest_run" tables that track "which rows were loaded in run N". They add state, break replay, and the natural key already solves the problem.

---

## Failure Modes & Recovery

| Failure | Detection | User-visible effect | Recovery |
|---------|-----------|---------------------|----------|
| **Scraper login fails (storageState expired)** | GHA job fails; Slack/Discord webhook | Dashboard shows "Last updated Xh ago" creeping past 24h | Manual: run `playwright codegen` locally, refresh `storageState.json`, commit encrypted or update GHA secret. 2-day overlap window means next successful run recovers missed day automatically. |
| **Orderbird CSV schema change** | pandas throws on unknown column; GHA fails | Same as above | Fix column mapping in extractor, redeploy. `stg_orderbird_tx` preserves `raw jsonb` so historical rows are replayable after the fix. |
| **Scraper succeeds, upsert fails (network/token)** | GHA log shows supabase-py error | Stale dashboard | Re-run job. Idempotent upsert makes this trivial. |
| **GHA cron skipped entirely** (GitHub outage) | No workflow run for the day | Stale dashboard | Next day's run with 2-day window catches both days. For longer outages, manually trigger with a wider window via `workflow_dispatch`. |
| **pg_cron skips a job** (rare) | `cron.job_run_details` shows gap | MV not refreshed → stale numbers | Manual `SELECT cron.schedule(...)` or `REFRESH MATERIALIZED VIEW CONCURRENTLY` from SQL editor. |
| **MV refresh errors** (e.g. unique index violated after schema change) | `cron.job_run_details.status='failed'` | Old MV data keeps serving (CONCURRENTLY didn't commit) | Fix the offending SQL, re-run refresh manually. Because `CONCURRENTLY` is transactional, readers never see partial state. |
| **MV refresh deadlocks / long runs** | Refresh exceeds schedule window | Next scheduled refresh queues up | Ensure unique index exists (prereq for CONCURRENTLY); keep MV SQL simple; move to incremental refresh only if needed. |
| **Claude API down / timeout** | Edge Function returns 5xx | No new `insights` row for that day | Dashboard falls back gracefully: "No narrative today". Retry next night. Optionally: Edge Function writes a deterministic fallback headline from KPI deltas when API fails, so a card always renders. |
| **Claude hallucinates bad numbers** | No programmatic detection | Wrong narrative shown to owner | Prompt construction must pass numbers as ground truth and instruct Claude to **only phrase, never calculate**. Second line of defense: regex-check generated text doesn't contain digits not in the input. |
| **Edge Function secret leaked / revoked** | Function errors 401 from Anthropic | No insights | `supabase secrets set ANTHROPIC_API_KEY=...`; retrigger. |
| **Supabase outage** | SvelteKit load function throws | Dashboard error page | SvelteKit shows a friendly error state; no data caching on edge in v1 (acceptable at one tenant). v1.x: add a 1h stale-while-revalidate cache on `kpi_daily_v` read in `+page.server.ts`. |
| **RLS misconfiguration** (wrong policy) | **CRITICAL — silent**; other tenant sees data | Data leak | Mitigation: **automated test** seeding two restaurants and asserting each user sees only their own rows in every `_v` view. Must be in CI before any schema merge. |
| **JWT claim missing** (user not in `memberships`) | `auth.jwt()->'app_metadata'->>'restaurant_id'` is null → queries return 0 rows | Empty dashboard | `+layout.server.ts` detects null claim → redirect to "account not provisioned" page. |

---

## Anti-Patterns

### Anti-Pattern 1: Querying raw `transactions` from SvelteKit
**Why wrong:** full table scan, slow on phone, bypasses the wrapper-view discipline. Even with RLS it's a perf trap and creates two read surfaces (tables and wrapper views) which drifts.
**Do instead:** every SvelteKit query hits a `*_v` view. Precompute in an MV. If you need a new shape, add a new MV + wrapper, don't query raw.

### Anti-Pattern 2: RLS policies directly on materialized views
**Why wrong:** Postgres does not support it. Attempting it either silently does nothing or fails at policy creation.
**Do instead:** `REVOKE` on the MV, use `security_invoker=off` wrapper view with the JWT filter in its `WHERE`.

### Anti-Pattern 3: Tenant id from query param, form field, or client state
**Why wrong:** trivially tamperable. A user types `?restaurant_id=<other>` and reads another tenant's data.
**Do instead:** tenant id lives in the signed JWT, injected server-side by the access token hook. Client code never sees or sends it.

### Anti-Pattern 4: `REFRESH MATERIALIZED VIEW` without `CONCURRENTLY`
**Why wrong:** takes an `ACCESS EXCLUSIVE` lock; readers block; dashboard hangs during the nightly window even if we think no one is looking.
**Do instead:** always `CONCURRENTLY`, which requires a unique index on the MV (enforce at creation time).

### Anti-Pattern 5: Staging table with batch/run tracking instead of natural key upsert
**Why wrong:** introduces state, breaks replay, needs manual cleanup when a run half-fails.
**Do instead:** natural PK `(restaurant_id, source_tx_id)` + upsert. No batch tables, no `last_run_at`, no "delete rows from failed run".

### Anti-Pattern 6: Trusting `supabase.auth.getSession()` on the server
**Why wrong:** cookie contents are not re-validated; tampered cookies pass. Supabase docs call this out explicitly.
**Do instead:** `await supabase.auth.getUser()` (or `getClaims()`) on every server load that makes an authorization decision.

### Anti-Pattern 7: Calling Claude API from the browser
**Why wrong:** leaks `ANTHROPIC_API_KEY`.
**Do instead:** Edge Function with the key as a Supabase secret; pg_cron triggers it via `pg_net`.

### Anti-Pattern 8: Chained/nested materialized views
**Why wrong:** refresh ordering becomes a graph, refresh time compounds, debugging stale data gets hard.
**Do instead:** each MV reads directly from `transactions` (+ small dim tables). Duplicate a CTE across MVs rather than chain them.

### Anti-Pattern 9: Storing raw PAN or full card details anywhere
**Why wrong:** PCI scope, regulatory risk, product promise violation.
**Do instead:** scraper computes `card_hash` **before** writing to Supabase. The raw PAN never touches the database.

---

## Integration Points

### External Services

| Service | Integration | Gotchas |
|---------|-------------|---------|
| **my.orderbird.com** | Playwright headed browser, persistent `storageState.json` | Login flow is JS-driven; session may expire weekly; captcha possible under heavy re-login; schema of CSV export can change silently |
| **Supabase Postgres** | `supabase-py` (scraper), `@supabase/ssr` (SvelteKit), direct SQL (pg_cron) | pg_cron enable via Dashboard extension; `pg_net` must also be enabled for Edge Function trigger |
| **Supabase Edge Functions** | Deno runtime, triggered via `pg_net.http_post` from pg_cron | Cold start ~500ms, fine for nightly; secrets via `supabase secrets set` |
| **Anthropic Claude API** | `fetch` from Deno, Haiku model for cost | Rate limits negligible at 1 call/night/tenant; enforce 5s timeout and graceful fallback |
| **GitHub Actions** | `schedule` trigger, `secrets.*` for creds, `actions/upload-artifact` for logs | Cron granularity is ~5-15min drift; "free unlimited for public repos" — keep repo public or live within 2000 min/mo private quota |
| **Cloudflare Pages** | `adapter-cloudflare`, Pages Git integration | Workers runtime ≠ Node; every SvelteKit dep must be fetch-compatible |

### Internal Boundaries

| Boundary | Communication | Contract |
|----------|---------------|----------|
| Scraper → Supabase | HTTPS upsert with service_role key | Writes only to `stg_orderbird_tx`; fails loud on schema mismatch |
| pg_cron → Edge Function | `pg_net.http_post` with service_role bearer | Body: `{restaurant_id}`; 5s timeout; failures logged in `cron.job_run_details` |
| Edge Function → Supabase tables | Deno `supabase-js` with service_role | Reads `kpi_daily_v`, writes `insights` |
| SvelteKit → Supabase | `@supabase/ssr` with user JWT | Reads `*_v` views and `insights`; never raw tables, never writes |

---

## Scaling Considerations

| Scale | Architecture changes |
|-------|---------------------|
| **1 tenant (v1)** | Everything as described. Single MV full refresh is fine. Scraper ~30s/day. |
| **10 tenants** | No change. pg_cron iterates restaurants, ~1min MV refresh total. |
| **50 tenants** | Start batching Edge Function trigger (one call per tenant is wasteful). Consider tenant-aware refresh scheduling to stagger load. Verify free tier DB storage — probably still under 500 MB. |
| **200 tenants** | Move scraper off GHA to a dedicated worker (Fly.io free tier) to avoid queue contention. Consider incremental MV refresh via `pg_cron` + delta triggers. Graduate from Supabase free tier. |
| **1000+ tenants** | Schema-per-tenant or partitioned `transactions` by `restaurant_id`. Re-evaluate dbt Core. Likely new product shape anyway. |

**First bottleneck:** MV refresh time, not query time. Cohort MV does `count(distinct)` over all history nightly. At ~1M rows it's still seconds; at 50M it becomes minutes. Fix by adding incremental refresh when it hurts, not before.

**Second bottleneck:** cold-start latency on phone for the first page load over 4G. Mitigate with SvelteKit's SSR + adapter-cloudflare edge deploy (already in the stack). Keep JS bundle <150kb.

---

## Sources

- Supabase RLS on materialized views discussion (supabase/discussions/17790) — security-definer wrapper pattern confirmed
- Supabase pg_cron + pg_net official docs — HTTP trigger from cron
- Supabase custom access token hook docs — JWT claim injection
- `@supabase/ssr` SvelteKit auth guide — `getUser()` vs `getSession()` trust boundary
- PostgreSQL docs — `REFRESH MATERIALIZED VIEW CONCURRENTLY` unique-index requirement
- STACK.md (sibling research) — library choices and version pins
- FEATURES.md (sibling research) — which views the frontend will read
- PROJECT.md — constraints: single-tenant v1, multi-tenant-ready, free-tier, 2-week MVP

---
*Architecture research for: restaurant POS analytics (Orderbird → Supabase → SvelteKit/CF)*
*Researched: 2026-04-13*
