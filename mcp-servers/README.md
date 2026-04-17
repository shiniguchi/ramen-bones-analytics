# mcp-servers/

Local MCP (Model Context Protocol) servers used by Claude Code in this repo.

Wired into Claude Code via `.mcp.json` at the repo root.

## supabase-dev (`postgres.ts`)

A read-only Postgres MCP server that lets Claude Code query the Supabase **DEV** project from inside this repo.

### What it does

Exposes a single MCP tool, `query`, that runs SQL against Supabase DEV. An automatic `LIMIT 50` is appended when no `LIMIT` clause is present, so accidental full-table scans don't flood the model context.

### Setup

1. Install local deps once:
   ```bash
   cd mcp-servers && npm install
   ```
2. Add the DEV connection string to the repo-root `.env` (gitignored):
   ```
   SUPABASE_DB_URL=postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres
   ```
   Grab it from Supabase Dashboard → Project Settings → Database → Connection string → URI.
3. Restart Claude Code so it re-reads `.mcp.json`.

### Why a custom MCP server (not the official Supabase one)?

Lets us pin the connection to **DEV only**, enforce read-only-ish behavior with the auto-`LIMIT`, and keep the `SUPABASE_DB_URL` secret in `.env` rather than `.mcp.json` (which is committed to git).

### Files

- `postgres.ts` — the MCP server (~60 lines). Loads `SUPABASE_DB_URL` from `../.env`, opens a `pg.Pool`, exposes the `query` tool.
- `package.json` — local deps (`@modelcontextprotocol/sdk`, `pg`, `dotenv`, `zod`, `tsx`).
- `node_modules/`, `package-lock.json` — gitignored via root `.gitignore`.
