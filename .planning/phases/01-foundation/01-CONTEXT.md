# Phase 1: Foundation - Context

**Gathered:** 2026-04-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver a multi-tenant data plane that is provably isolated and day-boundary-correct before any analytical SQL is written. Scope: Supabase schema (`restaurants`, `memberships`), email/password auth via `@supabase/ssr`, RLS on every tenant-scoped table, a JWT custom access token hook injecting `restaurant_id`, the security-definer-free wrapper-view template that every later MV will copy, per-tenant timezone for business-date derivation, and CI grep guards that block merges on the four forbidden patterns.

Out of scope for this phase: any analytics SQL (Phase 3), any dashboard UI beyond the login redirect (Phase 4), the Playwright scraper (Phase 2), Claude insight generation (Phase 5).

</domain>

<decisions>
## Implementation Decisions

### Tenant Model + JWT Claim
- **D-01:** Schema is N:M via `memberships(user_id, restaurant_id, role)`. V1 seeds exactly one row (founder's friend → the one ramen restaurant); multi-tenant-ready with zero rewrite.
- **D-02:** `memberships.role` is a Postgres enum with values `owner` and `viewer`. Friend = owner in v1; two values cover Phase 5 fork/self-host without migration.
- **D-03:** `restaurants` has at minimum: `id uuid pk`, `name text`, `timezone text NOT NULL` (see D-09), `created_at timestamptz`. Additional columns added only when a later phase needs them.
- **D-04:** A Supabase custom access token hook (SQL function) reads `memberships` and injects a single `restaurant_id` top-level claim into the JWT. RLS policies read `auth.jwt()->>'restaurant_id'`. Hook is idempotent and handles the zero-membership case by returning the token unchanged (login still works; RLS naturally denies all tenant rows).
- **D-05:** V1 assumes one membership per user. Array-of-ids is explicitly deferred — when a user joins a second restaurant, migrate the claim shape and RLS policies together.

### Wrapper-View Template
- **D-06:** Tenant-scoped reads go through plain SQL views with an explicit `WHERE restaurant_id = (auth.jwt()->>'restaurant_id')::uuid` clause, not security-definer functions. Rationale: PostgREST / `@supabase/ssr` call `.from('kpi_daily_v')` naturally; security-definer would force `.rpc()` and complicate Phase 4 data fetching.
- **D-07:** Every materialized view is locked down with `REVOKE ALL ON <mv_name> FROM anon, authenticated`. Only `postgres` / `service_role` can touch the raw `_mv`. The wrapper view (`*_v`) is the sole tenant-facing entry point.
- **D-08:** The mandatory unique index on every MV is enforced via a migration template and a CI grep check: any `CREATE MATERIALIZED VIEW` statement without a matching `CREATE UNIQUE INDEX` in the same migration file fails the build. This guarantees `REFRESH MATERIALIZED VIEW CONCURRENTLY` works from Phase 3 onward.
- **D-08a:** Phase 1 implements this template on `kpi_daily_mv` as the canonical example. The MV itself can be a trivial placeholder (e.g., `SELECT restaurant_id, current_date AS business_date, 0::numeric AS revenue`) — its job is to prove the pattern (wrapper view + REVOKE + unique index + RLS-via-JWT), not produce real numbers.

### Auth UX + Timezone
- **D-09:** Per-tenant timezone stored as `restaurants.timezone text NOT NULL` (seeded to `'Europe/Berlin'` for v1). Every analytical query derives `business_date` server-side via `(occurred_at AT TIME ZONE r.timezone)::date`. Hardcoded constants and client-side conversion are forbidden — the test fixture at 23:45 Berlin must land in the correct business day.
- **D-10:** V1 skips the signup page. Founder pre-creates the friend's user via the Supabase dashboard and shares credentials. Saves ~1 day vs a 2-week MVP budget. Signup UI deferred to Phase 5 forkability.
- **D-11:** Password reset uses Supabase's default recovery email — no custom `/reset` route in v1. If the friend forgets, founder triggers reset from dashboard.
- **D-12:** Login uses email + password via `@supabase/ssr` (cookie-based SSR session). `@supabase/auth-helpers-sveltekit` is explicitly forbidden (deprecated — see CLAUDE.md "What NOT to Use"). Server hooks use `safeGetSession()` / `getUser()`, never `getSession()` alone — this is one of the CI guards (D-14).

### CI Guards + Tooling
- **D-13:** CI grep guards live in a single `.github/workflows/guards.yml` and run on every PR. No pre-commit hook, no local make target — keeps the fork experience friction-free (clone → push → CI runs).
- **D-14:** Four grep guards block merge:
  1. Any reference to `*_mv` from `src/` (frontend must only touch wrapper views).
  2. `getSession(` called inside `+*.server.ts` or `hooks.server.ts` without `safeGetSession`/`getUser` in the same file (prevents trusting unverified session tokens).
  3. `REFRESH MATERIALIZED VIEW` not followed by `CONCURRENTLY` in any `supabase/migrations/**/*.sql`.
  4. `card_hash` joined against any column listed in a small `pii-columns.txt` manifest (starts empty; populated as PII columns are introduced in Phase 2).
- **D-15:** Database migrations managed via Supabase CLI. `supabase/migrations/*.sql` checked into repo. `supabase db push` runs from GHA against the project's DEV environment. Forkability path: clone → `supabase link` → `supabase db push`.
- **D-16:** Two-tenant isolation integration test written in Vitest with `@supabase/supabase-js`. Test seeds tenants A and B via `service_role`, signs in as each user, and asserts every wrapper view (starting with `kpi_daily_v`) returns only the signed-in tenant's rows and zero cross-reads. Test file: `tests/integration/tenant-isolation.test.ts`. Runs in GHA against a dedicated test Supabase project (separate from DEV to keep seeded test data isolated).

### Claude's Discretion
- Exact column list for `restaurants` and `memberships` beyond the minimums in D-03 — add only what's needed to satisfy FND-01..08.
- Migration file naming / ordering (follow Supabase CLI conventions).
- Choice of Vitest config and test-runner wiring (the app itself doesn't exist yet in Phase 1; tests may live in a dedicated `tests/` tree until Phase 4 bootstraps SvelteKit).
- Whether the JWT hook is a plain SQL function or a Postgres function + `pgsodium`-style secret — pick whichever Supabase's current docs recommend.
- Placeholder content of the v1 `kpi_daily_mv` (it just has to be a valid MV the template works against).

### Folded Todos
None — no pending todos matched this phase.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project
- `CLAUDE.md` — Tech stack, "What NOT to Use" list, version compatibility, critical gotchas (RLS+MV, REFRESH CONCURRENTLY, `@supabase/ssr` trust, Workers ≠ Node).
- `.planning/PROJECT.md` — Vision, constraints, non-negotiables (multi-tenant-ready, forkable, card-hash only).
- `.planning/REQUIREMENTS.md` §FND-01..FND-08 — The eight acceptance criteria this phase must satisfy.
- `.planning/ROADMAP.md` §"Phase 1: Foundation" — Goal and five success criteria.
- `.planning/research/` — Upstream research notes from `/gsd:new-project` (any Supabase/RLS/SvelteKit research lives here).

### External (for downstream researcher to fetch fresh)
- Supabase SvelteKit SSR auth guide — https://supabase.com/docs/guides/auth/server-side/sveltekit
- Supabase Custom Access Token Hook docs — https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook
- Supabase RLS on materialized views discussion #17790 — https://github.com/orgs/supabase/discussions/17790
- `@supabase/ssr` npm — https://www.npmjs.com/package/@supabase/ssr
- Supabase CLI migrations docs — https://supabase.com/docs/guides/cli/local-development

No ADRs or internal specs exist yet — this phase establishes the patterns future phases will reference.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
None — greenfield repo. Only `.planning/`, `.claude/`, and docs exist. No `src/`, no `supabase/`, no `tests/` yet. This phase creates the skeleton.

### Established Patterns
None in code. Patterns locked by CLAUDE.md tech-stack section take precedence: SvelteKit 2 + Svelte 5 runes, `@supabase/ssr`, Supabase CLI migrations, Vitest for app tests, Tailwind v4 + shadcn-svelte@next (deferred to Phase 4 UI work).

### Integration Points
- Phase 2 (Extraction) will write into `transactions` — this phase must create the table with `restaurant_id`, `card_hash`, `occurred_at timestamptz`, and the upsert-friendly natural key (`source_tx_id`) so EXT-02 has a home.
- Phase 3 (Analytics SQL) will copy the wrapper-view + REVOKE + unique-index template from `kpi_daily_mv` to every new MV.
- Phase 4 (Mobile Reader UI) will consume the SvelteKit auth hooks and `.from('*_v')` patterns established here.

</code_context>

<specifics>
## Specific Ideas

- Friend's restaurant is the single tenant in v1. Seed it via a migration (not the dashboard) so forkers can see the shape.
- `kpi_daily_mv` chosen as the canonical template target because it's the simplest shape (one row per restaurant per business_date) and Phase 4 will need it on the dashboard anyway.
- Test Supabase project (separate from DEV) for the tenant-isolation test is a deliberate choice — seeded tenants A and B should never contaminate DEV data.

</specifics>

<deferred>
## Deferred Ideas

- **Signup page with self-serve tenant creation** → Phase 5 (Forkability). A fork needs this to be useful; v1 doesn't.
- **Custom password reset UI** → Phase 5 or later. Supabase default email is sufficient for one user.
- **JWT claim as array of `restaurant_ids`** → when a user joins a second restaurant. Migrate claim shape + RLS policies + memberships lookup together.
- **Schema-per-tenant isolation** → only if performance walls appear. Current plan stays on row-level tenant_id.
- **Role-based permissions beyond owner/viewer** (e.g., accountant, manager) → future phase when self-hosters ask for them.
- **PII-columns manifest population** → Phase 2 will add entries as the scraper introduces any PII-adjacent columns.

### Reviewed Todos (not folded)
None — no pending todos surfaced by cross-reference.

</deferred>

---

*Phase: 01-foundation*
*Context gathered: 2026-04-13*
