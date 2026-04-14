# Reference files

These are copy-ready references for Phase 4 (SvelteKit app). They live here so that:

1. CI guard #2 has a real file under `docs/reference/` to scan — any `getSession(`
   on a server file without a matching `getClaims(` or `getUser(` fails the build.
2. Phase 4 can copy them verbatim into `src/` and drop the `.example` suffix.

Do not import from these files at runtime.

## ⚠ Hazard: dual Supabase projects + a single CLI link

This repo touches two Supabase projects:
- **DEV** — `paafpikebsudoqxwumgm` — primary target for everything except integration tests
- **TEST** — `akyugfvsdfrwuzirmylo` — used by Phase 1/3 integration tests

The `supabase` CLI can only be linked to **one** project at a time via `supabase link --project-ref ...`. A single `.env` does not disambiguate. **Phase 3 lost migrations 0010..0014 to DEV for weeks** because the CLI was silently linked to TEST when `supabase db push` ran (see `.planning/phases/04-mobile-reader-ui/04-VERIFICATION.md` §"Gap C").

**Rules of thumb:**
1. Before `supabase db push`, always run `supabase status` (or `supabase projects list`) and confirm the linked ref matches the project you intend to touch.
2. After any push, run `npm run test:guards` — it now includes a migration-drift check (`scripts/check-migration-drift.sh`) that pings the linked project's `schema_migrations` and fails if local files are ahead.
3. If you are switching projects mid-session, re-link explicitly: `supabase link --project-ref <ref>`.
4. CI: set `SUPABASE_DB_URL` (read-only role is fine) so the drift guard runs unconditionally.

## How to wire into `src/` (Phase 4)

1. Copy each `.example` file to its target under `src/`, dropping the `.example` suffix:
   - `docs/reference/hooks.server.ts.example` → `src/hooks.server.ts`
   - `docs/reference/+layout.server.ts.example` → `src/routes/+layout.server.ts`
   - `docs/reference/login/+page.svelte.example` → `src/routes/login/+page.svelte`
   - `docs/reference/login/+page.server.ts.example` → `src/routes/login/+page.server.ts`
2. Set required env vars in `.env` / Cloudflare Pages project settings:
   - `PUBLIC_SUPABASE_URL`
   - `PUBLIC_SUPABASE_PUBLISHABLE_KEY`
3. Add `App.Locals` types for `supabase` and `safeGetSession` in `src/app.d.ts`.

## Forbidden packages

- `@supabase/auth-helpers-sveltekit` — deprecated. Use `@supabase/ssr` only (D-12, CLAUDE.md "What NOT to Use").
