# Cloudflare Pages deployment

**Project:** ramen-bones-analytics
**Production URL:** https://ramen-bones-analytics.pages.dev
**First deploy:** 2026-04-15T13:42:00Z
**Account:** iguchise@gmail.com

## Deploy command

```bash
npm run build
npx wrangler pages deploy .svelte-kit/cloudflare \
  --project-name=ramen-bones-analytics \
  --branch=main \
  --commit-dirty=true
```

## Env vars (bound in CF Pages dashboard → Settings → Environment variables → Production)

- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Note: SvelteKit `PUBLIC_*` env vars are inlined at **build time** (via Vite), so
the local `.env` values are baked into `_worker.js`. The dashboard bindings exist
as a forker-facing placeholder for CI rebuilds.

## Compatibility flags

`wrangler.toml` sets `compatibility_flags = ["nodejs_compat"]`. Required because
`@sveltejs/kit` imports `node:async_hooks` at runtime — without this flag the
worker 500s on every request.

## Redeploy

Single command — see "Deploy command" above. No dashboard click-through needed
after the one-time project creation.
