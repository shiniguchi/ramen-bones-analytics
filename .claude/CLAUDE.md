# Project Context

## Development Workflow (canonical)

**Every feature follows [`docs/workflow.md`](../docs/workflow.md)** — 5-step default sequence (discuss → plan → execute → epic-end QA → ship), Reach-for table, planning-docs drift gate. Read it before any feature work. The Stop hook at `.claude/hooks/next-step-hint.js` prints `→ Next:` after every turn on a `feature/phase-*` branch — you don't need to remember.

Quick rules (full list in `docs/workflow.md`):
- **GSD `/gsd-plan-phase` is the default planner.** Superpowers TDD path is opt-in (invoke by name) for typed-code / KPI-math / non-trivial-refactor phases — save plans to `.planning/phases/<NN>-<slug>/` (override Superpowers' default `docs/superpowers/plans/` location).
- **GStack is opt-in via the Reach-for table only** — recommend disabling proactive nudges via `gstack-config set proactive false`.
- Phase work always on a `feature/phase-<NN>-<slug>` branch — required for the Stop hook to recognise the branch and CF Pages branch-deploy convention.
- Frameworks pinned in `.claude/PLUGINS.md`.

## Planning-docs drift gate (mandatory before `/gsd-ship`)

ROADMAP.md and STATE.md must match disk artifacts before any phase ships. Three layers enforce this:

1. **Validator**: `.claude/scripts/validate-planning-docs.sh` — single source of truth
2. **Stop hook**: calls the validator on QA + SHIP steps, prints `⚠️ Planning docs drift` warnings inline
3. **CI**: `.github/workflows/validate-planning.yml` blocks PR merge when drift exists on PRs touching SUMMARY/ROADMAP/STATE

When closing a phase, **always** update `.planning/STATE.md` frontmatter (`progress.completed_phases`, `progress.completed_plans`, `last_updated`) and tick `[x]` in `.planning/ROADMAP.md`. Run `.claude/scripts/validate-planning-docs.sh` to confirm.

## Default Environment: DEV

Always work against **DEV** unless the user says "local" or "prod".

### 🚨 Exception — Frontend / UI changes: LOCALHOST FIRST

Any change to `src/routes/**`, `src/lib/components/**`, or any `.svelte` / `.css` / CSS-in-JS file **MUST** be verified via Chrome MCP against `http://localhost:5173` BEFORE you claim the task is done. DEV is for FINAL QA after push — never for the per-edit feedback loop. `.claude/hooks/verify-targets.json` encodes this rule literally, and `.claude/hooks/localhost-qa-gate.js` (Stop hook) blocks turn-end if a frontend file was edited without a localhost navigate in the session transcript.

**Order is non-negotiable:**
1. Edit the frontend file
2. If no dev server is running, start one (`npm run dev` → localhost:5173)
3. Chrome MCP navigate → interact → read console → state `Visual verification: PASS/FAIL/PARTIAL`
4. (optional) Push branch → DEV deploy → Chrome MCP DEV URL for final QA

<!-- TODO: Fill in environment table for this project.
| Resource     | DEV                    | PROD                   |
| ------------ | ---------------------- | ---------------------- |
| Frontend URL | https://dev.example    | https://example        |
| Backend URL  | https://api.dev.example| https://api.example    |
| Database     | dev-db                 | prod-db                |
-->

## CRITICAL WORKFLOW REQUIREMENTS

Before ANY work (planning, coding, reviewing, debugging), gather context:

### 1. Read these docs completely

- `docs/project-context.md` — technical specs, architecture, coding standards
- `docs/feature-roadmap.md` — feature roadmap and implementation status
- `docs/architecture.md` — system design
- `.planning/PROJECT.md` §"Forecast Model Availability Matrix" — per-model min-history thresholds at day/week/month grain, why SARIMAX/ETS/Theta/Chronos/NeuralProphet may be disabled at certain grains, and the path-aggregation alternative. Surfaced in-product via `src/lib/components/ModelAvailabilityDisclosure.svelte`. Read this BEFORE answering "why don't I see model X?" questions.

### 2. Gather fresh context via CLI & MCPs

- **Code**: GitHub CLI (`gh`)
- **Database**: your DB MCP (if configured)
- **UI/UX**: Chrome MCP (`mcp__claude-in-chrome__*`)
- **Library docs**: Context7 MCP
- **Logs**: never miss ❌ or `"severity": "ERROR"` when reading service logs

## General Workflow Requirements

- Use TodoWrite for multi-step implementations
- Read multiple files concurrently when investigating
- **Delegate to sub-agents (Task tool) for complex multi-directory searches**
- Prefer editing existing files over creating new ones — minimal changes only

## Sub-Agent Usage (Task Tool)

**ALWAYS delegate to sub-agents for:**
- ✅ Cross-repo or cross-package searches
- ✅ Complex multi-step investigations
- ✅ Architecture research (pattern analysis)

**NEVER use sub-agents for:**
- ❌ Reading known files (use Read)
- ❌ Simple grep/glob (use Grep/Glob)
- ❌ Single-step operations

## Communication Style

- **Be concise**: Say everything needed, cut every word that doesn't. No fluff ("I'll help", "Sure thing"), no hedging, no filler ("Additionally", "Furthermore")
- **Simple & scannable**: Short sentences (max 15 words), simple words ("use" not "utilize"), bullets over paragraphs
- **Answer first**: Lead with the answer, then explain if needed
- **Keep all context**: Never drop important details to be shorter — just say them in fewer words

## Development Guidelines

- **Security paramount**: Never hardcode credentials, validate inputs, follow least privilege
- **Leverage MCPs**: pull up-to-date context instead of guessing
- **Explain briefly**: 1–2 sentence concept summary before code (no analogies)
- **Step by step**: Avoid editing multiple files simultaneously
- **Holistic**: Consider impact across the whole system
- **Simplicity first**: Minimal, simple code over clever solutions
- **Replace, don't just add**: After adding code, delete legacy unnecessary code
- **Refactor**: After each session, consolidate duplicates, recycle and simplify
- **Junior-friendly**: write short comments per section for future maintainers
- **🚨 Git commits**: NEVER add `Co-authored-by: Claude <noreply@anthropic.com>` to commit messages

## Per-Task QA (Mandatory)

**🚨 ALWAYS self-verify BEFORE asking the user.** Never present "please verify" without first verifying yourself. The user should only judge subjective UX or edge cases — not basic functionality.

After each task, test it BEFORE moving on. **Always verify against DEV** (never local only).

**Workflow: push → deploy to DEV → verify via Chrome MCP / DB MCP / curl.**

1. Push changes and deploy to DEV
2. Pick the matching row from the table and verify
3. Pass? → mark complete. Fail? → fix before the next task

Skip per-task QA only for: doc-only changes, comment edits, pure renames with no behavior change.

## Final QA & Definition of Done (Mandatory)

Code is NOT complete until verified in DEV. Before reporting done:

1. Identify affected component(s)
2. Push & deploy to DEV
3. Verify output — pick by what changed:

| What changed   | Verification method                                                         |
| -------------- | --------------------------------------------------------------------------- |
| Frontend / UI  | Open DEV URL via Chrome MCP → interact → screenshot                         |
| Backend API    | `curl` the DEV endpoint → confirm response                                  |
| Background job | Trigger job → trace logs → query DB for result                              |
| DB schema      | Query affected table via DB MCP → confirm structure and data                |

4. Check logs for the affected component
5. Report QA result — what was verified, pass/fail

If verification fails → fix before reporting done.

## Quality Standards (Enforced by /qa-gate)

Run `/qa-gate` before marking any work verified or shipped. Mandatory, not optional.

### Before Coding
- Ask "what are we actually trying to solve?" before writing code
- Explore 2–3 alternative approaches before committing
- For features with tests: write the test first

### During Verification
- **Adversarial QA**: try to BREAK it, don't just confirm it works
- **Decision-maker lens**: would a non-technical person understand the value delivered?
- **Evidence before claims**: no "should work" — run the command, show the output, THEN claim it passes

### Before Shipping
- **Security**: scan changed files for OWASP top-10, check for committed secrets
- **Visual**: screenshot at multiple breakpoints, check contrast, interaction states
- **Docs**: verify CLAUDE.md, README, AGENTS.md still match the code

## Memory Storage

This project uses **repo-local memory** at `.claude/memory/`. Memory persists across conversations for this project only, not globally.

### Files
- `.claude/memory/MEMORY.md` — index of all memories (always loaded)
- `.claude/memory/*.md` — individual memory files by topic

### Types of memory
- **user** — role, goals, preferences
- **feedback** — corrections and confirmed approaches (include **Why:** and **How to apply:**)
- **project** — ongoing work, decisions, incidents (use absolute dates)
- **reference** — pointers to external systems (issue trackers, dashboards, etc.)

### How to save
1. Write a new file at `.claude/memory/<type>_<topic>.md` with frontmatter `name`, `description`, `type`
2. Add a one-line pointer to `.claude/memory/MEMORY.md`: `- [Title](file.md) — one-line hook`

### What NOT to save
- Code patterns / file paths (derivable by reading)
- Git history (use `git log` / `git blame`)
- Debug fix recipes (they're in the commit)
- Ephemeral task state (use TodoWrite instead)

### Before recommending from memory
A memory naming a function, file, or flag is a claim that it existed **when written**. Verify with Grep/Read before acting on it.

- **🚨 NEVER add `Co-authored-by: Claude <noreply@anthropic.com>` to git commits** — forbidden
