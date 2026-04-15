---
status: resolved
trigger: "CF Pages deploy broken since a3623b9 — blocks Phase 6 UAT & v1 MVP ship"
created: 2026-04-15
updated: 2026-04-15
---

## Current Focus

hypothesis: CONFIRMED — no deploy workflow existed; deploys were manual-only
test: Added .github/workflows/deploy.yml, pushed, observed run
expecting: Green workflow + new CF Pages deployment at HEAD
next_action: none — resolved

## Symptoms

expected: Pushes to main trigger CF Pages deploy, DEV URL reflects latest commit
actual: DEV deploy stale since a3623b9, blocks Phase 6 UAT at 375px
errors: Not yet captured
reproduction: Push to main, observe DEV URL not updating
started: Claimed since a3623b9 (2026-04-15 12:43 CET) — timeline unverified

## Eliminated

## Evidence

- checked: `wrangler pages project list` → `Git Provider: No` for ramen-bones-analytics
  found: CF Pages project has NO GitHub integration. Deploys only happen when someone manually runs `wrangler pages deploy`.
- checked: `wrangler pages deployment list`
  found: Deploy timeline is SPORADIC, not broken. Latest deploy 16 min ago at commit 1ce2812 succeeded. Latest commit 209a967 has no deploy. Intermediate commits 8c8655c/218bfba/46d1e81 also have no deploys. Pattern: manual wrangler invocations, not per-push.
- checked: `.cloudflare/pages-project.md`
  found: Phase 05-07 created the project via `wrangler pages deploy` direct upload — never connected to git. `PUBLIC_*` env vars are inlined at build time, so any runner with local env can build+deploy.
- checked: `06-HUMAN-UAT.md:80`
  found: Prior phase already flagged "CF Pages Git integration still broken — auto-deploy didn't reconnect; Phase 6 shipped via one-shot wrangler pages deploy." Confirms the disconnect is a pre-existing issue, not caused by a3623b9.
- checked: `.github/workflows/` — only guards.yml, migrations.yml, tests.yml
  found: NO deploy workflow exists. Tests failure is an orthogonal issue (bad TEST_SUPABASE_DB_PASSWORD secret, SASL auth fail) — does NOT affect deploys because no workflow reads tests status to gate deploys, and no deploy workflow exists at all.
- checked: `npm run build` locally
  found: Build succeeds, produces `.svelte-kit/cloudflare/` with `_worker.js`, `_headers`, `_routes.json`. Deployable artifact works fine.
- checked: `git log -- .github/workflows/`
  found: No deploy workflow has ever existed in history. This isn't a regression — it's an absent feature.

## Resolution

root_cause: The CF Pages project was created in Phase 05-07 via `wrangler pages deploy` direct-upload mode and was never connected to a GitHub source (`Git Provider: No`). There is also no GitHub Actions workflow that runs `wrangler pages deploy` on push. Consequently, deploys only happen when someone manually runs the wrangler command from a dev machine — which explains the "sporadic deploy since a3623b9" pattern. The commit a3623b9 in the symptom report is a red herring: it happens to be the commit of the last manual deploy before the gap. Nothing about a3623b9 itself broke anything. The `Tests` workflow failing since the same window is a separate issue (expired TEST_SUPABASE_DB_PASSWORD) that does not gate deploys.
fix: Add a new GitHub Actions workflow `.github/workflows/deploy.yml` that runs on push to `main`: checkout, install deps, build SvelteKit, then `wrangler pages deploy .svelte-kit/cloudflare --project-name=ramen-bones-analytics --branch=main`. Requires two repo secrets: `CLOUDFLARE_API_TOKEN` (Pages:Edit scope) and `CLOUDFLARE_ACCOUNT_ID` (2bce800c199617e404389eb718146ae6, already visible in wrangler output). PUBLIC_* env vars are inlined at build time — add them as workflow env from repo secrets (PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY).
verification: CONFIRMED by user. All 4 GH secrets set (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY). Workflow committed d2b8591 and pushed to main. Run 24481554088 completed green in 56s (all steps: checkout, setup-node, npm ci, npm run build, wrangler-action pages deploy). `wrangler pages deployment list` shows latest production deploy source = d2b8591 at https://7be8cbc2.ramen-bones-analytics.pages.dev. Alias https://ramen-bones-analytics.pages.dev returns HTTP 303 → /login (expected, auth-gated). Phase 6 UAT at 375px unblocked.
files_changed: [.github/workflows/deploy.yml]

## Follow-ups (out of scope for this session)

- **GH Actions Node 20 deprecation:** Run annotation warns actions using Node.js 20 will stop working 2026-06-02. Update wrangler-action / setup-node to Node 24 compatible versions before that date.
- **Tests workflow SASL auth failure:** `Tests` workflow still fails on `TEST_SUPABASE_DB_PASSWORD`. Requires DB password rotation in the TEST Supabase project and `gh secret set TEST_SUPABASE_DB_PASSWORD`. Orthogonal to deploy pipeline — does not gate deploys.
