# Phase 13: External Data Ingestion - Context

**Gathered:** 2026-04-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 13 ships the **five external-data tables + two operational tables + one nightly GHA workflow + backfill from 2025-06-11**. It is the data-plane phase — no model fits (Phase 14), no UI (Phase 15), no campaign attribution (Phase 16), no backtest gate (Phase 17).

Concrete deliverables:

1. Five ingest tables — `weather_daily`, `holidays`, `school_holidays`, `transit_alerts`, `recurring_events` — populated from 2025-06-11 onward; `weather_daily` extends 7 days forward.
2. `pipeline_runs` table extended (Phase 12 shipped the skeleton at migration `0039`) — Phase 13 adds `upstream_freshness_h numeric` and `restaurant_id uuid` columns + tenant RLS policy.
3. `shop_calendar` table populated 365 days forward per restaurant; closed days flagged `is_open=false`.
4. `external-data-refresh.yml` GHA workflow runs nightly at `0 0 * * *` UTC, completes <5 min on `ubuntu-latest`, writes to all 5 ingest tables + `pipeline_runs`, and supports `workflow_dispatch` with a `start_date` input for backfill.
5. Hybrid-RLS isolation enforced: shared location-keyed tables `for select using (true)` + `REVOKE INSERT/UPDATE/DELETE` on `authenticated`/`anon`; tenant-scoped tables (`pipeline_runs`/`shop_calendar`) keyed on `auth.jwt()->>'restaurant_id'`. Existing two-tenant CI isolation test extended to cover all 7 new tables.
6. `recurring_events.yaml` ships with ~15 hand-curated Berlin events for 2026 + 2027; pg_cron annual-refresh reminder (`recurring-events-yearly-reminder`) fires every September 15.

Out of scope: counterfactual `forecast_track` discriminator, `forecast_daily`/`forecast_quality`/`campaign_calendar`/`campaign_uplift_v` tables (Phase 14/16); admin UI for `shop_calendar` or `pipeline_runs` (v1.4); extended transit keyword list beyond `Streik|Warnstreik` (v1.4).

</domain>

<decisions>
## Implementation Decisions

### Carry-forward from Phase 12 (re-stated for downstream agents)

- **C-01 — Mechanical rename rule (Phase 12 D-03):** Every `tenant_id` reference in `12-PROPOSAL.md` §7 schema sketches becomes `restaurant_id` before the migration is written. Every `auth.jwt()->>'tenant_id'` becomes `auth.jwt()->>'restaurant_id'`. Apply mechanically; introduce no other change. CI Guard 7 (Phase 12) catches regressions.
- **C-02 — Weather provider default (Phase 12 D-02):** `WEATHER_PROVIDER=brightsky` is the production default; `WEATHER_PROVIDER=open-meteo` is local-dev only. Switching is one env var on `external-data-refresh.yml`.
- **C-03 — `pipeline_runs` extension (Phase 12 D-07/D-08):** The skeleton from migration `0039` already has `run_id bigserial`, `step_name`, `started_at`, `finished_at`, `status`, `row_count`, `error_msg`, `commit_sha`. Phase 13 ALTERs the table to add `upstream_freshness_h numeric NULL` and `restaurant_id uuid NULL references restaurants(id)`. RLS policy: `select using (restaurant_id is null OR restaurant_id::text = (auth.jwt() ->> 'restaurant_id'))` — allows audit-script (Phase 12) global rows + per-tenant fetch rows in the same table.
- **C-04 — Cron schedule (Phase 12 D-12):** `external-data-refresh.yml` cron = `0 0 * * *` UTC (CET 01:00, CEST 02:00). Phase 12 Guard 8 (`scripts/ci-guards/check-cron-schedule.py`) enforces ≥60-min gap before `forecast-refresh.yml` at `0 1 * * *` UTC.
- **C-05 — Hybrid RLS pattern (STATE strategic decisions):**
  - **Shared (location-keyed)** — `weather_daily`, `holidays`, `school_holidays`, `transit_alerts`, `recurring_events`: `enable row level security; create policy <table>_read on <table> for select using (true); revoke insert, update, delete on <table> from authenticated, anon;`
  - **Tenant-scoped** — `pipeline_runs`, `shop_calendar`: `auth.jwt()->>'restaurant_id'` policy; same `REVOKE` pattern on writes.

### Migration Sequencing (G-01)

- **D-01 — One migration per table.** Matches the established codebase pattern (every migration since `0001` is one logical unit). Clean rollback granularity. Phase 13 introduces seven migrations:
  - `0041_weather_daily.sql`
  - `0042_holidays.sql`
  - `0043_school_holidays.sql`
  - `0044_transit_alerts.sql`
  - `0045_recurring_events.sql`
  - `0046_pipeline_runs_extend.sql` (ALTER TABLE: add `upstream_freshness_h`, `restaurant_id`; replace RLS policy)
  - `0047_shop_calendar.sql`
- The starter `recurring_events.yaml` and the `recurring-events-yearly-reminder` pg_cron reminder ship together with `0045`.
- The two-tenant isolation test (`tests/integration/tenant-isolation.test.ts`) is extended in the same wave; no new migration needed.

### Backfill Mechanics (G-02)

- **D-02 — Single `external-data-refresh.yml` workflow with `workflow_dispatch.start_date` input.** Same workflow file serves nightly cron and manual backfill — runtime parity catches CI/runtime drift before launch. First run command after merge: `gh workflow run external-data-refresh.yml --field start_date=2025-06-11`. Nightly default (no input) = fetch yesterday + 7 forward weather days only.
- **D-03 — Idempotency via natural-key upserts.** Every fetcher writes with `ON CONFLICT (<natural_key>) DO UPDATE SET ...` so re-runs of the same date range are byte-stable. Natural keys per table:
  - `weather_daily`: `(date, location)`
  - `holidays`: `(date)`
  - `school_holidays`: `(state_code, block_name, start_date)`
  - `transit_alerts`: `(alert_id)` (sha256 of title+date)
  - `recurring_events`: `(event_id)` (slug from YAML)
  - `pipeline_runs`: append-only (`run_id bigserial` PK; one row per fetcher invocation)
  - `shop_calendar`: `(restaurant_id, date)`

### Python Orchestrator Structure (G-03)

- **D-04 — One file per source under `scripts/external/`** mirroring the modular split in `scripts/ingest/` (TS):
  - `scripts/external/weather.py` — provider switch (`brightsky` vs `open-meteo`) inline
  - `scripts/external/holidays.py` — `python-holidays` for federal + Berlin (BE) including Frauentag
  - `scripts/external/school.py` — raw `httpx` against `ferien-api.de/api/v1/holidays/BE/{year}.json`
  - `scripts/external/transit.py` — `feedparser` over BVG RSS, keyword list as module constant `KEYWORDS = ['Streik', 'Warnstreik']`
  - `scripts/external/events.py` — `PyYAML` load of `config/recurring_events.yaml`
  - `scripts/external/shop_calendar.py` — `PyYAML` load of `config/shop_hours.yaml` + 365-day forward generate
  - `scripts/external/run_all.py` — orchestrator; iterates fetchers; per-source try/except; writes `pipeline_runs` per fetcher
  - `scripts/external/pipeline_runs_writer.py` — shared helper for `pipeline_runs` row writes (success/failure/fallback semantics)
  - `scripts/external/db.py` — Supabase service-role client setup (matches `scripts/ingest/upsert.ts` style)
- **D-05 — Each fetcher returns `(rows, status, freshness_h, error_msg)`** so `pipeline_runs_writer` writes one consistent row shape per source.

### Failure Isolation (G-04)

- **D-06 — Per-source try/except → `pipeline_runs` row → continue.** Each fetcher in `run_all.py` is wrapped:
  ```python
  for fetcher in fetchers:
      try:
          rows, freshness_h = fetcher.run(start_date, end_date)
          fetcher.upsert(rows)
          pipeline_runs_writer.write_success(step_name=fetcher.name, row_count=len(rows), upstream_freshness_h=freshness_h)
      except UpstreamUnavailableError as e:
          pipeline_runs_writer.write_fallback(step_name=fetcher.name, error_msg=str(e))
      except Exception as e:
          pipeline_runs_writer.write_failure(step_name=fetcher.name, error_msg=str(e))
  ```
- **D-07 — Exit-code semantics:** `run_all.py` exits `0` if at least one source succeeded (cascade can still proceed with partial data). Exits `1` only if every source failed (hard infra problem; alerts the maintainer via GHA failure email). This satisfies ROADMAP SC #5: deliberate Open-Meteo failure surfaces a `fallback` row, not a workflow failure.

### `shop_calendar` Bootstrap (G-05)

- **D-08 — `config/shop_hours.yaml` + idempotent Python loader.** YAML schema:
  ```yaml
  # config/shop_hours.yaml
  - restaurant_id: <uuid-of-friends-restaurant>
    weekly_pattern:
      monday:    { is_open: true, open_at: "12:00", close_at: "23:00" }
      tuesday:   { is_open: true, open_at: "12:00", close_at: "23:00" }
      # ... etc.
      sunday:    { is_open: false }
    overrides:
      - { date: "2026-12-24", is_open: false, reason: "Heiligabend" }
      - { date: "2026-12-31", is_open: true, open_at: "12:00", close_at: "18:00", reason: "Silvester short hours" }
  ```
- **D-09 — Loader runs nightly inside `external-data-refresh.yml`** so the 365-day-forward window always rolls. Idempotent upsert by `(restaurant_id, date)`. Out-of-cycle closures (vacation, illness) → friend DMs Shin → Shin updates YAML + commits → next night's cron applies.
- The actual YAML values (open/close times per weekday) are captured during plan-phase from the friend; this phase only locks the schema.

### CI Test Fixture Strategy (G-06)

- **D-10 — Hand-rolled JSON/XML fixtures + `monkeypatch.setattr(httpx, ...)`.** No new test dependency. Fixtures live under `tests/fixtures/external/` (one per source, one per scenario):
  - `weather_brightsky_3day.json`, `weather_open_meteo_3day.json`, `weather_open_meteo_502.json`
  - `holidays_2026_berlin.json` (synthesized from `python-holidays` output)
  - `school_holidays_be_2026.json`
  - `transit_bvg_rss_strike.xml`, `transit_bvg_rss_no_strike.xml`
  - `recurring_events.yaml` (test-mode override)
- The "deliberate Open-Meteo failure surfaces fallback" test asserts: monkeypatch httpx → raise `httpx.HTTPStatusError(502)` → run `weather.run()` → `pipeline_runs` row has `status='fallback'` and `error_msg` non-empty.
- The two-tenant isolation test gets seven new cases (one per new table) that assert `select count(*)` returns 0 from the wrong-tenant JWT context.

### `recurring_events.yaml` Initial Set (G-07)

- **D-11 — Phase 13 ships ~15 hand-curated Berlin events Shin researches.** Starter set covers obvious public-impact events: Karneval der Kulturen (Pfingsten), Berlin Marathon (Sept), Christopher Street Day (CSD, late July), Lange Nacht der Museen (Aug), Festival of Lights (Oct), Weihnachtsmärkte windows (late Nov–Dec 23), Silvester (Dec 31), DFB-Pokal-Finale at Olympiastadion (May). Friend reviews + adds materially-impactful ones in a follow-up PR. The pg_cron annual reminder fires every Sep 15 to nag the maintainer to add the next year.
- Each YAML entry: `event_id` (slug), `name`, `category` (`festival|sports|market|holiday`), `start_date`, `end_date`, `impact_estimate` (`high|medium|low`), `notes`, `source`.

### Transit Keyword Scope (G-08)

- **D-12 — Keyword list as module constant `KEYWORDS = ['Streik', 'Warnstreik']` per REQUIREMENTS EXT-04 literal.** Config-constant style lets v1.4 PR extend (`Ausfall`, `Sperrung`, `Bauarbeiten`, `Gleisarbeiten`) without re-discussion or schema change.
- **D-13 — BVG RSS URL primary + fallback verified live in plan-phase.** Open todo "(v1.3) Phase 13 — BVG RSS URL not yet end-to-end verified; CI step in 13's acceptance test" is folded into Phase 13 scope. Plan-phase researcher confirms the primary RSS endpoint responds and documents one fallback URL; both go into `transit.py` as ranked fallbacks.

### `pipeline_runs` Freshness Semantics

- **D-14 — `upstream_freshness_h`** = hours between the latest data point in the response and the time the fetcher ran. Computed per fetcher:
  - `weather_daily`: hours since the latest `date` returned (always ~0 for nowcast, ~−168 for forecast — store the actual; downstream freshness check uses `> 24` as stale)
  - `holidays`: 0 (static data)
  - `school_holidays`: hours since the latest `block.end_date` returned (large for current state)
  - `transit_alerts`: hours since the latest `pubDate` in RSS feed
  - `recurring_events`: 0 (YAML)
- Freshness threshold for the SvelteKit "stale data" badge in Phase 15 is `> 24h` for any cascade stage.

### Folded Todos

- **(v1.3) Phase 13 — BVG RSS URL end-to-end verification** — folded into D-13 (plan-phase verifies live URL + documents fallback before merge).

### Claude's Discretion

- Exact column types beyond what PROPOSAL §7 + REQUIREMENTS specify (planner picks idiomatic SQL).
- Internal Python module naming/imports beyond the file list in D-04.
- Exact `pytest` fixture file format vs inline JSON literals.
- Exact GHA `actions/setup-python` version + cache key.
- Exact wording of `recurring-events-yearly-reminder` cron payload (just needs to fire annually).
- Whether `pipeline_runs.error_msg` truncates long error strings (e.g., 2000-char cap with ellipsis) — planner picks.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents (researcher, planner, executor) MUST read these before planning or implementing.**

### Driving artifacts
- `.planning/phases/12-forecasting-foundation/12-PROPOSAL.md` — 1484-line v1.3 spec; **§7 schema sketches are the source for all 5 ingest tables + `shop_calendar` + `forecast_daily`/`forecast_quality`/`campaign_calendar` (latter three are NOT Phase 13)**; `tenant_id` → `restaurant_id` rename rule applies (C-01)
- `.planning/phases/12-forecasting-foundation/12-PROPOSAL.md` §8 — GHA cron pattern; template for `external-data-refresh.yml`
- `.planning/phases/12-forecasting-foundation/12-PROPOSAL.md` §11 — KISS / no-do list
- `.planning/phases/12-forecasting-foundation/12-PROPOSAL.md` §14 — failure modes + freshness SLO definitions

### Locked decisions from prior phase
- `.planning/phases/12-forecasting-foundation/12-CONTEXT.md` — D-01..D-14; specifically D-02 (brightsky default), D-03 (rename rule), D-07/D-08 (pipeline_runs skeleton at 0039), D-12 (UTC cron contract), D-13 (cascade gap rule), D-14 (Guard 8 cron-schedule check)

### Project-level
- `.planning/STATE.md` "v1.3 Strategic Decisions (from research synthesis 2026-04-27)" — load-bearing summary
- `.planning/STATE.md` "Load-Bearing Architectural Rules" §4 — GHA schedules Python; pg_cron schedules SQL refreshes only; communication via `pipeline_runs`
- `.planning/ROADMAP.md` "Phase 13: External Data Ingestion" — six success criteria this CONTEXT.md is bound to
- `.planning/REQUIREMENTS.md` EXT-01..EXT-09 — the nine requirements Phase 13 closes
- `CLAUDE.md` (project root) — non-negotiables: $0/mo budget, multi-tenant-ready, mobile-first, RLS on every new table
- `.claude/CLAUDE.md` — DEV verification per Final QA & Definition of Done; `/qa-gate` mandatory before shipping; localhost-first applies to UI changes only (Phase 13 has none)

### Migration patterns (the JWT-claim source of truth)
- `supabase/migrations/0010_cohort_mv.sql` — canonical `where restaurant_id::text = (auth.jwt()->>'restaurant_id')` pattern
- `supabase/migrations/0023_transactions_filterable_v_visit_seq.sql` — `auth.jwt() ->> 'restaurant_id'` (with whitespace) wrapper-view pattern
- `supabase/migrations/0026_transactions_filterable_v_drop_security_invoker.sql` — comment block explaining wrapper-view RLS
- `supabase/migrations/0039_pipeline_runs_skeleton.sql` — Phase 12 skeleton; Phase 13 ALTERs in `0046_pipeline_runs_extend.sql`

### CI guards (Phase 12 outputs Phase 13 must respect)
- `scripts/ci-guards.sh` Guards 1–8 — Guard 7 (`tenant_id` regression) catches any Phase 13 migration that fails the rename rule
- `scripts/ci-guards/check-cron-schedule.py` — Guard 8; Phase 13 adds `external-data-refresh.yml` to the schedule contract
- `.github/workflows/guards.yml` — runs `bash scripts/ci-guards.sh` on PR + push to main
- `tests/ci-guards/red-team-tenant-id.sql` — gitignored fixture verifying Guard 7 fires (Phase 12)

### Workflow patterns
- `.github/workflows/its-validity-audit.yml` — Phase 12; closest template for `external-data-refresh.yml` (cron + workflow_dispatch + Python + Supabase secrets)
- `.github/workflows/migrations.yml` — pattern for migration-touching workflows
- `.github/workflows/tests.yml` — extended to run new Python tests under `scripts/external/`

### Existing ingest pattern (TS — Phase 13 mirrors in Python)
- `scripts/ingest/index.ts` — orchestrator entry point pattern
- `scripts/ingest/download.ts` / `parse.ts` / `normalize.ts` / `upsert.ts` — modular fetcher split that Phase 13's `scripts/external/` mirrors

### Two-tenant isolation test (extend in this phase)
- `tests/integration/tenant-isolation.test.ts` — currently covers 6 wrapper views + 2 raw MVs (26 tests); Phase 13 adds 7 cases (one per new table)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`scripts/ingest/`** (TypeScript) — modular fetcher split (`download/parse/normalize/upsert/refresh/report/index`). Phase 13's `scripts/external/` (Python) mirrors this organization: one file per source + orchestrator + shared writer.
- **`scripts/ci-guards.sh` Guard 7** — already catches any `tenant_id` JWT-claim regression in Phase 13 migrations; no Phase 13 work needed beyond writing `restaurant_id` correctly.
- **`scripts/ci-guards/check-cron-schedule.py`** (Phase 12) — already enforces the schedule contract; Phase 13's `external-data-refresh.yml` slots in at `0 0 * * *` and the guard verifies the ≥60-min gap to `forecast-refresh.yml`.
- **`supabase/migrations/0039_pipeline_runs_skeleton.sql`** — base table; Phase 13 ALTERs (D-01 sequence, migration 0046).
- **`tests/integration/tenant-isolation.test.ts`** — extension target; pattern for adding 7 new-table cases.
- **`.github/workflows/its-validity-audit.yml`** (Phase 12) — closest template for `external-data-refresh.yml` (Python + Supabase secrets + workflow_dispatch).

### Established Patterns

- **One migration per logical unit** — codebase invariant since `0001`. Phase 13's seven migrations follow.
- **Service-role Supabase client for batch writes** — pattern from `scripts/ingest/upsert.ts`. Phase 13's `scripts/external/db.py` adopts the same approach (env: `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`).
- **`pipeline_runs` as the single source of truth for cascade freshness** — STATE.md load-bearing rule §4. Every fetcher writes one row per invocation.
- **Hybrid RLS policy pattern** — `for select using (true)` + `REVOKE INSERT/UPDATE/DELETE` for shared tables; JWT scope for tenant tables. Established in v1.0; Phase 13 applies uniformly.
- **GHA secret pattern** — `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, plus per-source secrets if any (none expected for v1: BVG RSS public, Bright Sky/Open-Meteo public, ferien-api.de public, python-holidays bundled).

### Integration Points

- **`supabase/migrations/`** receives 7 new migrations (0041-0047).
- **`scripts/external/`** (new Python directory) — first Python code in repo besides the Phase 12 audit script (`tools/its_validity_audit.py`).
- **`config/recurring_events.yaml`** (new) and **`config/shop_hours.yaml`** (new) — first hand-curated config files in repo.
- **`tests/fixtures/external/`** (new) — JSON/XML fixtures for monkeypatched httpx tests.
- **`tests/integration/tenant-isolation.test.ts`** — extended with 7 new test cases.
- **`.github/workflows/external-data-refresh.yml`** (new) — sixth GHA workflow in the repo.
- **`scripts/ci-guards/check-cron-schedule.py`** — receives `external-data-refresh.yml` in its scan target list (no code change; the script already globs `.github/workflows/*.yml`).
- **`requirements.txt`** or **`pyproject.toml`** (Python deps) — first time Phase 13 adds runtime Python deps to repo (Phase 12 audit script likely uses stdlib only or the same file). Deps: `httpx`, `python-holidays>=0.25,<1`, `feedparser`, `PyYAML`, `openmeteo-requests`, `supabase` (Python client).

</code_context>

<specifics>
## Specific Ideas

- **Per-source `step_name` taxonomy in `pipeline_runs`** — keep deterministic for downstream queries: `external_weather`, `external_holidays`, `external_school`, `external_transit`, `external_events`, `external_shop_calendar`, `its_validity_audit` (Phase 12). Researcher/planner can extend if needed; this is the v1 set.
- **`pipeline_runs` as freshness telemetry, not error log** — `error_msg` is for human triage, not for the dashboard. The dashboard reads `upstream_freshness_h` and renders the stale-data badge in Phase 15. Keep `error_msg` ≤2000 chars (plan-phase decides truncation strategy).
- **One-shot backfill expected duration** — `gh workflow run external-data-refresh.yml --field start_date=2025-06-11` covers ~325 days × 5 sources; estimate <10 min wall on `ubuntu-latest` with chunked date ranges (Bright Sky and Open-Meteo both accept `start_date` + `end_date` in one call). If chunking is needed, planner picks chunk size in `weather.py` (suggest 30-day chunks for safety).
- **`recurring_events.yaml` annual cycle** — pg_cron `recurring-events-yearly-reminder` writes a row to `pipeline_runs` (`step_name='recurring_events_reminder', status='warning', error_msg='Add events for $(year+1)'`) on Sep 15 each year. The reminder is intentionally a `pipeline_runs` row (not an email/Slack) — surfacing in any downstream maintainer-review of the table is sufficient for v1.
- **Open-Meteo "non-commercial" gray zone (STATE strategic decisions)** — `WEATHER_PROVIDER=open-meteo` works for local dev. Production deployment defaults to `WEATHER_PROVIDER=brightsky`. Switching cost is one env var on the GHA workflow; both providers have compatible response shapes after a thin normalization layer in `weather.py`.

</specifics>

<deferred>
## Deferred Ideas

- **Counterfactual fits + `forecast_track` discriminator** — Phase 14.
- **`forecast_daily`, `forecast_quality`, `campaign_calendar`, `campaign_uplift_v` tables** — Phase 14/16 (PROPOSAL §7 sketches them; do NOT create in Phase 13).
- **`baseline_items_v`, `kpi_daily_with_comparable_v`** — Phase 16 (ITS attribution prep).
- **Per-tenant `pipeline_runs` admin UI / dashboard surface** — v1.4 follow-up. Phase 15 reads `upstream_freshness_h` for the stale-data badge but does not surface the audit log.
- **Extended `transit_alerts` keyword list** — beyond `Streik|Warnstreik` (e.g., `Ausfall`, `Sperrung`, `Bauarbeiten`, `Gleisarbeiten`). v1.4 PR extends the module constant.
- **`shop_calendar` admin UI** — friend DMs Shin → Shin updates YAML for v1. v1.4 may add an admin endpoint.
- **VCR.py / cassette-based test fixtures** — current scope uses hand-rolled fixtures + monkeypatch. If API surface grows past 5 sources or fixtures get unwieldy, revisit in v1.4.
- **Foundation-model deployment to Cloudflare Workers** (PROPOSAL §4 office-hours topic 8) — irrelevant to v1.3.

</deferred>

---

*Phase: 13-external-data-ingestion*
*Context gathered: 2026-04-28*
