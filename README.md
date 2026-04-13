# Ramen Bones Analytics

A free, forkable, mobile-first analytics web app that turns Orderbird POS transactions
into banking-grade growth metrics (cohorts, retention, LTV) for non-technical restaurant
owners.

**V1 tenant:** one ramen shop (the founder's friend). Architecture is multi-tenant-ready
from day 1 so any restaurant owner can fork or self-host.

## Stack

- **Frontend:** SvelteKit 2 + Svelte 5 runes, Cloudflare Pages (`adapter-cloudflare`)
- **Backend:** Supabase Postgres + Edge Functions + `pg_cron`
- **Auth:** `@supabase/ssr` (cookie-based SSR). Never `@supabase/auth-helpers-sveltekit`.
- **Extraction:** Python 3.12 + Playwright, hosted on GitHub Actions cron
- **Insights:** Claude API via Supabase Edge Function, triggered by `pg_cron` → `pg_net`

See `CLAUDE.md` for the full tech-stack rationale and "What NOT to Use" list.

## Forker quickstart (Phase 1)

1. Fork and clone this repo.
2. Create two Supabase projects: `rba-dev` and `rba-test`.
3. Copy `.env.test.example` → `.env.test` and fill in the TEST project's URL, anon key,
   and service-role key.
4. `npm install`
5. Apply migrations to DEV:
   `supabase login && supabase link --project-ref <dev-ref> && supabase db push`
6. Apply migrations to TEST: repeat `supabase link` + `supabase db push` against the
   TEST project ref.
7. In **both** Supabase projects: Authentication → Hooks → Custom Access Token Hook →
   select `public.custom_access_token_hook`. See
   [`docs/reference/auth-hook-registration.md`](docs/reference/auth-hook-registration.md)
   for the exact dashboard steps. Without this step, RLS will deny every query silently.
8. `npx vitest run` — all Phase 1 integration tests should go green against the TEST
   project.
9. `bash scripts/ci-guards.sh` — all four CI guards should exit 0.
10. Create your first user via the Supabase Dashboard → Authentication → Users, and
    insert a row into `public.memberships` linking that user to the seeded restaurant
    (see `supabase/migrations/0005_seed_tenant.sql`).
11. Push to a branch on GitHub; the `CI Guards`, `Tests`, and `DB Migrations (DEV)`
    workflows run automatically.

## Phase 4 handoff (SvelteKit wiring)

Phase 1 validates session persistence at the `supabase-js` `setSession` layer only.
Phase 4 copies the reference files in `docs/reference/` into `src/` and re-validates
FND-06 end-to-end through an actual browser refresh via `@supabase/ssr` cookie
hydration:

- `docs/reference/hooks.server.ts.example` → `src/hooks.server.ts`
- `docs/reference/+layout.server.ts.example` → `src/routes/+layout.server.ts`
- `docs/reference/login/` → `src/routes/login/`

## What Phase 1 does NOT include

- Dashboard UI (Phase 4)
- Orderbird scraper (Phase 2)
- Analytics SQL — cohorts, retention, LTV (Phase 3)
- Claude nightly insights (Phase 5)

Phase 1 is pure infrastructure: tenancy schema, auth hook, RLS, materialized-view
wrapper template, CI guards, and the integration test harness.

## Project docs

- `.planning/PROJECT.md` — vision and non-negotiables
- `.planning/REQUIREMENTS.md` — FND-01..FND-08 acceptance criteria
- `.planning/ROADMAP.md` — five-phase roadmap
- `CLAUDE.md` — tech-stack rationale and forbidden patterns
