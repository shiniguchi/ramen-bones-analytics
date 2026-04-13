# Phase 1: Foundation - Research

**Researched:** 2026-04-13
**Domain:** Multi-tenant Supabase Postgres data plane (tenancy, auth, RLS, MV wrapper template, CI guards) on a greenfield repo
**Confidence:** HIGH

## Summary

Phase 1 stands up a single-tenant-today / multi-tenant-ready data plane on Supabase Postgres with `@supabase/ssr` auth, a Custom Access Token Hook that injects `restaurant_id` into the JWT, RLS on every tenant-scoped table, a plain-SQL wrapper-view template for materialized views, per-tenant `business_date` derivation via `AT TIME ZONE`, and four CI grep guards that block merges on known footguns. No analytical SQL, no scraper, no dashboard beyond a login-redirect stub.

The upstream research in `.planning/research/ARCHITECTURE.md` and `.planning/research/PITFALLS.md` already documents the architecture and the pitfalls in depth. CONTEXT.md has locked every major decision. This document exists to (a) surface **exact code-level patterns** the planner needs to emit tasks against — JWT hook SQL, `hooks.server.ts` with `getClaims`, wrapper-view SQL with `REVOKE`/`GRANT`, `business_date` fixture, two-tenant Vitest harness, GHA guard workflow — and (b) produce the Nyquist Validation Architecture section mapping every FND requirement to a concrete automated check.

**Primary recommendation:** Implement steps 1→11 of the build-order table below verbatim. Do not deviate from the wrapper-view SQL template in §Architecture Patterns — every Phase 3 MV will copy it.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Tenant Model + JWT Claim**
- **D-01:** Schema is N:M via `memberships(user_id, restaurant_id, role)`. V1 seeds exactly one row; multi-tenant-ready with zero rewrite.
- **D-02:** `memberships.role` is a Postgres enum with values `owner` and `viewer`. Friend = owner in v1.
- **D-03:** `restaurants` has at minimum: `id uuid pk`, `name text`, `timezone text NOT NULL` (D-09), `created_at timestamptz`.
- **D-04:** A Supabase Custom Access Token Hook (SQL function) reads `memberships` and injects a single `restaurant_id` top-level claim into the JWT. RLS policies read `auth.jwt()->>'restaurant_id'`. Hook is idempotent and handles the zero-membership case by returning the token unchanged.
- **D-05:** V1 assumes one membership per user. Array-of-ids deferred.

**Wrapper-View Template**
- **D-06:** Tenant-scoped reads go through plain SQL views with an explicit `WHERE restaurant_id = (auth.jwt()->>'restaurant_id')::uuid` clause, NOT security-definer functions. Rationale: PostgREST / `@supabase/ssr` calls `.from('kpi_daily_v')` naturally; security-definer would force `.rpc()` and complicate Phase 4 data fetching.
- **D-07:** Every materialized view is locked down with `REVOKE ALL ON <mv_name> FROM anon, authenticated`. Only `postgres` / `service_role` can touch the raw `_mv`. The wrapper view (`*_v`) is the sole tenant-facing entry point.
- **D-08:** The mandatory unique index on every MV is enforced via a migration template and a CI grep check: any `CREATE MATERIALIZED VIEW` statement without a matching `CREATE UNIQUE INDEX` in the same migration file fails the build.
- **D-08a:** Phase 1 implements this template on `kpi_daily_mv` as the canonical example. The MV itself can be a trivial placeholder (e.g., `SELECT restaurant_id, current_date AS business_date, 0::numeric AS revenue`).

**Auth UX + Timezone**
- **D-09:** Per-tenant timezone stored as `restaurants.timezone text NOT NULL` (seeded to `'Europe/Berlin'` for v1). Every analytical query derives `business_date` server-side via `(occurred_at AT TIME ZONE r.timezone)::date`. Hardcoded constants and client-side conversion are forbidden — the test fixture at 23:45 Berlin must land in the correct business day.
- **D-10:** V1 skips the signup page. Founder pre-creates the friend's user via the Supabase dashboard.
- **D-11:** Password reset uses Supabase's default recovery email — no custom `/reset` route.
- **D-12:** Login uses email + password via `@supabase/ssr`. `@supabase/auth-helpers-sveltekit` is explicitly forbidden. Server hooks use `safeGetSession()` / `getClaims()` / `getUser()`, never `getSession()` alone.

**CI Guards + Tooling**
- **D-13:** CI grep guards live in a single `.github/workflows/guards.yml` and run on every PR. No pre-commit hook, no local make target.
- **D-14:** Four grep guards block merge:
  1. Any reference to `*_mv` from `src/`.
  2. `getSession(` called inside `+*.server.ts` or `hooks.server.ts` without `safeGetSession`/`getUser` in the same file.
  3. `REFRESH MATERIALIZED VIEW` not followed by `CONCURRENTLY` in any `supabase/migrations/**/*.sql`.
  4. `card_hash` joined against any column listed in a small `pii-columns.txt` manifest (starts empty).
- **D-15:** Database migrations managed via Supabase CLI. `supabase/migrations/*.sql` checked into repo. `supabase db push` runs from GHA against DEV.
- **D-16:** Two-tenant isolation integration test written in Vitest with `@supabase/supabase-js`. Test seeds tenants A and B via `service_role`, signs in as each user, asserts every wrapper view returns only the signed-in tenant's rows. Runs against a dedicated test Supabase project (separate from DEV).

### Claude's Discretion

- Exact column list for `restaurants` and `memberships` beyond the minimums in D-03 — add only what's needed to satisfy FND-01..08.
- Migration file naming / ordering (follow Supabase CLI conventions).
- Choice of Vitest config and test-runner wiring. SvelteKit app doesn't exist yet in Phase 1; tests may live in a dedicated `tests/` tree until Phase 4 bootstraps the app.
- Whether the JWT hook is a plain SQL function or a Postgres function + `pgsodium`-style secret — pick whichever Supabase's current docs recommend.
- Placeholder content of the v1 `kpi_daily_mv`.

### Deferred Ideas (OUT OF SCOPE)

- **Signup page with self-serve tenant creation** → Phase 5.
- **Custom password reset UI** → Phase 5 or later.
- **JWT claim as array of `restaurant_ids`** → deferred until multi-tenant user.
- **Schema-per-tenant isolation** → only if perf walls appear.
- **Role-based permissions beyond owner/viewer** → future phase.
- **PII-columns manifest population** → Phase 2 will populate; Phase 1 ships empty file.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FND-01 | Supabase Postgres project initialized with `restaurants` and `memberships` tables (multi-tenant schema from day 1) | §Standard Stack → Supabase CLI + migration 0001; §Architecture Patterns → Schema sketch |
| FND-02 | Custom access token hook injects `restaurant_id` claim into Supabase Auth JWT from `memberships` table | §Architecture Patterns → Custom Access Token Hook SQL, verified against Supabase docs |
| FND-03 | RLS policies enforced on every tenant-scoped table using `auth.jwt()->>'restaurant_id'` | §Architecture Patterns → RLS policy template |
| FND-04 | Wrapper-view pattern documented and applied to the first materialized view | §Architecture Patterns → Wrapper-view SQL template (kpi_daily_mv + kpi_daily_v + REVOKE + unique index) |
| FND-05 | Two-tenant isolation integration test runs in CI on every PR | §Architecture Patterns → Two-Tenant Vitest Harness; §Validation Architecture |
| FND-06 | Email+password login via Supabase Auth with session surviving browser refresh | §Architecture Patterns → hooks.server.ts + +layout.server.ts pattern |
| FND-07 | Card-hash identifier never stored alongside PAN, PII, or raw card data | §Architecture Patterns → `pii-columns.txt` manifest + CI guard #4 |
| FND-08 | All timestamps `timestamptz`; `business_date` derived from tenant timezone | §Architecture Patterns → `AT TIME ZONE` derivation + 23:45 Berlin fixture |
</phase_requirements>

## Standard Stack

### Core (Phase 1 scope)

| Library / Tool | Version (verified April 2026) | Purpose | Why Standard |
|---|---|---|---|
| Supabase CLI | latest stable (1.x+) | Local-dev DB, migrations, types, `supabase link`, `supabase db push` | D-15 locks this; forkability story = `clone → supabase link → supabase db push` |
| Supabase Postgres | 15+ (managed) | Data plane | Project-locked |
| `@supabase/supabase-js` | 2.103.x | DB client used by Vitest test harness and (Phase 4) SvelteKit | CLAUDE.md stack — matches `@supabase/ssr` major |
| `@supabase/ssr` | 0.5.x+ | Cookie-based SSR session (Phase 4 consumer; Phase 1 stubs the hooks file) | CLAUDE.md forbids `auth-helpers-sveltekit` |
| Vitest | 1.x+ | Test runner for the two-tenant isolation test (D-16) | Standard for TS projects; Phase 4 will already need it when SvelteKit lands |
| `dotenv` | latest | Load test env vars (`TEST_SUPABASE_URL`, service role key) locally | Standard |
| `pgTAP` | optional, extension | Raw-SQL assertions for `business_date` fixture | Alternative: SQL test via Vitest+supabase-js. **Pick supabase-js path** — one runner is simpler. |

**Not installed in Phase 1:** SvelteKit, adapter-cloudflare, Tailwind, shadcn-svelte, LayerChart, pandas, Playwright, Anthropic SDK. Those belong to Phases 2, 4, 5.

### Installation (Phase 1 only)

```bash
# At repo root
npm init -y
npm install -D vitest typescript @types/node tsx dotenv
npm install @supabase/supabase-js @supabase/ssr
npx tsc --init

# Supabase CLI (Mac)
brew install supabase/tap/supabase
supabase init           # creates supabase/ with config.toml + migrations/
supabase login
supabase link --project-ref <dev-project-ref>
```

### Version verification (planner MUST re-run before writing install tasks)

```bash
npm view @supabase/ssr version
npm view @supabase/supabase-js version
npm view vitest version
supabase --version
```

Training data versions may be stale. Confirm against registry in the planning step.

## Architecture Patterns

### Recommended Repo Structure (Phase 1 end state)

```
.
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── supabase/
│   ├── config.toml              # auth hook declared here
│   ├── migrations/
│   │   ├── 0001_tenancy_schema.sql     # restaurants, memberships, enum
│   │   ├── 0002_auth_hook.sql          # custom_access_token_hook function + grants
│   │   ├── 0003_transactions_skeleton.sql  # timestamptz + business_date + RLS
│   │   ├── 0004_kpi_daily_mv_template.sql  # MV + unique index + _v wrapper + REVOKE
│   │   └── 0005_seed_tenant.sql        # single v1 restaurant + membership
│   └── seed.sql                  # optional local-dev seed
├── tests/
│   ├── setup.ts                  # dotenv + two service-role / anon clients
│   ├── integration/
│   │   ├── tenant-isolation.test.ts    # FND-05 core
│   │   ├── business-date-fixture.test.ts  # FND-08, 23:45 Berlin case
│   │   ├── jwt-claim.test.ts      # FND-02, hook injects restaurant_id
│   │   └── session-persistence.test.ts # FND-06, cookie survival simulation
│   └── fixtures/
│       └── two-tenants.sql       # seeds restaurants A+B, memberships, users
├── scripts/
│   └── ci-guards.sh              # single bash script called by GHA workflow
├── pii-columns.txt               # empty for Phase 1 (guard #4)
└── .github/workflows/
    ├── guards.yml                # grep guards (D-13, D-14)
    ├── migrations.yml            # supabase db push → DEV on merge to main
    └── tests.yml                 # Vitest against TEST Supabase project
```

**Note:** No `src/` exists yet. The CI guard that forbids `_mv` references in `src/` still runs (no false positives against an empty directory). Phase 4 creates `src/`.

### Pattern 1: Tenancy Schema (migration 0001)

```sql
-- supabase/migrations/0001_tenancy_schema.sql
create extension if not exists pgcrypto;

create table public.restaurants (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  timezone   text not null,                       -- IANA, e.g. 'Europe/Berlin' (D-09)
  created_at timestamptz not null default now()
);

create type public.membership_role as enum ('owner', 'viewer');   -- D-02

create table public.memberships (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  role          public.membership_role not null default 'owner',
  created_at    timestamptz not null default now()
);

alter table public.restaurants enable row level security;
alter table public.memberships enable row level security;

-- Read your own tenant row
create policy restaurants_own on public.restaurants
  for select to authenticated
  using (id::text = auth.jwt()->>'restaurant_id');

-- Read your own membership row
create policy memberships_own on public.memberships
  for select to authenticated
  using (user_id = auth.uid());

-- No insert/update/delete policies = deny all for authenticated.
-- Only service_role writes (bypasses RLS by design).
```

### Pattern 2: Custom Access Token Hook (migration 0002, FND-02)

Verified against https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook (HIGH).

```sql
-- supabase/migrations/0002_auth_hook.sql
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  rid uuid;
  new_claims jsonb;
begin
  -- Look up the single restaurant for this user (D-05: one membership in v1)
  select restaurant_id into rid
  from public.memberships
  where user_id = (event->>'user_id')::uuid
  limit 1;

  new_claims := event->'claims';

  if rid is not null then
    -- Inject top-level 'restaurant_id' claim (D-04)
    new_claims := jsonb_set(new_claims, '{restaurant_id}', to_jsonb(rid::text));
  end if;

  -- Idempotent: unchanged token if no membership (D-04). RLS denies all rows naturally.
  return jsonb_build_object('claims', new_claims);
end;
$$;

-- supabase_auth_admin is the role that executes the hook
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;

-- Grant the hook read access to memberships (bypasses RLS via SECURITY DEFINER? NO — the
-- function is not SECURITY DEFINER. supabase_auth_admin needs explicit SELECT grant.)
grant usage on schema public to supabase_auth_admin;
grant select on public.memberships to supabase_auth_admin;
```

**Registering the hook:** Two options — pick one, document in README.

1. **Dashboard (recommended for v1):** Authentication → Hooks → Add hook → Custom Access Token → select `public.custom_access_token_hook`. One-click. Mandatory for forkers.
2. **`supabase/config.toml`:**
   ```toml
   [auth.hook.custom_access_token]
   enabled = true
   uri = "pg-functions://postgres/public/custom_access_token_hook"
   ```
   Requires `supabase db push` then `supabase config push` (or redeploy).

**CONFIDENCE NOTE (MEDIUM):** Supabase doesn't ship a stable `config.toml` snippet for hooks at the exact URI format above — docs currently show Dashboard as the canonical registration path. Planner should treat dashboard registration as the required step and `config.toml` as best-effort documentation for forkers. Verify URI syntax at plan time.

### Pattern 3: RLS + Wrapper-View Template (migration 0004, FND-03/FND-04/D-06/D-07/D-08)

This is THE load-bearing pattern. Every Phase 3 MV copies it.

```sql
-- supabase/migrations/0004_kpi_daily_mv_template.sql

-- 1. Materialized view (placeholder content — D-08a). Owned by postgres.
create materialized view public.kpi_daily_mv as
select
  r.id           as restaurant_id,
  current_date   as business_date,
  0::numeric     as revenue_cents
from public.restaurants r;

-- 2. MANDATORY unique index (D-08). Enables REFRESH ... CONCURRENTLY in Phase 3.
create unique index kpi_daily_mv_pk
  on public.kpi_daily_mv (restaurant_id, business_date);

-- 3. Lock the raw MV. authenticated/anon can never touch it directly (D-07).
revoke all on public.kpi_daily_mv from anon, authenticated;

-- 4. Wrapper view — the ONLY tenant-facing read path (D-06).
--    security_invoker=on means the view runs as the querying role (authenticated),
--    which would hit the REVOKE on kpi_daily_mv. That's fine because the wrapper view
--    is OWNED BY postgres, and in the default Supabase setup views execute with their
--    definer's privileges UNLESS security_invoker=on. So we MUST NOT set security_invoker=on.
--    Default (security_invoker=off, the Postgres default) means the view runs as its owner
--    (postgres), which can read the REVOKE'd MV. The WHERE clause enforces tenancy via JWT.
create view public.kpi_daily_v as
select
  restaurant_id,
  business_date,
  revenue_cents
from public.kpi_daily_mv
where restaurant_id::text = (auth.jwt()->>'restaurant_id');

grant select on public.kpi_daily_v to authenticated;
```

**Critical note on `security_invoker`:**
- Postgres default for views is `security_invoker = off` → the view runs with the **view owner's** privileges (here: `postgres`, which owns the MV).
- This is exactly what D-06 relies on: `authenticated` can `SELECT` the `_v` view; the view then reads the `_mv` as `postgres`; the `WHERE` clause filters by JWT claim. No RPC needed, no `SECURITY DEFINER` function needed.
- **Do NOT set `WITH (security_invoker = on)`** on wrapper views. It defeats the pattern.
- Reference discussion for the rationale: https://github.com/orgs/supabase/discussions/17790.

**Migration file CI guard (D-08):** Any migration containing `CREATE MATERIALIZED VIEW` without a matching `CREATE UNIQUE INDEX` in the same file fails the build. See §CI Guards.

### Pattern 4: `business_date` Derivation (FND-08)

```sql
-- supabase/migrations/0003_transactions_skeleton.sql
-- Creates the transactions table shell that Phase 2 will populate. Every query that
-- needs a day boundary MUST derive business_date via AT TIME ZONE the tenant's timezone.

create table public.transactions (
  restaurant_id  uuid not null references public.restaurants(id),
  source_tx_id   text not null,
  occurred_at    timestamptz not null,                   -- FND-08: always timestamptz
  card_hash      text,
  gross_cents    integer not null,
  net_cents      integer not null,
  created_at     timestamptz not null default now(),
  primary key (restaurant_id, source_tx_id)
);

-- Derived column is NOT stored — it's derived at query time via a join.
-- Example the Phase 3 analytics SQL will copy:
--
--   select
--     t.restaurant_id,
--     (t.occurred_at at time zone r.timezone)::date as business_date,
--     sum(t.gross_cents)
--   from transactions t
--   join restaurants r on r.id = t.restaurant_id
--   group by 1, 2;
--
-- The 23:45 Berlin fixture test (FND-08) asserts:
--   occurred_at = '2026-04-13 21:45:00+00'  (= 23:45 Europe/Berlin DST)
--   timezone    = 'Europe/Berlin'
--   → business_date = 2026-04-13 (NOT 2026-04-13 UTC truncation, which is same here,
--     but the inverse fixture '2026-04-13 22:30+00' must land on 2026-04-14).

create index transactions_restaurant_occurred on public.transactions (restaurant_id, occurred_at);

alter table public.transactions enable row level security;
create policy tx_tenant_read on public.transactions
  for select to authenticated
  using (restaurant_id::text = (auth.jwt()->>'restaurant_id'));
```

**Two fixtures for the test (both required):**

| occurred_at (UTC) | timezone | Expected business_date | Why |
|---|---|---|---|
| `2026-04-13 21:45:00+00` | Europe/Berlin | `2026-04-13` | 23:45 local = same day |
| `2026-04-13 22:30:00+00` | Europe/Berlin | `2026-04-14` | 00:30 local = next day |

The second case is the one that breaks if someone writes `date_trunc('day', occurred_at)` without `AT TIME ZONE`.

### Pattern 5: SvelteKit `hooks.server.ts` Stub (FND-06, D-12)

Phase 1 does **not** build the SvelteKit app (Phase 4 does). But the planner should ship a minimal `hooks.server.ts` reference file at `docs/reference/hooks.server.ts.example` so Phase 4 copies it verbatim AND so CI guard #2 (`getSession` on server without `getClaims`) has a real pattern to test against.

Based on current Supabase guidance (April 2026): **prefer `getClaims()` over `getUser()`** where available — it validates JWT signature against the project's published JWKs on every request and does not need a round-trip to Supabase Auth. `getUser()` is the previous-generation safe alternative. `getSession()` alone is unsafe because it trusts the cookie.

```typescript
// docs/reference/hooks.server.ts.example (Phase 4 will move this to src/hooks.server.ts)
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY } from '$env/static/public';
import { createServerClient } from '@supabase/ssr';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.supabase = createServerClient(
    PUBLIC_SUPABASE_URL,
    PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => event.cookies.getAll(),
        setAll: (cookies) => {
          cookies.forEach(({ name, value, options }) => {
            event.cookies.set(name, value, { ...options, path: '/' });
          });
        }
      }
    }
  );

  // safeGetSession: validate JWT signature via getClaims before trusting the session.
  // Never return a session from getSession() alone — it would trust a tampered cookie.
  event.locals.safeGetSession = async () => {
    const {
      data: { session }
    } = await event.locals.supabase.auth.getSession();
    if (!session) return { session: null, user: null, claims: null };

    const {
      data: { claims },
      error
    } = await event.locals.supabase.auth.getClaims();
    if (error || !claims) return { session: null, user: null, claims: null };

    // Reconstruct a "validated" session shape. restaurant_id lives at top level of claims
    // because of the Custom Access Token Hook (Pattern 2).
    return { session, user: session.user, claims };
  };

  return resolve(event, {
    filterSerializedResponseHeaders: (name) =>
      name === 'content-range' || name === 'x-supabase-api-version'
  });
};
```

**Consumer (`+layout.server.ts`), also shipped as `.example`:**

```typescript
// docs/reference/+layout.server.ts.example
import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
  const { claims } = await locals.safeGetSession();
  if (!claims) throw redirect(303, '/login');

  const restaurantId = claims.restaurant_id as string | undefined;
  if (!restaurantId) throw redirect(303, '/not-provisioned');

  return { restaurantId };
};
```

**Why `getClaims` and not `getUser`:** Supabase added `getClaims()` specifically to let SSR code verify JWT signatures locally (via JWKs) without a network round-trip. It is the current best practice; `getUser()` remains valid but is slower. CI guard #2 should accept either `getClaims` OR `getUser` co-present with `getSession` — forbidding only the unverified-`getSession`-alone case.

**CONFIDENCE (MEDIUM):** The exact surface of `auth.getClaims()` in `@supabase/supabase-js` 2.103+ should be re-verified at plan time against the installed version. If not present, fall back to `getUser()`.

### Pattern 6: Two-Tenant Isolation Vitest Harness (FND-05, D-16)

This is the **single most important test in the entire project** — it's the structural guarantee that the RLS + wrapper-view pattern holds.

```typescript
// tests/integration/tenant-isolation.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.TEST_SUPABASE_URL!;
const SERVICE_ROLE = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!;
const ANON = process.env.TEST_SUPABASE_ANON_KEY!;

// service_role client — bypasses RLS, used for seeding
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false }
});

let tenantA: string, tenantB: string;
let userA: string, userB: string;
const passwordA = 'test-a-' + Date.now();
const passwordB = 'test-b-' + Date.now();
const emailA = `a-${Date.now()}@test.local`;
const emailB = `b-${Date.now()}@test.local`;

beforeAll(async () => {
  // Seed two restaurants
  const { data: rA } = await admin
    .from('restaurants')
    .insert({ name: 'Tenant A', timezone: 'Europe/Berlin' })
    .select()
    .single();
  const { data: rB } = await admin
    .from('restaurants')
    .insert({ name: 'Tenant B', timezone: 'Europe/Berlin' })
    .select()
    .single();
  tenantA = rA!.id;
  tenantB = rB!.id;

  // Create auth users via admin API
  const { data: uA } = await admin.auth.admin.createUser({
    email: emailA, password: passwordA, email_confirm: true
  });
  const { data: uB } = await admin.auth.admin.createUser({
    email: emailB, password: passwordB, email_confirm: true
  });
  userA = uA.user!.id;
  userB = uB.user!.id;

  // Link memberships — Custom Access Token Hook will inject restaurant_id on next sign-in
  await admin.from('memberships').insert([
    { user_id: userA, restaurant_id: tenantA, role: 'owner' },
    { user_id: userB, restaurant_id: tenantB, role: 'owner' }
  ]);

  // Seed one MV row per tenant (via service_role — bypasses REVOKE)
  // kpi_daily_mv is a materialized view snapshot — runtime-seeded tenants
  // only appear after an explicit refresh. Use the service_role-only RPC
  // helper public.refresh_kpi_daily_mv() from migration 0006_test_helpers.sql:
  const { error: refreshErr } = await admin.rpc('refresh_kpi_daily_mv');
  if (refreshErr) throw refreshErr;
  // When Phase 3 MVs exist, add explicit fixture rows before the refresh call.
});

afterAll(async () => {
  await admin.from('memberships').delete().in('user_id', [userA, userB]);
  await admin.auth.admin.deleteUser(userA);
  await admin.auth.admin.deleteUser(userB);
  await admin.from('restaurants').delete().in('id', [tenantA, tenantB]);
});

function tenantClient() {
  // Fresh anon client per test, simulates a logged-in browser
  return createClient(SUPABASE_URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

describe('FND-05: two-tenant isolation via wrapper views', () => {
  it('tenant A only sees tenant A rows in kpi_daily_v', async () => {
    const a = tenantClient();
    await a.auth.signInWithPassword({ email: emailA, password: passwordA });
    const { data, error } = await a.from('kpi_daily_v').select();
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    expect(data!.every((r) => r.restaurant_id === tenantA)).toBe(true);
    expect(data!.some((r) => r.restaurant_id === tenantB)).toBe(false);
  });

  it('tenant B only sees tenant B rows in kpi_daily_v', async () => {
    const b = tenantClient();
    await b.auth.signInWithPassword({ email: emailB, password: passwordB });
    const { data, error } = await b.from('kpi_daily_v').select();
    expect(error).toBeNull();
    expect(data!.every((r) => r.restaurant_id === tenantB)).toBe(true);
  });

  it('tenant A cannot read the raw kpi_daily_mv (REVOKE enforced)', async () => {
    const a = tenantClient();
    await a.auth.signInWithPassword({ email: emailA, password: passwordA });
    const { data, error } = await a.from('kpi_daily_mv').select();
    // Expect either an error or zero rows — never cross-tenant data
    expect(data?.length ?? 0).toBe(0);
  });

  it('unauthenticated client sees zero rows in kpi_daily_v', async () => {
    const anon = tenantClient();
    const { data } = await anon.from('kpi_daily_v').select();
    expect(data?.length ?? 0).toBe(0);
  });

  it('user with no membership gets zero rows (hook idempotent path)', async () => {
    const emailOrphan = `orphan-${Date.now()}@test.local`;
    const passwordOrphan = 'orphan-pw';
    const { data: u } = await admin.auth.admin.createUser({
      email: emailOrphan, password: passwordOrphan, email_confirm: true
    });
    const c = tenantClient();
    await c.auth.signInWithPassword({ email: emailOrphan, password: passwordOrphan });
    const { data } = await c.from('kpi_daily_v').select();
    expect(data?.length ?? 0).toBe(0);
    await admin.auth.admin.deleteUser(u.user!.id);
  });
});
```

**Test Supabase project:** D-16 requires a **separate** project from DEV. Provision via Supabase dashboard → give the test project a distinct name like `ramen-bones-test`. Store its URL / anon key / service role key as GHA secrets `TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY`, `TEST_SUPABASE_SERVICE_ROLE_KEY`. Migrations run against this project in CI via `supabase db push --project-ref <test-ref>` in the test workflow.

### Pattern 7: CI Grep Guards (D-13, D-14)

One bash script invoked by one GHA workflow. No pre-commit hook.

```bash
#!/usr/bin/env bash
# scripts/ci-guards.sh — fails CI on any of the four forbidden patterns
set -u
fail=0

# Guard 1 (D-14.1): No raw _mv references from src/
if [ -d src ]; then
  if grep -rnE '\b[a-z_]+_mv\b' src/ 2>/dev/null; then
    echo "::error::Guard 1 FAILED: src/ references a materialized view directly. Use the *_v wrapper view."
    fail=1
  fi
fi

# Guard 2 (D-14.2): getSession() on server without getClaims/getUser in the same file
# Scans hooks.server.ts and any +*.server.ts files
find src docs/reference -type f \( -name 'hooks.server.ts' -o -name '+*.server.ts' \) 2>/dev/null | while read -r f; do
  if grep -q 'getSession(' "$f" && ! grep -qE '(getClaims|getUser)\(' "$f"; then
    echo "::error::Guard 2 FAILED: $f calls getSession() without getClaims/getUser validation."
    echo "fail" >> /tmp/guard2
  fi
done
[ -f /tmp/guard2 ] && fail=1 && rm /tmp/guard2

# Guard 3 (D-14.3): REFRESH MATERIALIZED VIEW without CONCURRENTLY in migrations
if find supabase/migrations -name '*.sql' 2>/dev/null | xargs -r grep -nE 'REFRESH MATERIALIZED VIEW(?! CONCURRENTLY)' -P 2>/dev/null; then
  echo "::error::Guard 3 FAILED: REFRESH MATERIALIZED VIEW missing CONCURRENTLY."
  fail=1
fi

# Guard 3b (D-08): Any CREATE MATERIALIZED VIEW must have CREATE UNIQUE INDEX in same file
while IFS= read -r file; do
  if grep -q 'CREATE MATERIALIZED VIEW' "$file" && ! grep -q 'CREATE UNIQUE INDEX' "$file"; then
    echo "::error::Guard 3b FAILED: $file creates a MV without a unique index (blocks CONCURRENTLY refresh)."
    fail=1
  fi
done < <(find supabase/migrations -name '*.sql' 2>/dev/null)

# Guard 4 (D-14.4): card_hash joined to columns listed in pii-columns.txt
# pii-columns.txt is empty in Phase 1 — the check still runs but matches nothing.
if [ -s pii-columns.txt ]; then
  while IFS= read -r col; do
    [ -z "$col" ] && continue
    if grep -rnE "card_hash.*${col}|${col}.*card_hash" supabase/migrations/ src/ 2>/dev/null; then
      echo "::error::Guard 4 FAILED: card_hash referenced alongside PII column '${col}'."
      fail=1
    fi
  done < pii-columns.txt
fi

exit $fail
```

```yaml
# .github/workflows/guards.yml
name: CI Guards
on:
  pull_request:
  push:
    branches: [main]
jobs:
  guards:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run grep guards
        run: bash scripts/ci-guards.sh
```

**Pitfall:** Guard 3 uses Perl-regex negative lookahead (`-P`). On minimal GHA runners `grep -P` is available (GNU grep is default on `ubuntu-latest`). If portability matters, rewrite as two-pass: find lines with `REFRESH MATERIALIZED VIEW`, filter out those containing `CONCURRENTLY`.

### Anti-Patterns to Avoid (Phase 1 specific)

- **`WITH (security_invoker = on)` on wrapper views.** Breaks D-06: `authenticated` can't read the `REVOKE`'d MV. Default (`off`) is correct.
- **Placing the tenancy claim in `app_metadata` instead of top-level.** D-04 locks it as top-level `restaurant_id`. RLS policy reads `auth.jwt()->>'restaurant_id'` — a nested `app_metadata.restaurant_id` would require `auth.jwt()->'app_metadata'->>'restaurant_id'` and is easy to get wrong. (The upstream ARCHITECTURE.md uses the nested pattern; CONTEXT.md overrides it. Follow CONTEXT.)
- **`date_trunc('day', occurred_at)` anywhere.** Always `(occurred_at at time zone r.timezone)::date`. Guarded by PITFALL #3 not CI — planner should add a fifth optional grep.
- **Signup / password-reset UI.** Out of scope (D-10, D-11).
- **Storing `business_date` as a generated column on `transactions`.** D-09 says derive at query time. A stored column ties the table to a single tenant's timezone at insert time and breaks multi-tenant. Compute in the query via the `restaurants` join.
- **Vitest in a `watch` loop in CI.** Always `vitest run`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| JWT claim injection | Custom JWT signing or middleware rewriting tokens | Supabase Custom Access Token Hook | Built-in, signed by Supabase's auth signing key, no code path for tampering |
| RLS enforcement | Application-level `WHERE tenant_id = ?` checks | Postgres RLS policies + JWT claim | One enforcement point, impossible to forget on a new query |
| MV tenant scoping | `SECURITY DEFINER` function wrappers | Plain view with `security_invoker = off` (D-06) | `.from('v_name')` just works for PostgREST; no `.rpc()` plumbing |
| Day-boundary math | Client-side timezone conversion in SvelteKit | `(occurred_at AT TIME ZONE r.timezone)::date` in SQL | Day is a tenant property (D-09), not a device property |
| Migration tooling | Custom SQL runner, flyway | Supabase CLI `supabase/migrations/*.sql` + `supabase db push` | D-15; forkability path |
| Two-tenant test isolation | Mocked Postgres in Vitest | Real Supabase test project (D-16) | Only way to verify RLS + wrapper + JWT hook interaction end-to-end |
| Cookie session management | Hand-written cookie parser | `@supabase/ssr` `createServerClient` + `getAll`/`setAll` | Handles cookie fragmentation, SameSite, refresh rotation |
| Session validation | Trusting `getSession()` return value | `safeGetSession` helper that verifies via `getClaims()` | Only JWT signature verification is trustworthy against tampered cookies |
| PII guard | A linter plugin | A `pii-columns.txt` manifest + grep in CI | Simpler; works across SQL and TS; D-14.4 |

**Key insight:** every Phase 1 primitive already exists in Supabase or Postgres. The work is gluing them correctly, not inventing anything.

## Runtime State Inventory

Phase 1 is greenfield; no pre-existing runtime state to rename or migrate.

| Category | Items Found | Action Required |
|---|---|---|
| Stored data | None — no Supabase project exists yet, no databases, no memories. | Provision Supabase DEV + Supabase TEST projects in Phase 1 task 1 |
| Live service config | None — no n8n, no Datadog, no external services in this project. | None |
| OS-registered state | None — no scheduled tasks, no launchd, no cron. pg_cron will be enabled inside Supabase starting Phase 3, not Phase 1. | None |
| Secrets/env vars | **NEW secrets to create:** `TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY`, `TEST_SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PROJECT_REF_DEV`, `SUPABASE_DB_PASSWORD` (for `supabase db push` in migrations.yml). No existing secrets to migrate. | Create in GHA repo secrets as part of Phase 1 CI wiring |
| Build artifacts | None — no `package.json`, no `node_modules`, no egg-info. Repo is docs-only. | Phase 1 creates `package.json`, `supabase/`, `tests/` from scratch |

## Common Pitfalls

Phase 1 reimports the relevant pitfalls from `.planning/research/PITFALLS.md` with Phase-1-specific framing. (Full list: see that file.)

### Pitfall A: Wrapper view silently leaks when `security_invoker = on` is set
**What goes wrong:** Developer copies a Postgres tutorial that says "always set `security_invoker=on`" and adds it to `kpi_daily_v`. The view now runs with the caller's privileges, hits the `REVOKE` on the MV, and returns an error — OR worse, the developer adds a `GRANT SELECT ON kpi_daily_mv TO authenticated` to "fix" the error, and now the raw MV is readable.
**Why it happens:** `security_invoker=on` is generally safer advice for views that wrap *tables*, but wrong for the MV-wrapper pattern where privilege separation is the point.
**How to avoid:** Never `GRANT ... TO authenticated` on any `_mv`. Never set `security_invoker=on` on any `_v`. Both are caught by code review; neither is currently caught by a CI guard. Consider adding guard #5 at plan time.
**Warning signs:** Any migration adding `GRANT ... ON ..._mv`.

### Pitfall B: Hook executes but claim is nested under `app_metadata`
**What goes wrong:** Hook sets `jsonb_set(claims, '{app_metadata,restaurant_id}', ...)` but RLS policy reads `auth.jwt()->>'restaurant_id'` (top-level). All queries return zero rows.
**How to avoid:** D-04 locks the claim at top level. The pattern in §Pattern 2 is correct. Integration test `jwt-claim.test.ts` (see §Validation Architecture) explicitly asserts `claims.restaurant_id` is a top-level string.
**Warning signs:** `jsonb_set` path contains `app_metadata` or `user_metadata`.

### Pitfall C: Hook grants forgotten, auth fails silently
**What goes wrong:** Function created without `grant execute ... to supabase_auth_admin`. Login succeeds but hook doesn't fire (Supabase logs the permission denial but it's easy to miss).
**How to avoid:** Include grants in the same migration (Pattern 2). Test `jwt-claim.test.ts` asserts the claim is present immediately after signup.

### Pitfall D: Test project contaminated by DEV data
**What goes wrong:** CI test accidentally points at DEV; seeds fake users into the real project; deletes the friend's real row.
**How to avoid:** The test harness MUST assert `TEST_SUPABASE_URL` is not equal to DEV URL before running. Add to `tests/setup.ts`:
```typescript
if (process.env.TEST_SUPABASE_URL === process.env.DEV_SUPABASE_URL)
  throw new Error('Refusing to run tests against DEV project');
```

### Pitfall E: 23:45 Berlin fixture passes because test author wrote it in local time
**What goes wrong:** `occurred_at = '2026-04-13 23:45'` without explicit TZ — Postgres interprets as session timezone (usually UTC), so "23:45" stored is UTC, which is "01:45 next day Berlin", not what the test meant.
**How to avoid:** Always write fixtures in UTC with explicit `+00`, then annotate expected Berlin-local in a comment. See Pattern 4 fixture table.

### Pitfall F: pii-columns.txt is empty → guard #4 does nothing → false sense of safety
**How to avoid:** Document in the file's header that Phase 2 MUST add every new PII-adjacent column as the scraper introduces them. Add a TODO comment in `pii-columns.txt` itself. Optional stretch: fail CI if Phase 2 adds a column named `email`/`phone`/`name` without updating the manifest — defer to Phase 2.

## Code Examples

All code examples live inline in §Architecture Patterns above and are copy-ready for the planner.

## State of the Art

| Old Approach | Current Approach (April 2026) | Impact |
|---|---|---|
| `@supabase/auth-helpers-sveltekit` | `@supabase/ssr` | Deprecated package removed from stack |
| `supabase.auth.getSession()` on server | `supabase.auth.getClaims()` (preferred) or `getUser()` | JWT-signature verified locally via JWKs; no round-trip |
| `app_metadata.tenant_id` pattern | Top-level `restaurant_id` claim via Custom Access Token Hook | Simpler RLS policy: `auth.jwt()->>'restaurant_id'` |
| `SECURITY DEFINER` RPC functions for MV access | Plain view with default `security_invoker=off` + `WHERE` on JWT claim | Works with PostgREST `.from()` directly; no RPC layer |
| Moment.js / manual date arithmetic | `date-fns` (Phase 4) | Tree-shakes, TS-native |

**Deprecated/outdated:**
- `@supabase/auth-helpers-sveltekit` — do not install.
- Storing `tenant_id` in `app_metadata` — works but adds nesting; CONTEXT D-04 rejects it.

## Open Questions

1. **Exact `config.toml` syntax for Custom Access Token Hook registration**
   - What we know: Dashboard UI registration works and is documented.
   - What's unclear: Whether `supabase/config.toml` supports `[auth.hook.custom_access_token]` with `uri = "pg-functions://..."` in the current CLI version.
   - Recommendation: Planner should add a task "verify and document registration path" and ship working dashboard steps in README. `config.toml` entry is nice-to-have for forkers.

2. **Does `@supabase/supabase-js` 2.103.x export `auth.getClaims()`?**
   - What we know: Supabase docs recommend it; Answer-Overflow thread shows it in use.
   - What's unclear: Exact minimum version that exposes it.
   - Recommendation: `npm view @supabase/supabase-js versions` at plan time; if `getClaims` is missing, fall back to `getUser()` in the reference hook file and adjust CI guard #2 copy.

3. **Should the Phase 1 `transactions` table exist at all, or is it Phase 2's job?**
   - What we know: CONTEXT §code_context says Phase 2 will write into `transactions`. PITFALL #3 prevention says bake `business_date` into `transactions` in Phase 1.
   - What's unclear: Whether Phase 1 should create the skeleton table (so the 23:45 Berlin fixture test has a table to insert into) or whether Phase 2 owns the table entirely.
   - Recommendation: **Phase 1 creates the skeleton** (Pattern 4 migration 0003). Phase 2 adds columns (`raw jsonb`, `card_hash`, etc.) via ALTER migrations. Rationale: FND-08's test fixture needs a table, and it's cleaner to own the tenancy + RLS shape now than retrofit later.

4. **pgTAP vs Vitest for `business_date` assertion**
   - Recommendation: **Vitest + supabase-js** (not pgTAP). Reasoning: one test runner. pgTAP adds a Postgres extension and a second CI path for one test class.

## Environment Availability

| Dependency | Required By | Available? | Version | Fallback |
|---|---|---|---|---|
| Node.js 20+ | Vitest, TypeScript, npm | Must verify on dev machine | `node --version` | — |
| Supabase CLI | Migrations, link, db push | Must verify / install | `supabase --version` | — |
| Supabase DEV project | `supabase db push` target | **Must be provisioned** | n/a | — |
| Supabase TEST project | CI two-tenant test (D-16) | **Must be provisioned (separate from DEV)** | n/a | — |
| GitHub Actions | CI runner | ✓ (repo exists on GitHub) | — | — |
| `grep -P` on GHA ubuntu-latest | Guard 3 Perl regex | ✓ (GNU grep default) | — | Two-pass grep rewrite if switched to BusyBox |
| Docker (for `supabase start` local) | Optional local-dev | Not required for Phase 1 | — | Skip local-only workflow |

**Missing dependencies with no fallback:**
- Supabase DEV project and Supabase TEST project must be provisioned before Phase 1 execution. Planner should emit the provisioning steps as a Wave 0 task.

**Missing dependencies with fallback:**
- Docker: if not installed, skip `supabase start` (local stack) and run all tests against the hosted TEST project only.

## Validation Architecture

### Test Framework

| Property | Value |
|---|---|
| Framework | Vitest 1.x+ (TypeScript) |
| Config file | `vitest.config.ts` (Wave 0 — does not exist yet) |
| Quick run command | `npx vitest run tests/integration/<file>.test.ts` |
| Full suite command | `npx vitest run` |
| Phase gate | Full Vitest suite green + `scripts/ci-guards.sh` exits 0 before `/gsd:verify-work` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| FND-01 | `restaurants` and `memberships` tables exist with correct columns and RLS enabled | integration | `npx vitest run tests/integration/schema.test.ts` | Wave 0 |
| FND-02 | Custom Access Token Hook injects top-level `restaurant_id` claim into JWT after signInWithPassword | integration | `npx vitest run tests/integration/jwt-claim.test.ts` | Wave 0 |
| FND-03 | RLS on `restaurants`, `memberships`, `transactions` restricts `authenticated` by `auth.jwt()->>'restaurant_id'` | integration | `npx vitest run tests/integration/rls-policies.test.ts` | Wave 0 |
| FND-04 | `kpi_daily_mv` has unique index, `kpi_daily_v` wrapper filters by JWT claim, raw MV REVOKE'd from authenticated | integration | `npx vitest run tests/integration/mv-wrapper-template.test.ts` | Wave 0 |
| FND-05 | Two-tenant isolation — user A never reads user B rows in any `_v` view, `_mv` direct read denied | integration | `npx vitest run tests/integration/tenant-isolation.test.ts` | Wave 0 |
| FND-06 | Email+password login via `@supabase/ssr` succeeds; session cookie survives simulated page refresh | integration | `npx vitest run tests/integration/session-persistence.test.ts` | Wave 0 |
| FND-07 | `pii-columns.txt` exists; CI guard #4 fails on join between `card_hash` and any listed column | CI guard (bash) | `bash scripts/ci-guards.sh` | Wave 0 |
| FND-08 | `(occurred_at AT TIME ZONE r.timezone)::date` returns correct `business_date` for 23:45 Berlin and 00:30 Berlin fixtures | integration | `npx vitest run tests/integration/business-date-fixture.test.ts` | Wave 0 |
| D-08 (CI) | Every `CREATE MATERIALIZED VIEW` migration also has a `CREATE UNIQUE INDEX` | CI guard | `bash scripts/ci-guards.sh` | Wave 0 |
| D-14.1 | No `_mv` refs in `src/` | CI guard | `bash scripts/ci-guards.sh` | Wave 0 |
| D-14.2 | No unvalidated `getSession()` on server | CI guard | `bash scripts/ci-guards.sh` | Wave 0 |
| D-14.3 | All `REFRESH MATERIALIZED VIEW` statements have `CONCURRENTLY` | CI guard | `bash scripts/ci-guards.sh` | Wave 0 |

**Notes on test types:**
- **`schema.test.ts`**: queries `information_schema` / `pg_class` via service_role to assert table existence, column types, RLS enabled flag.
- **`jwt-claim.test.ts`**: creates a user + membership via admin, signs in, reads `session.access_token`, base64-decodes the JWT payload, asserts `payload.restaurant_id` is a UUID string.
- **`rls-policies.test.ts`**: tenant-scoped SELECT against `restaurants`/`memberships`/`transactions` returns only own rows.
- **`mv-wrapper-template.test.ts`**: queries `pg_indexes` for the unique index; queries `information_schema.table_privileges` to assert `authenticated` has no SELECT on `kpi_daily_mv` and does have SELECT on `kpi_daily_v`.
- **`session-persistence.test.ts`**: after sign-in, create a **new** supabase-js client with the same cookies (serialized and replayed), assert `getClaims()` still returns a valid user. This is the Vitest-level proxy for "browser refresh."

### Sampling Rate

- **Per task commit:** `npx vitest run tests/integration/<touched-file>.test.ts` + `bash scripts/ci-guards.sh`
- **Per wave merge:** `npx vitest run` (full integration suite) + `bash scripts/ci-guards.sh`
- **Phase gate:** Full Vitest suite green + all four CI guards exit 0 + `supabase db push --dry-run` clean + manual confirmation that DEV and TEST projects received the migrations

### Wave 0 Gaps

All test infrastructure is missing in the current repo. Wave 0 must produce:

- [ ] `package.json` — new (Phase 1 entry)
- [ ] `tsconfig.json` — new
- [ ] `vitest.config.ts` — new, configured for `tests/**/*.test.ts` and dotenv setup
- [ ] `tests/setup.ts` — shared clients (service_role admin + anon factory), `TEST_SUPABASE_URL !== DEV_SUPABASE_URL` guard
- [ ] `tests/integration/schema.test.ts` — FND-01
- [ ] `tests/integration/jwt-claim.test.ts` — FND-02
- [ ] `tests/integration/rls-policies.test.ts` — FND-03
- [ ] `tests/integration/mv-wrapper-template.test.ts` — FND-04
- [ ] `tests/integration/tenant-isolation.test.ts` — FND-05 (the big one, Pattern 6)
- [ ] `tests/integration/session-persistence.test.ts` — FND-06
- [ ] `tests/integration/business-date-fixture.test.ts` — FND-08
- [ ] `scripts/ci-guards.sh` — FND-07 + D-14 (all four guards)
- [ ] `pii-columns.txt` — empty file with header comment
- [ ] `.github/workflows/guards.yml` — runs `ci-guards.sh` on every PR
- [ ] `.github/workflows/tests.yml` — runs `vitest run` against TEST Supabase project on every PR
- [ ] `.github/workflows/migrations.yml` — `supabase db push` against DEV on merge to main
- [ ] Framework install: `npm install -D vitest typescript @types/node tsx dotenv && npm install @supabase/supabase-js @supabase/ssr`
- [ ] Supabase CLI install: `brew install supabase/tap/supabase` (or equivalent)
- [ ] Supabase DEV + TEST project provisioning (manual, via dashboard)
- [ ] GHA secrets: `SUPABASE_PROJECT_REF_DEV`, `SUPABASE_DB_PASSWORD`, `TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY`, `TEST_SUPABASE_SERVICE_ROLE_KEY`

## Build Order (Phase 1 only)

The only valid order. Deviations cause rewrites.

1. Provision Supabase DEV + TEST projects; capture refs and keys as GHA secrets.
2. `npm init`, `tsconfig.json`, `vitest.config.ts`, install deps.
3. `supabase init`, `supabase link --project-ref <dev>`.
4. Migration `0001_tenancy_schema.sql` — `restaurants`, `memberships`, enum, RLS on both.
5. Migration `0002_auth_hook.sql` — `custom_access_token_hook` function + grants.
6. Register the hook in Supabase Dashboard (DEV and TEST).
7. Migration `0003_transactions_skeleton.sql` — `transactions` table with RLS (FND-08 needs a table for the fixture).
8. Migration `0004_kpi_daily_mv_template.sql` — MV + unique index + `_v` wrapper + REVOKE (the template).
9. Migration `0005_seed_tenant.sql` — single seed restaurant + friend's `auth.users` row + membership (auth user created via `supabase.auth.admin.createUser` in a one-shot seed script or dashboard, since SQL can't create auth users directly — document the manual step).
10. Write Vitest tests in the order from the Req→Test map. Tenant isolation test last (depends on MV + wrapper).
11. Write `scripts/ci-guards.sh` and `.github/workflows/guards.yml`.
12. Write `.github/workflows/tests.yml` and `.github/workflows/migrations.yml`.
13. Write `docs/reference/hooks.server.ts.example` and `+layout.server.ts.example`.
14. Run full suite locally → green → PR → guards + tests green → merge → migrations.yml pushes to DEV.

## Project Constraints (from CLAUDE.md)

The planner MUST honor these beyond CONTEXT.md:

- **Default environment DEV** for verification; never local-only. Push → deploy → verify.
- **Per-task QA mandatory** — self-verify before asking user. Use `curl` / DB MCP / logs.
- **Security paramount** — no hardcoded credentials, least privilege. Applies directly to service_role key handling in tests.
- **No `Co-authored-by: Claude` in git commits** — forbidden.
- **Minimal changes, replace don't just add** — deleting any stub files once real implementations exist.
- **Junior-friendly comments** — every migration file gets a short purpose comment at top.
- **GSD Workflow Enforcement** — all file edits must go through a GSD command.
- **Stack lockdown from CLAUDE.md "What NOT to Use":** no `@supabase/auth-helpers-sveltekit`, no `svelte-chartjs`, no Moment.js, no Cloudflare D1, no Anthropic calls from browser, no direct `_mv` query from `src/`, no Supabase Realtime.
- **Card-hash only; never PAN/PII.** FND-07 is the enforcement point.

## Sources

### Primary (HIGH confidence)
- `.planning/research/ARCHITECTURE.md` — full data-plane architecture; wrapper-view discussion
- `.planning/research/PITFALLS.md` — 25 cataloged pitfalls with Phase-1 applicability table
- `CLAUDE.md` — stack lockdown, "What NOT to Use" list, version matrix
- `.planning/phases/01-foundation/01-CONTEXT.md` — all locked decisions D-01..D-16
- [Supabase Custom Access Token Hook docs](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook) — function signature, grants, event shape
- [Supabase SvelteKit SSR auth guide](https://supabase.com/docs/guides/auth/server-side/sveltekit) — `createServerClient` cookies pattern, `getClaims` recommendation
- [Supabase RLS on MVs discussion #17790](https://github.com/orgs/supabase/discussions/17790) — wrapper-view rationale
- [PostgreSQL docs — CREATE VIEW `security_invoker`](https://www.postgresql.org/docs/15/sql-createview.html) — default `security_invoker=off` semantics

### Secondary (MEDIUM confidence)
- [j4w8n/sveltekit-supabase-ssr reference repo](https://github.com/j4w8n/sveltekit-supabase-ssr) — current community `hooks.server.ts` shape
- [DEV: Perfect Local SvelteKit Supabase Setup in 2025](https://dev.to/jdgamble555/perfect-local-sveltekit-supabase-setup-in-2025-4adp) — matches official guidance
- [Answer Overflow: getClaims sliding session](https://www.answeroverflow.com/m/1410711682770014248) — `getClaims` usage in SvelteKit

### Tertiary (LOW confidence — verify at plan time)
- Exact `config.toml` syntax for hook registration — **UNRESOLVED**, see Open Question 1
- Minimum `@supabase/supabase-js` version exposing `auth.getClaims()` — **UNRESOLVED**, see Open Question 2

## Metadata

**Confidence breakdown:**
- Tenancy schema + RLS: HIGH — standard Supabase patterns, verified against official docs
- JWT hook SQL: HIGH — matches current Supabase docs verbatim; grants explicitly documented
- Wrapper-view `security_invoker=off` reliance: HIGH — Postgres default view semantics plus Supabase discussion #17790
- SvelteKit `safeGetSession` / `getClaims`: MEDIUM — community reference repo matches guidance but exact API surface needs re-verification against installed version
- CI grep guards: HIGH — bash patterns straightforward; `grep -P` available on GHA
- Two-tenant Vitest harness: HIGH — standard `@supabase/supabase-js` admin API
- `business_date` AT TIME ZONE pattern: HIGH — Postgres-standard, already verified in research/PITFALLS.md
- `config.toml` hook registration: LOW — Dashboard path works; file-based registration unconfirmed

**Research date:** 2026-04-13
**Valid until:** 2026-05-13 (30 days; Supabase APIs are stable but `@supabase/ssr` minor versions ship monthly — re-verify `getClaims` before Phase 4)
