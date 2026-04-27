# Phase 12: Foundation — Decisions & Guards - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `12-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-04-28
**Phase:** 12-forecasting-foundation
**Areas discussed:** Mandatory ratifications (3) + Implementation defaults (G1–G6)

---

## Background context loaded before discussion

- `.planning/STATE.md` — full v1.3 strategic-decisions block already locked from research synthesis 2026-04-27 (two-track architecture, hybrid RLS, JWT claim = `restaurant_id`, UTC cron anchors, sample-path resampling, anticipation cutoff, brightsky default, Prophet `yearly_seasonality=False` until 730d, mobile-first chart defaults, 9 new Python deps, 0 new JS deps).
- `.planning/ROADMAP.md` Phase 12 entry — four success criteria, including SC #4 mandating CONTEXT.md ratification of (a) anticipation cutoff = `campaign_start − 7 days`, (b) `WEATHER_PROVIDER=brightsky` production default, (c) `restaurant_id` rename of every §7 schema sketch.
- `.planning/REQUIREMENTS.md` — FND-09 / FND-10 / FND-11 are the three v1.3 requirements Phase 12 closes.
- `.planning/phases/12-forecasting-foundation/12-PROPOSAL.md` — driving artifact (1484 lines). §3 decision matrix (D-01..D-12) treated as already decided; §7 schema sketches treated as `tenant_id`-needs-rename source material; §11 KISS rules and §13 two-track architecture treated as load-bearing.
- Codebase scan (`grep -rEn "auth\.jwt\(\)" supabase/migrations/`) — confirmed `auth.jwt()->>'restaurant_id'` is the canonical claim accessor in migrations 0010, 0021, 0023, 0026, +others.
- `tools/` directory scan — empty; PROPOSAL note that `its_validity_audit.py` is "currently in workspace" is stale, no file exists.
- `scripts/ci-guards.sh` — Guards 1–6 already wired; Phase 12 adds Guards 7 (tenant_id) and 8 (cron schedule).
- `.github/workflows/` — `deploy.yml`, `guards.yml`, `migrations.yml`, `tests.yml` exist; Phase 12 adds `its-validity-audit.yml`; Phase 13 will add `external-data-refresh.yml`.
- `supabase/migrations/` — current head is `0038_admin_update_insight_i18n.sql`; Phase 12's `pipeline_runs` skeleton becomes `0039_pipeline_runs_skeleton.sql`.

## Mandatory Ratifications (no alternatives — locked by ROADMAP §SC4)

These are not gray areas; they are required ratifications. Listed here for audit completeness.

| Ratification | Source authority | Recorded in CONTEXT.md as |
|---|---|---|
| Anticipation cutoff = `campaign_start − 7 days` | Research synthesis 2026-04-27 (STATE.md), PROPOSAL §13 | D-01 |
| `WEATHER_PROVIDER=brightsky` production default | Research synthesis 2026-04-27 (STATE.md), PROPOSAL §11 + §12 | D-02 |
| `tenant_id` → `restaurant_id` rename of every §7 sketch | Codebase verification (5+ migrations use `restaurant_id`), STATE.md | D-03 |

## G1 — `its_validity_audit.py` — exists already or write fresh?

| Option | Description | Selected |
|---|---|---|
| Write fresh in Phase 12 plan-phase | `tools/` is empty on disk; PROPOSAL "currently in workspace" note is stale; the 2026-04-27 audit findings in PROPOSAL §13 become the test fixture | ✓ |
| Locate the workspace-resident file and move it | Would require user intervention to find; risk of stale logic; rejected | |

**User's choice:** Write fresh.
**Notes:** Recorded as D-04. The fixture (`Onsen EGG`/`Tantan`/`Hell beer` post-launch additions, `Pop up menu` stochastic noise) is documented in PROPOSAL §13 and is sufficient for plan-phase to pin the script logic.

---

## G2 — `pipeline_runs` stand-in for FND-09 (table is created in Phase 13)

| Option | Description | Selected |
|---|---|---|
| Pull `pipeline_runs` skeleton forward into Phase 12 | Migration 0039 ships minimal table now (step_name, started_at, finished_at, status, row_count, error_msg, commit_sha); Phase 13 extends with `upstream_freshness_h` + `restaurant_id` + RLS | ✓ |
| Audit writes to a JSON file in repo until Phase 13 ships table | Adds a one-time-use code path; contradicts "single source of truth" principle | |
| Defer audit GHA cron until Phase 13 | Blocks FND-09 acceptance criterion (audit "wired to a weekly GHA workflow that posts results to `pipeline_runs` (or a stand-in until Phase 13 creates that table)") | |

**User's choice:** Pull skeleton forward.
**Notes:** Recorded as D-07 + D-08. Skeleton is initially non-tenant-scoped — single-row-per-step (audit runs once per repo, not per tenant). Phase 13 adds `restaurant_id` column + tenant RLS policy when it adopts the table for per-tenant external-data fetch tracking. Migration sequence: Phase 12 creates with skeleton columns, Phase 13 `ALTER TABLE` extends.

---

## G3 — CI Guard 7 `tenant_id` regex scope

| Option | Description | Selected |
|---|---|---|
| Scan `supabase/migrations/`, `scripts/forecast/`, `scripts/external/`, `src/` | Covers every v1.3-relevant write surface; excludes `.planning/` (proposal references the rename intentionally) and `tools/` (audit script operates on existing tables) | ✓ |
| `supabase/migrations/` only | ROADMAP SC #2 mentions migrations only; minimal scope; rejected as too narrow given Python scripts also write JWT claim accessors | |
| Include `.planning/` | Would force the proposal text to be edited or generate persistent false positives; rejected | |

**User's choice:** All four v1.3 paths.
**Notes:** Recorded as D-09 + D-10 + D-11. Two regexes — (a) literal `auth.jwt()->>'tenant_id'`, (b) bare `'tenant_id'` quoted-string in JWT-context lines. Negative test fixture lives at `tests/ci-guards/red-team-tenant-id.sql` (gitignored from `supabase/migrations/`). Match patterns must accept both `auth.jwt()->>` and `auth.jwt() ->> ` spacing variants (existing migrations use both).

---

## G4 — Cron-schedule contract enforcement mechanism

| Option | Description | Selected |
|---|---|---|
| Python script (`scripts/ci-guards/check-cron-schedule.py`) | Parses `.github/workflows/*.yml` `schedule.cron` strings AND `pg_cron.schedule()` calls in migrations, computes UTC + CET (UTC+1) + CEST (UTC+2), asserts cascade ordering and ≥60-min gap; wires into `guards.yml` as Guard 8 | ✓ |
| YAML snapshot test | Brittle to formatting changes; doesn't explicitly check DST inversions | |
| Runtime assertion in workflows themselves | Discovery happens too late (in production cron context); pre-merge gate is required | |

**User's choice:** Python helper script + Guard 8 wiring.
**Notes:** Recorded as D-12 + D-13 + D-14. Final UTC schedule contract documented as a 5-row table in CONTEXT.md (workflow × phase × cron × CET × CEST). ≥60-min cascade gap rule applies to BOTH DST regimes, not just one.

---

## G5 — §7 schema rename mechanics

| Option | Description | Selected |
|---|---|---|
| CONTEXT.md ratifies the rule; Phase 13 planner applies mechanically; CI Guard 7 catches regressions | Single source of truth; no maintenance burden of a renamed-§7 artifact that drifts from PROPOSAL.md | ✓ |
| Produce a separate "renamed §7 sketches" artifact | Two sources of truth (PROPOSAL.md + the renamed copy); drift risk; rejected | |
| Rewrite PROPOSAL.md §7 in place | Editing committed driving artifact mid-milestone; loses the audit trail of "what was proposed vs what shipped"; rejected | |

**User's choice:** Rule-only in CONTEXT.md.
**Notes:** Recorded as D-03 + the one-paragraph rename spec in `<specifics>`: "Every `tenant_id uuid not null references restaurants(id)` becomes `restaurant_id uuid not null references restaurants(id)`. Every `auth.jwt()->>'tenant_id'` becomes `auth.jwt()->>'restaurant_id'`. Apply mechanically; do not introduce any other change."

---

## G6 — `its_validity_audit.py` cadence

| Option | Description | Selected |
|---|---|---|
| Weekly Monday 09:00 UTC + on-demand `workflow_dispatch` | Matches PROPOSAL/ROADMAP weekly cadence; Monday 09:00 UTC is well outside cascade window; on-demand handles "before each campaign launch" use case | ✓ |
| Daily | Audit logic is structural ("did anything change?") not measurement ("what's the value?"); daily would create noise without signal | |
| On every PR touching `campaign_calendar` | `campaign_calendar` lives in Phase 16; not relevant to Phase 12 | |

**User's choice:** Weekly Monday 09:00 UTC + workflow_dispatch.
**Notes:** Recorded as D-06. Posts one row to `pipeline_runs` per run. Findings surface via `error_msg`, not exit code — audit cron does not block the cascade.

---

## Claude's Discretion

Areas where the user explicitly deferred to Claude during planning:

- Exact Python signature of `its_validity_audit.py` (CLI args, output formatting) — planner picks idiomatic style consistent with existing `scripts/external/` and `tests/` conventions.
- Exact regex syntax for Guard 7 — planner picks the pattern that gives the cleanest negative test.
- Test fixture format for Guard 8 — YAML-snapshot or inline-Python expected dict are both acceptable.
- Exact error-message wording for Guards 7 and 8 — planner aligns with existing `::error::Guard N FAILED:` pattern.

## Deferred Ideas

Captured in CONTEXT.md `<deferred>` for future-phase reference:

- Per-tenant `pipeline_runs` RLS policy → Phase 13.
- Audit-script GUI/dashboard surface → v1.4 (only if requested).
- Quarterly off-week reminder (D-11b in PROPOSAL §3) → v1.4; Phase 16 UPL-07 covers the 2026-10-15 one-shot reminder.
- Conformal-prediction wrapper for long-horizon CIs → Phase 17 BCK-02.
- Foundation-model deployment to Cloudflare Workers → v2.
