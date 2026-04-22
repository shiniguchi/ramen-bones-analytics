---
name: visual-verify-nudge hook targets localhost, not DEV
description: For ramen-bones-analytics, the PostToolUse visual-verify-nudge hook in .claude/hooks/verify-targets.json must point at http://localhost:5173 (Vite hot-reload), not the DEV CF Pages URL.
type: feedback
---

The visual-verify-nudge hook (PostToolUse on Edit/Write/MultiEdit of frontend files) in `.claude/hooks/verify-targets.json` should default to `http://localhost:5173` for ramen-bones-analytics. Do not retarget it at `https://ramen-bones-analytics.pages.dev`.

**Why:** The hook fires on every Svelte save. Pointing it at DEV forces a `git push` + ~60s CF Pages deploy cycle just to satisfy a per-edit nudge — that destroys the local feedback loop. Local Vite hot-reload is the right place for the per-save quick check. The project rule in `.claude/CLAUDE.md` ("Always work against DEV unless the user says local or prod") applies to **final QA** before reporting work complete, not to the per-edit hook reminder. These are two distinct verification points; do not conflate them.

I made this exact wrong call once (commit `12404df`, retargeting verify-targets.json at the DEV URL) and was corrected. The CJS-scope `.claude/hooks/package.json` from that same commit IS correct and must stay — only the URL retarget was wrong.

**How to apply:**
- When editing `.claude/hooks/verify-targets.json` in this repo: keep `defaultUrl` and rule URLs at `http://localhost:5173`.
- When the user is doing active local development: assume `bun run dev` is running. The hook reminder will tell me to navigate to localhost — do that, not DEV.
- For final QA before reporting a task complete: switch to DEV per `.claude/CLAUDE.md` (push → deploy → Chrome MCP verify on `https://ramen-bones-analytics.pages.dev`). This is a separate, manual step.
- Do not propagate this URL choice upstream to `AiLine/shared-docs` — that template is meant to be neutral and per-repo customizable. Each consuming repo sets its own URL in its own `verify-targets.json`.
