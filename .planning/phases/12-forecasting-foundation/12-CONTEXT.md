# Phase 12: Foundation — Decisions & Guards - Context

**Gathered:** 2026-04-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 12 ships the **cross-cutting decisions, scripts, and CI guards that every later v1.3 phase (13-17) depends on**. It is NOT a feature phase — no migrations to `transactions`, no UI components, no model fits. Its three deliverables are:

1. `tools/its_validity_audit.py` committed and runnable, plus a weekly GHA workflow that posts results to `pipeline_runs` (skeleton table pulled forward from Phase 13).
2. CI Guard 7 in `scripts/ci-guards.sh` failing the build on `auth.jwt()->>'tenant_id'` references in v1.3 paths (codebase claim is `restaurant_id`).
3. Cron-schedule contract: UTC-anchored times documented in this CONTEXT.md, and a CI guard (`scripts/ci-guards/check-cron-schedule.py`) that asserts no schedule overlap under either CET (UTC+1) or CEST (UTC+2) and ≥60-minute cascade gaps.

Out of scope for Phase 12: any external-data table (Phase 13), any forecast model (Phase 14), any UI work (Phase 15), any campaign-uplift logic (Phase 16), any backtest gate (Phase 17).

</domain>

<decisions>
## Implementation Decisions

### Mandatory Ratifications (ROADMAP Phase 12 SC #4)

- **D-01 — Anticipation cutoff:** Track-B counterfactual fits on data where `date < campaign_start − 7 days`. The 7-day buffer absorbs anticipation effects (regulars hearing about the campaign before launch and adjusting visit timing). For the 2026-04-14 campaign that means `TRAIN_END = 2026-04-07`. Phase 16 enforces this via `pipeline_runs.fit_train_end` audit column + a CI test that asserts no row with `forecast_track='cf'` was written using `fit_train_end >= min(campaign_calendar.start_date)`.
- **D-02 — Production weather provider:** `WEATHER_PROVIDER=brightsky` is the production default. Bright Sky is DWD public-domain data, no commercial-use ambiguity. `WEATHER_PROVIDER=open-meteo` is local-dev only — Open-Meteo's "non-commercial" ToS clause is a gray zone the project must not depend on. The toggle is one env var on the `external-data-refresh.yml` workflow; switching cost is zero.
- **D-03 — `tenant_id` → `restaurant_id` rename:** Every `tenant_id` reference in PROPOSAL.md §7 schema sketches (`weather_daily`, `holidays`, `school_holidays`, `transit_alerts`, `recurring_events`, `forecast_daily`, `forecast_quality`, `campaign_calendar`, `campaign_uplift_v`, `shop_calendar`, `pipeline_runs`, `feature_flags`, `baseline_items_v`, `kpi_daily_with_comparable_v`, `campaign_active_v`) is renamed mechanically to `restaurant_id` before any migration is written. The codebase JWT claim is `restaurant_id` (verified in migrations 0010, 0021, 0023, 0026, +others). Phase 13 plan-phase applies the rename during plan creation; CI Guard 7 catches regressions.

### Audit Script (FND-09)

- **D-04 — Source:** Write `tools/its_validity_audit.py` fresh during Phase 12 plan-phase. The `tools/` directory is currently empty; the PROPOSAL.md note that the script is "currently in workspace" is stale — no file exists on disk. The 2026-04-27 audit findings documented in PROPOSAL §13 (`Onsen EGG` / `Tantan` / `Hell beer` are post-launch additions; `Pop up menu` is stochastic noise) become the test fixture.
- **D-05 — Audit scope:** Surfaces concurrent-intervention warnings for the 2026-04-14 campaign era — price hikes, hours shifts, new menu items. Logic operates on the existing `transactions` + `stg_orderbird_order_items` data; does not depend on any v1.3 table.
- **D-06 — Cadence:** Weekly Monday 09:00 UTC via `.github/workflows/its-validity-audit.yml` + on-demand `workflow_dispatch`. Posts one row to `pipeline_runs` (step_name=`its_validity_audit`, status=`success` | `warning`, `error_msg` carries any concurrent-intervention finding text).

### `pipeline_runs` Skeleton (pulled forward from Phase 13)

- **D-07 — Skeleton scope:** Phase 12 ships a minimal `pipeline_runs` table with columns: `run_id bigserial primary key, step_name text not null, started_at timestamptz not null default now(), finished_at timestamptz, status text, row_count int, error_msg text, commit_sha text`. Phase 13 extends with `upstream_freshness_h numeric` (FND-09 audit posts on this skeleton from week 1; Phase 13 alters table to add the freshness column without breaking the audit cron).
- **D-08 — RLS / scoping:** Phase 12 `pipeline_runs` is initially **non-tenant-scoped** (single-row-per-step, no `restaurant_id` column yet) — the audit script runs once per repo, not per tenant. Phase 13 adds `restaurant_id` column + tenant RLS policy when it adopts the table for per-tenant fetch tracking. Acceptance: hybrid-RLS pattern is documented in this phase; full enforcement lives in Phase 13.

### CI Guard 7 — `tenant_id` Regression Guard (FND-10)

- **D-09 — Guard placement:** Added to `scripts/ci-guards.sh` as Guard 7 (next number after existing Guard 6). Wired into `.github/workflows/guards.yml`.
- **D-10 — Scan paths:** `supabase/migrations/`, `scripts/forecast/`, `scripts/external/`, and `src/`. (Excludes: `.planning/` since the proposal text intentionally references the wrong claim while documenting the rename; excludes `tools/` since `its_validity_audit.py` operates on existing tables that already use `restaurant_id`.)
- **D-11 — Match patterns:** Two regexes — (a) literal `auth.jwt()->>'tenant_id'`, (b) bare `'tenant_id'` quoted-string occurrences inside JWT-context lines. Negative test: a deliberate red-team migration in `tests/ci-guards/red-team-tenant-id.sql` (gitignored from `supabase/migrations/`) verifies the guard fires; positive test: existing migrations that use `restaurant_id` pass.

### Cron Schedule Contract (FND-11)

- **D-12 — Final UTC schedule:** Documented as the source of truth that downstream phases must match.
  | Workflow | Phase | Cron (UTC) | CET (UTC+1) | CEST (UTC+2) |
  |---|---|---|---|---|
  | `external-data-refresh.yml` | 13 | `0 0 * * *` | 01:00 | 02:00 |
  | `its-validity-audit.yml` | 12 | `0 9 * * 1` (Mon 09:00) | 10:00 Mon | 11:00 Mon |
  | `forecast-refresh.yml` | 14 | `0 1 * * *` | 02:00 | 03:00 |
  | `pg_cron refresh_analytics_mvs` | 14 | `0 3 * * *` | 04:00 | 05:00 |
  | `forecast-backtest.yml` | 17 | `0 23 * * 2` (Tue 23:00) | 00:00 Wed | 01:00 Wed |
- **D-13 — Cascade gap rule:** ≥60 minutes between consecutive stages of the nightly cascade (`external-data` → `forecast-refresh` → `pg_cron MV refresh`). Both CET and CEST equivalents must satisfy this — DST inversions cannot be allowed to compress the gap.
- **D-14 — Enforcement:** `scripts/ci-guards/check-cron-schedule.py` parses every `.github/workflows/*.yml` `schedule.cron` string (and `pg_cron.schedule()` calls in `supabase/migrations/`), computes UTC + CET + CEST equivalents, asserts (a) no two cron strings produce the same wall-clock time in either DST regime, and (b) cascade ordering is preserved with ≥60-min gap. Wired into `guards.yml` as Guard 8.

### Claude's Discretion

- Exact Python signature of `its_validity_audit.py` (CLI args, output formatting) — Phase 12 planner picks idiomatic style consistent with existing `scripts/external/` and `tests/` conventions.
- Exact regex syntax for Guard 7 — planner picks the pattern that gives the cleanest negative test.
- Test fixture format for the cron-schedule guard — YAML-snapshot or inline-Python expected dict are both acceptable.
- Exact error-message wording for guard failures — planner aligns with existing `::error::Guard N FAILED:` pattern.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Driving artifact
- `.planning/phases/12-forecasting-foundation/12-PROPOSAL.md` — 1484-line v1.3 spec; §3 decision matrix (D-01..D-12), §7 schema sketches (must be `restaurant_id` not `tenant_id`), §11 KISS/no-do list, §12 open risks, §13 two-track architecture rationale, §14 failure modes + freshness SLO, §15 supporting tables, §16 backtest gate fairness rules, §17 hover-popup accuracy spec
- `.planning/phases/12-forecasting-foundation/12-PROPOSAL.md` §13 — 2026-04-27 audit findings: `Onsen EGG` / `Tantan` / `Hell beer` are post-launch additions excluded from `revenue_comparable_eur`; `Pop up menu` is stochastic noise; the audit script implements this logic

### Project-level
- `.planning/STATE.md` "v1.3 Strategic Decisions (from research synthesis 2026-04-27)" — load-bearing summary every v1.3 plan must respect
- `.planning/ROADMAP.md` "Phase 12: Foundation — Decisions & Guards" — the four success criteria this CONTEXT.md ratifies
- `.planning/REQUIREMENTS.md` FND-09 / FND-10 / FND-11 — the three locked requirements Phase 12 closes
- `CLAUDE.md` (project root) — non-negotiables: $0/mo budget, multi-tenant-ready, mobile-first, RLS on every new table
- `.claude/CLAUDE.md` — DEV-environment verification per Final QA & Definition of Done; `/qa-gate` mandatory before shipping

### CI guards (existing patterns to follow)
- `scripts/ci-guards.sh` — Guards 1–6 already wired; Phase 12 adds Guard 7 (tenant_id) and Guard 8 (cron schedule)
- `scripts/check-migration-drift.sh` — Guard 5 helper; pattern for additional guard scripts under `scripts/ci-guards/`
- `.github/workflows/guards.yml` — Phase 12's two new guards wire into this existing workflow

### Migration patterns (the JWT-claim source of truth)
- `supabase/migrations/0010_cohort_mv.sql` — canonical `where restaurant_id::text = (auth.jwt()->>'restaurant_id')` pattern
- `supabase/migrations/0023_transactions_filterable_v_visit_seq.sql` §31 — `auth.jwt() ->> 'restaurant_id'` (with optional whitespace) wrapper-view RLS pattern
- `supabase/migrations/0026_transactions_filterable_v_drop_security_invoker.sql` — comment block explaining the wrapper-view pattern (§14)

### Two-track architecture references
- `.planning/phases/12-forecasting-foundation/12-PROPOSAL.md` §11 — honest-framing rule (Track-B is causal IFF fit cutoff respected)
- `.planning/phases/12-forecasting-foundation/12-PROPOSAL.md` §13 — Track-A/Track-B contract, regressor matrix per model, `forecast_track` discriminator

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`scripts/ci-guards.sh`** — Guards 1–6 follow `set -u` + `fail=0` + numbered guard pattern with `::error::Guard N FAILED:` annotations. Phase 12 Guards 7 and 8 follow the same idiom.
- **`scripts/check-migration-drift.sh`** — pattern for delegating a complex check to a helper script while wiring it into `ci-guards.sh`. Guard 8's cron-schedule check follows this pattern: thin wrapper in `ci-guards.sh` calls `python scripts/ci-guards/check-cron-schedule.py`.
- **`.github/workflows/guards.yml`** — already runs `bash scripts/ci-guards.sh` on PR + push to main. No new workflow needed for Guards 7/8 — they slot into the existing one.
- **`.github/workflows/migrations.yml`** — pattern for migration-touching workflows. Phase 13's `external-data-refresh.yml` follows this template.

### Established Patterns

- **Numbered Guard pattern** — every CI guard is "Guard N (feature flag)" with a one-line summary, regex, and `fail=1` on detection. Negative tests live in `tests/` with deliberate-red-team fixtures.
- **`auth.jwt()->>'restaurant_id'` (or with one space `auth.jwt() ->> 'restaurant_id'`)** — JWT claim accessor pattern in 5+ migration files. Guard 7 must match BOTH spacing variants of `'tenant_id'` to catch every regression form.
- **`pg_cron.schedule()`** — pattern for SQL-side scheduled jobs (e.g., `refresh_analytics_mvs()` in migration 0014, `recurring-events-yearly-reminder` proposed in PROPOSAL §15). Guard 8 scans these too.
- **GHA workflow `schedule.cron`** — pattern for Python-side scheduled jobs. Guard 8 parses these via PyYAML.

### Integration Points

- **`scripts/ci-guards.sh`** receives Guards 7 and 8 (next-numbered).
- **`scripts/ci-guards/`** directory (new) — holds `check-cron-schedule.py` + future helper scripts.
- **`supabase/migrations/0039_pipeline_runs_skeleton.sql`** (new, next migration number) — minimal `pipeline_runs` table; Phase 13 extends this in a later migration.
- **`tools/its_validity_audit.py`** (new) — first script in `tools/` directory.
- **`.github/workflows/its-validity-audit.yml`** (new) — weekly cron + manual dispatch.
- **`tests/ci-guards/`** (new directory) — red-team fixtures for Guards 7 and 8.
- **`pii-columns.txt`** + existing Guard 4 — no Phase 12 change; reference pattern only.

</code_context>

<specifics>
## Specific Ideas

- **Audit-script error vocabulary** — `its_validity_audit.py` outputs warnings (not errors) and exits 0 even on findings — the surfacing happens via `pipeline_runs.error_msg` and the weekly GHA run summary. Hard-failing the audit cron would block the rest of the cascade, which is the wrong tradeoff for an early-warning tool.
- **Guard 7's negative test** — a `tests/ci-guards/red-team-tenant-id.sql` file with `where x.tenant_id::text = (auth.jwt()->>'tenant_id')` triggers the guard. The fixture is verified by running `scripts/ci-guards.sh` against a temp copy of the file in `supabase/migrations/` and asserting `fail=1`. The fixture itself NEVER lands in `supabase/migrations/`.
- **Cron-schedule guard format** — `check-cron-schedule.py` outputs a markdown table to stdout when failing, mirroring the schedule contract table in this CONTEXT.md so the failure is self-documenting.
- **§7 schema rename rule (one-paragraph spec for Phase 13 planner):** "Every `tenant_id uuid not null references restaurants(id)` in PROPOSAL §7 becomes `restaurant_id uuid not null references restaurants(id)`. Every `auth.jwt()->>'tenant_id'` becomes `auth.jwt()->>'restaurant_id'`. Apply mechanically; do not introduce any other change."

</specifics>

<deferred>
## Deferred Ideas

- **Per-tenant `pipeline_runs` RLS policy** — deferred to Phase 13 when the table gains `restaurant_id` and `upstream_freshness_h`. Phase 12 ships only the skeleton.
- **Audit-script GUI / dashboard surface** — current scope is GHA cron + `pipeline_runs.error_msg`. A friendly admin view of validity-audit findings is a v1.4 follow-up if the friend ever wants visibility outside maintainer reviews.
- **Quarterly off-week reminder (D-11b in PROPOSAL §3)** — explicitly deferred to v1.4 per PROPOSAL §3 D-11b; Phase 16's UPL-07 covers the 2026-10-15 one-shot reminder for the inaugural campaign.
- **Conformal-prediction wrapper around long-horizon CIs (PROPOSAL §4 office-hours topic 4)** — handled in Phase 17 BCK-02 (`ConformalIntervals(h=35, n_windows=4)`); not Phase 12's concern.
- **Foundation-model deployment to Cloudflare Workers (PROPOSAL §4 office-hours topic 8)** — irrelevant to v1.3; Chronos runs in GHA only, predictions land in DB. Defer reconsideration to v2.

</deferred>

---

*Phase: 12-forecasting-foundation*
*Context gathered: 2026-04-28*
