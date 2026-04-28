# Ramen Bones Analytics Development Workflow

> **Canonical source of truth for feature development.**
> Every agent rule file (CLAUDE.md, AGENTS.md, .claude/CLAUDE.md) points here.
> Adapted from AiLine canonical workflow ([source](file:///Users/shiniguchi/development/AiLine/shared-docs/docs/workflow.md)) for solo-dev mode + SvelteKit + Cloudflare Pages + Supabase + single-repo.

## The 19-row sequence

Run commands top-to-bottom. **No command auto-chains** — type each one yourself.

| # | Stage | Command | Description |
|---|---|---|---|
| 1 | 1. STATE | `/gsd-new-milestone` | Only at start of new milestone — updates PROJECT.md |
| 2 | 1. STATE | `/gsd-discuss-phase "<phase-name>"` | Creates CONTEXT.md — **set tier + flags in frontmatter** |
| 3 | 1. STATE | `/gsd-research-phase <NN>` | Creates RESEARCH.md — technical approach |
| 4 | 2. DESIGN | `/gstack-office-hours` | Creates DESIGN.md via 6 forcing questions (product reframe) |
| 5 | 2. DESIGN | `/gstack-autoplan` | Runs CEO + design + eng + devex review — you approve taste calls |
| 6 | 2. DESIGN | `/gstack-design-shotgun` | **If `frontend_heavy: true`** — visual variants, pick winner |
| 7 | 2. DESIGN | `/gstack-design-html` | **If `frontend_heavy: true`** — production HTML mockups |
| 8 | 3. BUILD | `superpowers:using-git-worktrees` | Creates worktree on `feature/phase-<NN>-<slug>` |
| 9 | 3. BUILD | `superpowers:writing-plans` | Creates TDD plan at `docs/superpowers/plans/YYYY-MM-DD-<slug>.md` |
| 10 | 3. BUILD | `superpowers:subagent-driven-development` | TDD execute — fresh subagent per task, 2-stage review, atomic commits |
| 11 | 3. BUILD | `superpowers:finishing-a-development-branch` | Merges worktree back to phase branch |
| 12 | 4. QA | `/qa-gate` | Security + visual + doc audit (mandatory) |
| 13 | 4. QA | `git push origin <phase-branch>` then merge to `main` | Triggers GHA `deploy.yml` → Cloudflare Pages auto-deploy |
| 14 | 4. QA | `/gstack-qa https://ramen-bones-analytics.pages.dev` | Live browser QA — auto-fixes bugs + writes regression tests |
| 15 | 4. QA | `/gstack-review` | Pre-landing code review (SQL safety, RLS, trust boundaries) |
| 16 | 4. QA | `/gstack-cso` | **If `security_sensitive: true`** — OWASP + STRIDE audit |
| 17 | 5. SHIP | `/gsd-verify-work` | Creates UAT.md — you confirm on DEV via Chrome / Postgres MCP |
| 18 | 5. SHIP | `/gsd-ship` | Opens PR → merges → updates state |
| 19 | 6. CLOSE | `/gstack-retro` | Appends lessons to `.planning/LEARNINGS.md` |

> **Solo-dev simplifications vs AiLine canonical:**
> - Dropped row 14 (`/check-logs`) — KISS; check GHA logs / browser console reactively when something breaks.
> - Dropped row 18 (`/gstack-codex`) — solo-dev mode; no second-opinion gate for DB schema or cross-repo changes.
> - Single-repo, so no 9-repo sync logic in `/gsd-ship`.

## Tier picker (set in step 2 CONTEXT.md frontmatter)

```yaml
tier: 2                       # 1=light, 2=default, 2F=frontend, 3=high-governance
frontend_heavy: false         # triggers rows 6, 7
security_sensitive: false     # triggers row 16
```

| Tier | 1-line definition | Which rows to run |
|---|---|---|
| **1** | Doc-only, config, variable rename, comment edits | `/gsd-quick` only |
| **2** | Default — backend/data feature, single concern (e.g., new SQL view, new ingest source) | Rows 1-5, 8-15, 17-19 |
| **2F** | Frontend feature (touches `src/routes/**`, `src/lib/components/**`, `.svelte`, CSS) | Tier 2 + rows 6, 7 |
| **3** | DB schema migration, RLS policy change, auth/session handling, payment/PII | Tier 2 + row 16 |

**Pick by asking:** *does this touch UI?* → 2F. *does it change auth/RLS/migrations?* → 3. *is it trivial?* → 1. *otherwise* → 2.

## Rules

1. **No command auto-chains** — type each one.
2. **Skip `/gsd-plan-phase` entirely** — Superpowers owns the implementation plan (row 9).
3. **Skip `superpowers:brainstorming`** — `/gstack-office-hours` does that job (row 4).
4. **`/gsd-ship`, never `/gstack-ship`** — GSD owns the merge + state-update logic.
5. **Chrome MCP for browser work, never `/gstack-browse`** — project override (per `.claude/CLAUDE.md`).
6. **Worktree branches use `feature/phase-<NN>-<slug>`** — keeps Superpowers happy and matches CF Pages branch-deploy convention.
7. **Superpowers refuses `main`** — always work on a phase branch.
8. **Localhost-first for UI changes** — Chrome MCP localhost:5173 BEFORE pushing; DEV (`pages.dev`) is for FINAL QA after merge to main, not for the per-edit feedback loop. (Enforced by `.claude/hooks/localhost-qa-gate.js`.)

## Artifact layout per phase

```
.planning/phases/NN-<slug>/
├── NN-CONTEXT.md          ← row 2 (GSD)
├── NN-RESEARCH.md         ← row 3 (GSD)
├── NN-DESIGN.md           ← rows 4, 5 (GStack)
├── design/                ← rows 6, 7 (GStack, Tier 2F only) — *.html mockups
├── NN-GOVERNANCE.md       ← rows 15, 16, 19 (GStack reviews + retro appended)
├── NN-UAT.md              ← row 17 (GSD)
├── NN-VERIFICATION.md     ← row 17 (GSD verifier)
└── NN-SUMMARY.md          ← row 18 (GSD close — lists commits, links DESIGN + plan)

docs/superpowers/plans/YYYY-MM-DD-<slug>.md   ← row 9 (Superpowers TDD plan)
.planning/LEARNINGS.md                         ← row 19 (GStack /retro accumulator)
```

## Framework roles (3-layer stack)

| Layer | Framework | Job | Install |
|---|---|---|---|
| State + orchestration | **GSD** | `.planning/`, milestone/phase tracking, UAT, ship logistics, project state | global plugin (per-user) |
| Product + design + review | **GStack** | `DESIGN.md`, HTML mockups, security/code audits, retros | symlink at `.claude/skills/gstack/` → `~/development/AiLine/shared-docs/.claude/skills/gstack/` (gitignored) |
| TDD execution | **Superpowers** | `docs/superpowers/plans/`, subagent orchestration, atomic TDD commits | global plugin (per-user) |

## Onboarding (first time on a fresh machine)

```bash
# 1. Install Superpowers plugin
claude plugin install superpowers@claude-plugins-official

# 2. Clone AiLine/shared-docs to the canonical path so the gstack symlink resolves
git clone <ailine-shared-docs-repo> ~/development/AiLine/shared-docs

# 3. Run gstack setup (registers all gstack-* skills + builds browse binary)
cd .claude/skills/gstack && ./setup --prefix --host claude
```

Verify:
```bash
claude plugin list                 # superpowers enabled
ls .claude/skills/gstack/SKILL.md  # exists (resolves through symlink)
```

## Update pattern

| Framework | Update | Re-pin |
|---|---|---|
| GSD | `/gsd-update` | — |
| GStack | `git -C ~/development/AiLine/shared-docs pull && /gstack-upgrade` | `(cd .claude/skills/gstack && git rev-parse HEAD) > .claude/GSTACK_SHA` |
| Superpowers | `claude plugin update superpowers` | Edit `.claude/PLUGINS.md` with new version from `claude plugin list` |

## Mapping to deploy infrastructure

| Concept | Implementation |
|---|---|
| **DEV environment** | `https://ramen-bones-analytics.pages.dev` — Cloudflare Pages production deploy of `main` |
| **Local dev** | `http://localhost:5173` — Vite dev server (`npm run dev`) |
| **Branch previews** | Not enabled — `deploy.yml` only triggers on `push to main`. If you want preview deploys, extend `deploy.yml` to also trigger on `feature/**` and pass `--branch=${{ github.ref_name }}` |
| **Logs** | GHA workflow logs (`gh run view <id> --log-failed`); browser DevTools console for runtime; CF Pages dashboard for deployment history |
| **DB migrations** | `.github/workflows/migrations.yml` runs `supabase db push` against the project DB |
| **CI guards** | `.github/workflows/guards.yml` runs `scripts/ci-guards.sh` (Guards 1–8) on every push + PR |

## Changelog

Update this section whenever the workflow evolves. Top = newest.

### 2026-04-28 — Initial canonical workflow for ramen-bones-analytics

- Adapted from AiLine canonical 21-row sequence; dropped 2 rows for solo-dev mode
- Locked the 3-layer stack: GSD (plugin) + GStack (symlink to AiLine/shared-docs) + Superpowers (plugin)
- Documented the "skip `/gsd-plan-phase`" rule explicitly — Superpowers owns implementation plans
- Documented localhost-first UI verification rule (project-specific override)
- Mapped tier picker to ramen-bones-analytics realities (RLS / migrations → Tier 3, not multi-repo)

### Template for future entries

```
### YYYY-MM-DD — <one-line summary>

- What changed (rows added/removed/reordered)
- Why (driver: incident, framework update, retro finding)
- Impact (which tier(s) affected)
```
