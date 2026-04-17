---
quick_id: 260418-0td
description: Clean up unstaged MCP config changes
date: 2026-04-17
status: complete
commits:
  - f8970f2 — chore(quick-260418-0td): consolidate MCP config + add local supabase-dev server
  - b20cad6 — docs(quick-260417-o8a): commit lingering PLAN.md artifact
---

# SUMMARY

## What was done

Resolved 3 issues in unstaged MCP config changes:

1. **Restored Context7 + claude-in-chrome** to `.mcp.json` alongside the new `supabase-dev` entry — fresh clones now get full MCP wiring.
2. **Consolidated tracking**: deleted `.mcp.json.template`, promoted `.mcp.json` to a tracked file (per user decision). Secrets stay in `.env` (gitignored), so `.mcp.json` is safe to commit.
3. **Documented `mcp-servers/`**: added `mcp-servers/README.md` explaining what `postgres.ts` does, why it exists (DEV-only, auto-LIMIT, secret stays in `.env`), and how to set it up.

Also swept up a leftover from a prior task: the orphaned `260417-o8a-PLAN.md` was finally committed (the SUMMARY had shipped without it in 423d1b1).

## Files

- `.mcp.json` — 3-server config (Context7, claude-in-chrome, supabase-dev)
- `.mcp.json.template` — deleted (single source of truth = `.mcp.json`)
- `mcp-servers/README.md` — new
- `mcp-servers/postgres.ts`, `package.json`, `package-lock.json` — newly tracked
- `.env.example` — updated SUPABASE_DB_URL doc
- `.planning/quick/260417-o8a-.../260417-o8a-PLAN.md` — committed orphan

## Verification

- `git status` clean (only the 260418-0td artifacts left to stage in the final commit)
- `.mcp.json` valid JSON, contains 3 servers
- `mcp-servers/node_modules` correctly gitignored via root pattern
- No secrets committed (verified — `.mcp.json` references no credentials)

## Notes

User selected "Track .mcp.json" over the gitignore-and-keep-template alternative because:
- Forkability: fresh clones get MCP setup for free
- Secrets are already isolated in `.env`
- Single source of truth simpler than template-copy workflow
