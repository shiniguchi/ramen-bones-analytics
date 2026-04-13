# Reference files

These are copy-ready references for Phase 4 (SvelteKit app). They live here so that:

1. CI guard #2 has a real file under `docs/reference/` to scan — any `getSession(`
   on a server file without a matching `getClaims(` or `getUser(` fails the build.
2. Phase 4 can copy them verbatim into `src/` and drop the `.example` suffix.

Do not import from these files at runtime.

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
