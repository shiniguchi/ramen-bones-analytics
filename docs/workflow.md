# Ramen Bones Analytics Development Workflow

> **Canonical source of truth for feature development.**
> Every agent rule file (CLAUDE.md, AGENTS.md) points here.
> The `.claude/hooks/next-step-hint.js` Stop hook prints `→ Next:` after every turn on a `feature/phase-*` branch — you don't have to remember.
> Solo-dev mode + SvelteKit + Cloudflare Pages + Supabase + single-repo. Adapted from the AiLine canonical workflow.

## The 5-step default sequence

Run top-to-bottom. **No command auto-chains** — type each one yourself.

| # | Stage | Command | Output |
|---|---|---|---|
| 1 | STATE | `/gsd-discuss-phase "<phase-name>"` | `.planning/phases/NN-slug/CONTEXT.md` |
| 2 | PLAN | `/gsd-plan-phase <NN>` | `NN-XX-PLAN.md` (one file per plan) |
| 3 | BUILD | `/gsd-execute-phase <NN>` | `NN-XX-SUMMARY.md` per plan, atomic commits |
| 4 | QA | **Epic-end QA block** (one batch — see below) | `UAT.md`, `VERIFICATION.md` |
| 5 | SHIP | `/gsd-ship` | PR opened → merge to `main` triggers Cloudflare Pages auto-deploy |

### Epic-end QA block (step 4)

```bash
git push origin feature/phase-<NN>-<slug>
gh pr create   # so reviewers can preview the diff before main triggers CF Pages
```
Then in Claude:
```
/qa-gate
/gstack-qa https://ramen-bones-analytics.pages.dev   # live browser QA after merge to main
.claude/scripts/validate-planning-docs.sh            # confirms STATE.md / ROADMAP.md match disk
```

Per-plan QA inside step 3 = **typecheck (`bun run check`) + unit tests (`bun test`) only**. No CF Pages deploy between plans (deploys are gated on `push to main` anyway). Heavy verification (browser MCP, SQL queries against Supabase) batches once at the end.

### Planning docs gate (before step 5)

ROADMAP.md and STATE.md must match disk artifacts before you ship. Three layers enforce this:

1. **Validator** — `.claude/scripts/validate-planning-docs.sh` compares ROADMAP `[x]` count, STATE.md frontmatter (`progress.{total,completed}_{phases,plans}`), and `*-SUMMARY.md` on disk.
2. **Stop hook** — `.claude/hooks/next-step-hint.js` calls the validator on QA + SHIP steps and prints `⚠️ Planning docs drift` warnings inline.
3. **CI gate** — `.github/workflows/validate-planning.yml` blocks PR merge when drift exists on PRs touching `*-SUMMARY.md`, ROADMAP.md, or STATE.md. Cannot be bypassed.

When drift is reported: edit `.planning/STATE.md` frontmatter (bump `progress.completed_phases`, `progress.completed_plans`, refresh `last_updated`), tick `[x]` for completed phases in `.planning/ROADMAP.md`, re-run the validator until clean.

## TDD opt-in (replaces steps 2-3 when discipline pays off)

For phases where typed code (analytics SQL/MV correctness, KPI math) or non-trivial refactor matters, swap GSD planning for Superpowers:

```
superpowers:using-git-worktrees       # creates feature/phase-NN-slug worktree
superpowers:writing-plans              # TDD plan, bite-sized 2-5min steps
superpowers:subagent-driven-development # fresh subagent per task, 2-stage review
```

**Save-path override (mandatory):** instruct Superpowers to save the plan to `.planning/phases/<NN>-<slug>/<NN>-XX-PLAN.md`, **not** `docs/superpowers/plans/`. This keeps `/gsd-ship` and the validator working against a single artifact location.

You will hit Superpowers' brainstorming HARD-GATE on first invoke — accept the ~60s prompt; CONTEXT.md is the spec.

## Trivial path

Doc-only edit, comment, variable rename, config tweak → `/gsd-quick`. Skip the 5 steps.

## Reach-for table

The lookup table lives in **`.claude/reach-for.json`** — the Stop hook reads it on every turn end and surfaces matching rows after each step. Adding a new tool = appending one JSON object.

| Signal observed | Reach for | After step |
|---|---|---|
| New mobile UI surface, no existing component to copy | `/gstack-design-shotgun` then `/gstack-design-html` | 1 |
| Phase touches Supabase RLS, auth, secrets, SQL with user input | `/gstack-cso` | 4 |
| DB migration (schema integrity is critical for cohort/LTV correctness) | `/gstack-codex` | 4 |
| Pre-PR taste check (SQL safety, RLS, trust boundaries) | `/gstack-review` | 4 |
| Bug appeared mid-build, root cause unclear | `superpowers:systematic-debugging` | any |
| Doc-only / comment / variable rename | `/gsd-quick` | replaces all 5 steps |
| Cohort / LTV / KPI math changed | manual: validate against v1 frozen baseline before deploy | 4 |
| SvelteKit/Supabase/Cloudflare API question | Context7 MCP `query-docs` | any |

## Equivalences (override upstream framework defaults)

- `/gsd-discuss-phase` satisfies `superpowers:writing-plans`'s brainstorming pre-gate (declared, not enforced — accept the prompt)
- Skip `superpowers:brainstorming` as a separate step — CONTEXT.md is the spec
- Skip `/gsd-plan-phase` only when the TDD opt-in path is chosen
- `/gsd-ship`, never `/gstack-ship` — GSD owns the PR + UAT.md flow
- Chrome MCP for browser work, never `/gstack-browse` (project override)
- Worktree branches use `feature/phase-<NN>-<slug>` so the Stop hook recognises the branch (and matches CF Pages branch-deploy convention if you enable it)

## Mapping to deploy infrastructure

| Concept | Reality on this project |
|---|---|
| **DEV environment** | `https://ramen-bones-analytics.pages.dev` — Cloudflare Pages production deploy of `main` |
| **Branch deploys** | Not enabled by default — `deploy.yml` only triggers on `push to main`. To enable preview deploys, extend `deploy.yml` to trigger on `feature/**` and pass `--branch=${{ github.ref_name }}` |
| **Logs** | GHA workflow logs (`gh run view <id> --log-failed`); browser DevTools console for runtime; CF Pages dashboard for deployment history |
| **Database** | Supabase (DEV + PROD). Use the configured Postgres MCP to query directly |

## Stop hook contract

`.claude/hooks/next-step-hint.js` fires on every assistant turn end. On a `feature/phase-*` branch it:

1. Detects current step from `.planning/phases/<NN>-<slug>/` artifacts
2. Loads `.claude/reach-for.json`, picks 1-2 rows matching the just-completed step
3. Emits `→ Next: <command>` + `Reach-for: <signals>` to stdout
4. At QA + SHIP steps, runs the validator and warns inline if planning docs drifted

On any other branch (`main`, `docs/*`, `fix/*`) it stays silent so general chat sessions are not polluted.

## Artifact layout per phase

```
.planning/phases/NN-<slug>/
├── CONTEXT.md        ← step 1
├── NN-XX-PLAN.md     ← step 2 (one or more)
├── NN-XX-SUMMARY.md  ← step 3 (per plan)
├── UAT.md            ← step 4
├── VERIFICATION.md   ← step 4
└── SUMMARY.md        ← step 5 (ship close)
```

## Changelog

### 2026-04-30 — Workflow v2: 5-step default + Stop hook + planning-docs drift gate

- **Retired the 19-row sequence** that was adapted from AiLine's old 21-row workflow. Same root cause as upstream — never adopted in practice. Replaced with 5-step default that matches actual shipping pattern (14 phases shipped to date with much lighter ceremony than the documented 19 rows).
- GSD `/gsd-plan-phase` is the default planner.
- Superpowers TDD path is **opt-in** — invoked by name, save-path overridden to `.planning/phases/`.
- GStack moved to **opt-in via Reach-for table**; recommend disabling proactive nudges (`gstack-config set proactive false`).
- Tier picker (1/2/2F/3) + CONTEXT frontmatter flags removed.
- Per-task QA replaced by single epic-end gate.
- **`.claude/hooks/next-step-hint.js`** Stop hook replaces the old "agent must remind you" rule — deterministic, not memory-dependent.
- **`.claude/reach-for.json`** is the dynamic lookup table; markdown copy in this doc is for humans, JSON is for the hook.
- **Planning-docs drift gate** added — `.claude/scripts/validate-planning-docs.sh`, Stop hook calls it at QA/SHIP, `.github/workflows/validate-planning.yml` enforces on PRs touching SUMMARY/ROADMAP/STATE.
