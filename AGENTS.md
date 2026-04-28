# AGENTS.md

Brief for AI coding agents working in this repo (Claude Code, Cursor, Windsurf, Aider, etc.).

## Development Workflow (canonical)

**Every feature follows [`docs/workflow.md`](docs/workflow.md)** — 19-row command sequence, tier picker (1 / 2 / 2F / 3), artifact layout, framework roles, changelog. Read it before any feature work. When asked "what's next", suggest the next row from that table based on which phase artifacts already exist.

The 3-layer stack: **GSD** (state + orchestration) + **GStack** (product + design + review) + **Superpowers** (TDD execution). See `.claude/PLUGINS.md` for pinned versions.

## Start Here

1. Read [`docs/workflow.md`](docs/workflow.md) — canonical 19-row workflow
2. Read `.claude/CLAUDE.md` — DEV environment defaults + project-specific overrides
3. Read `docs/project-context.md` — what this project is
4. Read `docs/architecture.md` — how it's wired
5. Read `docs/feature-roadmap.md` — current priorities

## Golden Rules

- **Verify before claiming done.** Localhost first for UI; DEV (`https://ramen-bones-analytics.pages.dev`) for final QA.
- **Minimal changes.** Edit existing files; don't create new ones unless necessary.
- **No fluff.** Answer first, explain only if asked.
- **Never commit secrets.** Scan before every commit.
- **Never add `Co-authored-by: Claude` to git commits.**
- **Skip `/gsd-plan-phase`** — Superpowers owns implementation plans (see `docs/workflow.md` rule 2).

## Slash Commands (Claude Code)

Run `/qa-gate` before marking anything verified or shipping.
Run `/gstack-office-hours` instead of `superpowers:brainstorming` for design exploration.
Other useful commands live in `.claude/commands/` and the gstack/superpowers/GSD skill bundles — read their frontmatter for purpose.

## Memory

Project-specific memory lives in `.claude/memory/` (checked into this repo) and `~/.claude/projects/-Users-shiniguchi-development-ramen-bones-analytics/memory/` (per-user). See `.claude/CLAUDE.md` "Memory Storage" for how to add entries.
