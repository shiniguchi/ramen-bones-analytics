# GSD Debug Knowledge Base

Resolved debug sessions. Used by `gsd-debugger` to surface known-pattern hypotheses at the start of new investigations.

---

## cf-pages-deploy-broken — CF Pages deploys sporadic because no GHA deploy workflow existed
- **Date:** 2026-04-15
- **Error patterns:** cloudflare pages, deploy stale, no auto-deploy, wrangler pages deploy, Git Provider No, deploy not triggered on push, sporadic deploys
- **Root cause:** CF Pages project was created in direct-upload mode via `wrangler pages deploy` and never connected to a GitHub source (`wrangler pages project list` showed `Git Provider: No`). No `.github/workflows/deploy.yml` existed either, so deploys only happened when a human manually ran wrangler from a dev machine. The "broken since commit X" framing was a red herring — X was just the last manual deploy before the gap.
- **Fix:** Added `.github/workflows/deploy.yml` running on push to main: checkout → setup-node → npm ci → npm run build → wrangler-action `pages deploy .svelte-kit/cloudflare --project-name=ramen-bones-analytics --branch=main`. Required repo secrets: CLOUDFLARE_API_TOKEN (Pages:Edit), CLOUDFLARE_ACCOUNT_ID, plus PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_PUBLISHABLE_KEY (inlined at build time).
- **Files changed:** .github/workflows/deploy.yml
---
