# Phase 13: External Data Ingestion - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `13-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-04-28
**Phase:** 13-external-data-ingestion
**Mode:** Auto-recommendation per user feedback memory `feedback_follow_recs_first.md` — Claude picks recommended defaults with inline rationale; user pushes back inline if any rec is wrong.
**Areas discussed:** G-01 Migration sequencing, G-02 Backfill mechanics, G-03 Python orchestrator structure, G-04 Failure isolation, G-05 `shop_calendar` bootstrap, G-06 CI test fixture strategy, G-07 `recurring_events.yaml` initial set, G-08 Transit keyword scope.

---

## Carry-Forward (not discussed — locked from prior artifacts)

| Decision source | What was carried forward |
|---|---|
| Phase 12 D-02 | `WEATHER_PROVIDER=brightsky` prod default, `open-meteo` dev only |
| Phase 12 D-03 | Mechanical `tenant_id` → `restaurant_id` rename rule on PROPOSAL §7 sketches |
| Phase 12 D-07/D-08 | `pipeline_runs` skeleton at `0039`; Phase 13 ALTERs to add `upstream_freshness_h` + `restaurant_id` + RLS |
| Phase 12 D-12 | `external-data-refresh.yml` cron `0 0 * * *` UTC |
| ROADMAP SC #5 | Deliberate Open-Meteo failure → `pipeline_runs` `fallback` row, not an exception |
| REQUIREMENTS EXT-01..09 | Backfill from 2025-06-11; 7-day forward weather; ferien-api.de raw httpx; BVG RSS `Streik\|Warnstreik`; 15-20 events/yr; Sep 15 pg_cron reminder |
| STATE strategic decisions | Hybrid RLS pattern (shared `using (true)` + REVOKE; tenant JWT-scoped); GHA owns Python, pg_cron owns SQL; communication via `pipeline_runs` |

---

## G-01: Migration Sequencing

| Option | Description | Selected |
|--------|-------------|----------|
| One big migration | Single `0041_phase13.sql` covering all 7 tables | |
| One migration per table | 7 migrations `0041`-`0047`, one logical unit each | ✓ |
| Grouped (shared/tenant/extension) | 3 migrations: shared tables, tenant tables, pipeline_runs ALTER | |

**Selected:** One migration per table.
**Rationale:** Matches established codebase pattern (every migration since `0001` is one logical unit); clean rollback granularity; parallels Phase 12 style. Sequence: `0041_weather_daily.sql`, `0042_holidays.sql`, `0043_school_holidays.sql`, `0044_transit_alerts.sql`, `0045_recurring_events.sql`, `0046_pipeline_runs_extend.sql`, `0047_shop_calendar.sql`.

---

## G-02: Backfill Mechanics

| Option | Description | Selected |
|--------|-------------|----------|
| Standalone script | `scripts/external/backfill.py` run manually outside GHA | |
| Same workflow + `workflow_dispatch.start_date` | Single `external-data-refresh.yml` serves nightly cron + manual backfill | ✓ |
| Cron auto-detects gaps | Nightly cron checks for empty rows and back-fills opportunistically | |

**Selected:** Same workflow with `workflow_dispatch.start_date` input.
**Rationale:** Same env as nightly cron catches CI/runtime drift; idempotent ON CONFLICT upserts make re-runs safe; one workflow file to maintain. First-run command: `gh workflow run external-data-refresh.yml --field start_date=2025-06-11`.

---

## G-03: Python Orchestrator Structure

| Option | Description | Selected |
|--------|-------------|----------|
| Single `main.py` | One file with 5 fetcher functions + main() | |
| One file per source + orchestrator + shared writer | Modular split mirroring `scripts/ingest/` (TS) | ✓ |
| Provider abstraction (factory) per source | Plugin-style abstraction layer for every source | |

**Selected:** One file per source + `run_all.py` orchestrator + `pipeline_runs_writer.py` helper.
**Rationale:** Testable in isolation; targeted CI runs (`pytest scripts/external/test_weather.py`); mirrors existing `scripts/ingest/` modular split. Weather gets a tiny inline provider switch (`brightsky` vs `open-meteo`) — full factory pattern is overkill for 2 providers.

---

## G-04: Failure Isolation

| Option | Description | Selected |
|--------|-------------|----------|
| Per-source try/except + `fallback` row + exit 0 | Continue with remaining sources on failure | ✓ (locked by ROADMAP SC #5) |
| Same but exit 1 if ≥2 fail | Surface degraded runs as workflow failures | |
| Hard fail on first error | Stop the cascade immediately | |

**Selected:** Per-source try/except + `fallback`/`failure` row + continue. Exit 1 only if every source failed.
**Rationale:** ROADMAP SC #5 mandates that a deliberate Open-Meteo failure surfaces a `fallback` `pipeline_runs` row, not a workflow exception. This was effectively pre-decided; Phase 13 implements.

---

## G-05: `shop_calendar` Bootstrap

| Option | Description | Selected |
|--------|-------------|----------|
| SQL seed migration | Hardcoded weekday pattern + `generate_series` | |
| YAML config + Python loader | `config/shop_hours.yaml` parsed by `scripts/external/shop_calendar.py` | ✓ |
| Admin UI | Restaurant owner edits via dashboard | (out of v1 scope) |

**Selected:** YAML config + Python loader; loader runs nightly inside `external-data-refresh.yml`.
**Rationale:** Shop hours are config-data not infra-data; PR-reviewable; easy diff. Vacation/closure overrides handled via YAML `overrides` block + same idempotent loader. Pre-investment in YAML is cheap insurance for v1.3 forecasting needs (vacation closures must NOT be treated as zero-revenue days).
**Caveat:** If friend's hours never change, SQL seed would be lighter. Picking YAML for forward-compat.

---

## G-06: CI Test Fixture Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| VCR.py cassettes | Record real responses, replay on test runs | |
| Hand-rolled JSON/XML fixtures + monkeypatch httpx | `tests/fixtures/external/*` + `monkeypatch.setattr` | ✓ |
| Real HTTP calls gated by env var | Tests hit real APIs unless `OFFLINE=1` set | |

**Selected:** Hand-rolled JSON/XML fixtures + `monkeypatch.setattr(httpx, ...)`.
**Rationale:** No new test dep; deterministic test runs; small payloads commit cleanly. The "deliberate Open-Meteo failure surfaces fallback" CI assertion (ROADMAP SC #5) is implemented as: monkeypatch raises `httpx.HTTPStatusError(502)` → assert `pipeline_runs.status='fallback'`.

---

## G-07: `recurring_events.yaml` Initial Set

| Option | Description | Selected |
|--------|-------------|----------|
| Phase 13 ships ~15 obvious public Berlin events | Shin researches + commits starter YAML | ✓ |
| Ship empty/skeleton, populate post-launch | YAML scaffold only; events added by friend later | |
| Defer to office-hours with friend | Phase 13 commits placeholder; friend curates in next session | |

**Selected:** Ship starter YAML with ~15 hand-curated obvious events (Karneval der Kulturen, Berlin Marathon, CSD, Lange Nacht der Museen, Festival of Lights, Weihnachtsmärkte windows, Silvester, etc.). Friend reviews + adds materially-impactful local ones in a follow-up PR.
**Rationale:** ROADMAP SC #6 specifies "15-20 hand-curated Berlin events per year" — this is a hard acceptance criterion. Public-impact events don't require restaurateur-specific knowledge. Annual Sep 15 reminder handles future years.

---

## G-08: Transit Keyword Scope

| Option | Description | Selected |
|--------|-------------|----------|
| `Streik\|Warnstreik` only | Per REQUIREMENTS EXT-04 literal | |
| Extend to `Ausfall\|Sperrung\|Bauarbeiten\|Gleisarbeiten` | Broader BVG disruption coverage | |
| Module constant `KEYWORDS = ['Streik', 'Warnstreik']` | REQUIREMENTS literal as starter; v1.4 PR extends config | ✓ |

**Selected:** Module constant in `transit.py` with starter set `['Streik', 'Warnstreik']` per REQUIREMENTS literal.
**Rationale:** Config-constant style lets v1.4 PR extend without re-discussion or schema change. Honors REQUIREMENTS EXT-04 literal for v1. BVG RSS URL primary + fallback verified live during plan-phase (folds in the open todo from STATE.md).

---

## Folded Todos

- **(v1.3) Phase 13 — BVG RSS URL not yet end-to-end verified; CI step in 13's acceptance test** — folded into G-08 D-13 (plan-phase researcher verifies the live URL + documents one fallback URL; both go into `transit.py` as ranked fallbacks).

---

## Claude's Discretion

- Exact column types beyond PROPOSAL §7 + REQUIREMENTS specs.
- Internal Python module naming/imports beyond the file list in D-04.
- Fixture file format vs inline JSON literals.
- GHA `actions/setup-python` version + cache key.
- Wording of `recurring-events-yearly-reminder` cron payload.
- `pipeline_runs.error_msg` truncation strategy (e.g., 2000-char cap).

---

## Deferred Ideas

- Counterfactual fits + `forecast_track` discriminator (Phase 14).
- `forecast_daily`, `forecast_quality`, `campaign_calendar`, `campaign_uplift_v` tables (Phase 14/16; PROPOSAL §7 sketches them but they are NOT Phase 13).
- `baseline_items_v`, `kpi_daily_with_comparable_v` (Phase 16).
- Per-tenant `pipeline_runs` admin UI (v1.4).
- Extended `transit_alerts` keyword list beyond `Streik|Warnstreik` (v1.4).
- `shop_calendar` admin UI (v1.4).
- VCR.py / cassette-based test fixtures (v1.4 if API surface grows).
- Foundation-model deployment to Cloudflare Workers (irrelevant to v1.3).
