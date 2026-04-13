# AGENTS.md

Brief for AI coding agents working in this repo (Claude Code, Cursor, Windsurf, Aider, etc.).

## Start Here

1. Read `.claude/CLAUDE.md` — full workflow rules
2. Read `docs/project-context.md` — what this project is
3. Read `docs/architecture.md` — how it's wired
4. Read `docs/feature-roadmap.md` — current priorities

## Golden Rules

- **Verify before claiming done.** Push → deploy to DEV → test → then report.
- **Minimal changes.** Edit existing files; don't create new ones unless necessary.
- **No fluff.** Answer first, explain only if asked.
- **Never commit secrets.** Scan before every commit.
- **Never add `Co-authored-by: Claude` to git commits.**

## Slash Commands (Claude Code)

Run `/qa-gate` before marking anything verified or shipping.
Other useful commands live in `.claude/commands/` — read their frontmatter for purpose.

## Memory

Project-specific memory lives in `.claude/memory/`. It's checked into this repo and shared across sessions. See CLAUDE.md "Memory Storage" for how to add entries.
