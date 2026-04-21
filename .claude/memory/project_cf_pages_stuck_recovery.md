---
name: CF Pages stuck after Error 1102 — manual redeploy recovers
description: ramen-bones-analytics.pages.dev can start returning HTTP 404 "Not found" for every SSR route (9-byte body) after a Worker Error 1102 event; re-running the Deploy workflow on main re-pins a working production deployment. Static assets (e.g., /robots.txt) keep serving throughout.
type: project
---

The deployed site ramen-bones-analytics.pages.dev can reach a state where:

- **Static assets** (e.g., `/robots.txt`) return **HTTP 200** normally.
- **Every SSR route** (e.g., `/`, `/login`) returns **HTTP 404** with the literal 9-byte body `Not found` and no `x-sveltekit-page` header.
- No JS runs in the browser, no console messages — it's Cloudflare's edge returning a bare 404, not the SvelteKit app.

Observed on 2026-04-21 after an earlier CF Error 1102 ("Worker exceeded resource limits") at 11:44 UTC on commit `64bd33a`. The Pages Worker became effectively detached — same commit, same artifacts, but the production URL stopped routing to it.

**Recovery (verified on 2026-04-21):** manually dispatch the Deploy workflow on `main`:

```
gh workflow run deploy.yml --ref main
```

This re-pins a fresh production deployment. No code change was needed for recovery — the same commit `64bd33a` redeployed successfully and `/login` immediately went from 404 → HTTP 200 with `x-sveltekit-page: true`.

**Why:** CF Pages appears to unpin/detach the production deployment after enough per-request 1102 CPU-limit hits on the free tier. The Pages project stays alive (static pipeline keeps working), but the Worker half goes dark until a new deployment is pinned.

**How to apply:** If the user reports the deployed site returning "Not found" or a white page:
1. First verify with `curl -sS -o /dev/null -w "HTTP %{http_code} size=%{size_download}\n" https://ramen-bones-analytics.pages.dev/` — if you see `HTTP 404 size=9`, this is the same symptom.
2. Also check `/robots.txt` — if it returns 200, confirms the "Pages alive, Worker dead" pattern.
3. Run `gh workflow run deploy.yml --ref main` to re-pin.
4. Then investigate WHY the Worker hit 1102 (SSR load function doing too much CPU work, infinite loop, heavy date/chart computation on cold start, etc.) — the redeploy is a bandage, not a root-cause fix. Repeat 1102 events will re-trigger the stuck state.
