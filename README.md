# vibe-coding-starter

Atomic, copy-paste-ready starter for AI-assisted coding projects. Drop it into any new repo to get a working `.claude/` setup, doc scaffolds, and a tested workflow.

## What's Inside

```
.claude/
  CLAUDE.md              # Generic workflow rules — fill in TODOs for your project
  memory/MEMORY.md       # Repo-local memory index (not global)
  skills/
    qa-gate/             # Mandatory pre-ship quality gate
    uiux-review/         # UI/UX review via Chrome MCP
  commands/              # Generic slash commands (see list below)
docs/
  project-context.md     # Single source of truth scaffold
  feature-roadmap.md     # Roadmap scaffold
  architecture.md        # Architecture scaffold
AGENTS.md                # Brief for non-Claude agents (Cursor, Aider, etc.)
.mcp.json.template       # Minimal MCP setup (Context7 + Chrome)
bootstrap.sh             # Copies everything into a target directory
```

## Slash Commands

- `/qa-gate` — mandatory pre-ship gate (visual, security, docs)
- `/uiux-review` — full UI/UX review of a page
- `/review-pr` — holistic PR alignment
- `/create-pr-summary` — generate PR description from branch
- `/session-review` — review current session's changes
- `/deepsearch-propose-top2` — deep research, propose top 2 plans
- `/refine-plan-100pct` — upgrade a plan from 60% to 100%
- `/rephrase-dictation` — rephrase dictated intent for confirmation
- `/eval-skill` — evaluate a skill file or GitHub skill package
- `/crawl-repos` — crawl related repos to gather context

## Usage

### Option A — bootstrap into a new project

```bash
./bootstrap.sh ~/development/my-new-project
cd ~/development/my-new-project
# Edit .claude/CLAUDE.md → fill in the TODO sections
# Edit docs/project-context.md → describe your project
# Copy .mcp.json.template → .mcp.json and adjust
```

### Option B — copy manually

```bash
cp -r .claude docs AGENTS.md .mcp.json.template <target>
```

## Customization Checklist

After bootstrapping, do these in order:

1. `.claude/CLAUDE.md` — fill in environment table and TODO blocks
2. `docs/project-context.md` — describe stack, directories, deployment
3. `docs/architecture.md` — add system diagram + data flow
4. `docs/feature-roadmap.md` — seed current milestone
5. `.mcp.json` — copy from template, add project-specific MCPs (DB, etc.)
6. `.claude/memory/MEMORY.md` — leave empty; it fills itself as you work

## Philosophy

- **Atomic**: everything lives in one directory tree, no external installers
- **Universal**: zero hardcoded project names, URLs, or tech stacks
- **Repo-local memory**: each project has its own memory, not a global one
- **Workflow first**: the rules in `CLAUDE.md` are the opinionated part; the skills enforce them
