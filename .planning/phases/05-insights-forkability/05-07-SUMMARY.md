---
plan: 05-07
status: complete
gap_closed: "Gap 1 — no deployed HTTPS URL"
completed: 2026-04-15
---

# 05-07 Summary — Cloudflare Pages deployment

## Outcome

**Gap 1 from 05-HUMAN-UAT.md is CLOSED.** The SvelteKit dashboard is reachable at a public HTTPS URL, verified end-to-end by the founder signing in on Safari/macOS with the `iguchise@gmail.com` account and landing on the dashboard.

**Production URL:** https://ramen-bones-analytics.pages.dev
**First deploy:** 2026-04-15T13:42:00Z
**Final deploy commit:** `99a104b`

## Task status

| Task | Status | Notes |
|------|--------|-------|
| 1. `wrangler.toml` + build adapter-cloudflare output | ✅ | Commit `7840372`. Build artifact at `.svelte-kit/cloudflare/` (gitignored). Plan expected `_worker.js/index.js` (directory form) but adapter-cloudflare v7.2.x emits single-file `_worker.js` — valid, deploys correctly. |
| 2. CF Pages project create + env var bind (human action) | ✅ | Founder created project via `dash.cloudflare.com` Upload-assets flow, dragged `.svelte-kit/cloudflare/` into the upload zone, clicked Deploy. Env vars bound in Production. |
| 3. Deploy via wrangler + smoke test | ✅ | Two deploy attempts — first via dashboard Upload flow failed (`_worker.js` not recognized in Direct Upload without wrangler). Switched to `npx wrangler pages deploy .svelte-kit/cloudflare` which succeeded but returned HTTP 500 due to missing `nodejs_compat` flag. Added `compatibility_flags = ["nodejs_compat"]` to `wrangler.toml` (commit `99a104b`) and redeployed. |

## Verification evidence

**HTTP smoke test:**
```
$ curl -sI -L https://ramen-bones-analytics.pages.dev/ | grep -E "HTTP|Location"
HTTP/1.1 303 See Other
Location: /login
HTTP/1.1 200 OK
```

The `/` route issues a `303 → /login` redirect for unauthenticated requests, and `/login` returns `200 OK` with the SvelteKit login page. This matches the expected unauthenticated flow from Phase 4's routing.

**Founder-account end-to-end:**
Founder signed in with `iguchise@gmail.com` on Safari/macOS against `https://ramen-bones-analytics.pages.dev`. Result: lands on the dashboard (not `/not-provisioned`), page renders, no errors.

## Files committed

- `wrangler.toml` (commit `7840372`, then `99a104b` for the compat flag)
- `.cloudflare/pages-project.md` (this commit)
- `.planning/phases/05-insights-forkability/05-07-SUMMARY.md` (this file)

## Deviations from plan

1. **Acceptance criterion about `_worker.js/index.js` (directory form):** `adapter-cloudflare` v7.2.x emits a single-file `_worker.js` instead. Artifact is valid and deployable — adjusted criterion retroactively.
2. **Dashboard Upload flow failed first try:** Plan text suggested "Upload assets" path, but that flow doesn't correctly process `_worker.js` in 2026 CF dashboard — wrangler CLI is the only path that works for SvelteKit full-stack. Plan should be updated for future forkers to skip the dashboard drag-drop entirely.
3. **`nodejs_compat` flag was missing from Task 1:** SvelteKit's `@sveltejs/kit` runtime imports `node:async_hooks`, which requires the `nodejs_compat` compatibility flag on Pages. Without it, every request returns HTTP 500. Added to `wrangler.toml` in commit `99a104b`. Plan Task 1 should include this from the start.

## Forker impact

The README forker walkthrough (from 05-05) should be updated to mention:
- Use wrangler CLI for the first deploy, not the dashboard Upload flow
- `wrangler.toml` must include `compatibility_flags = ["nodejs_compat"]`

## Next

With Gap 1 closed, 05-06 Task 3 (friend's iPhone sign-off) is one step closer. Still blocked on:
- **05-08** — friend's Supabase Auth user not yet provisioned
- **05-09** — LLM insight path verification (in progress now that `ANTHROPIC_API_KEY` is set)

Once 05-08 and 05-09 close, 05-06 Task 3 becomes fully runnable.
