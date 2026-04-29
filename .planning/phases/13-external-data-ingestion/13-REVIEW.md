# Phase 13 — Pre-Landing Review (`/gstack-review`)

**Date:** 2026-04-29
**Branch:** `feature/phase-13-external-data-ingestion` (24 commits, head `c5be916`)
**Diff:** 47 files, 5,476 insertions vs `main`
**Reviewers:** 5 specialists (security, data-migration, testing, performance, maintainability) + adversarial subagent. Codex unavailable.
**Result:** **HOLD — multiple ship-blockers + design-decision items.**

---

## Multi-specialist confirmed (highest confidence)

These were independently flagged by 2+ reviewers — boost weight accordingly.

| # | Finding | Confirmed by | Confidence |
|---|---|---|---|
| **MS-1** | **GHA shell injection** at `.github/workflows/external-data-refresh.yml:37-38` — `${{ inputs.start_date }}` and `${{ inputs.end_date }}` are interpolated directly into bash. A workflow_dispatch invoker can run arbitrary code on the runner with `DEV_SUPABASE_SERVICE_ROLE_KEY` in env. **Public repo.** | security + adversarial | 10/10 |
| **MS-2** | **`pipeline_runs` RLS info leak** at `supabase/migrations/0046_pipeline_runs_extend.sql:24-31` — policy is `restaurant_id IS NULL OR restaurant_id::text = auth.jwt()->>'restaurant_id'`. All Phase 13 fetcher rows lack `restaurant_id`, so anon (no JWT) can read every fetcher's `error_msg` (stack traces, BVG strike titles, upstream hostnames). On a multi-tenant deploy, every tenant sees every other tenant's global rows. | security + data-migration + adversarial | 8/10 |
| **MS-3** | **Transit RSS not sanitized** at `scripts/external/transit.py:108` — `title`, `description`, `source_url` from BVG RSS stored verbatim. Renderer in Phase 15 will eventually XSS. `source_url` could be `javascript:`. | security + adversarial | 9/10 |
| **MS-4** | **`datetime.utcnow()` deprecated + naive** at `scripts/external/school.py:71` — Python 3.12+ deprecation; produces wrong freshness vs other fetchers' `datetime.now(timezone.utc)`. | maintainability + adversarial | 8/10 |

---

## Critical findings (P1 — fix before merge)

### Security / Attacker

| # | File:Line | Finding | Fix |
|---|---|---|---|
| C-1 | `external-data-refresh.yml:37` | **(see MS-1)** Shell injection | Move `inputs.*` to `env:` block; reference as `$START_DATE`; regex-validate format |
| C-2 | `external-data-refresh.yml:21` | Service-role key at job-level env exposes it to all steps + future `pip install` post-install hooks | Move key to the specific step that runs `python -m`; pin requirements with hashes |
| C-3 | `external-data-refresh.yml` (top) | No `permissions:` block — `GITHUB_TOKEN` defaults to repo-wide writeable | Add `permissions: contents: read` |
| C-4 | `0046:24-27` | **(see MS-2)** Anon can read all global pipeline_runs rows incl. error_msg | Restrict global-row visibility to a service-role view OR strip `error_msg` from anon-readable rows |
| C-5 | `transit.py:108` | **(see MS-3)** Stored XSS / `javascript:` URI risk | Strip HTML at ingest with `bleach.clean`; allowlist `https://` for source_url |
| C-6 | `weather.py:105`, `school.py`, `transit.py` | Raw upstream response body (`r.text[:200]`) propagates into `pipeline_runs.error_msg` → world-readable | Strip body from exception message; log to stderr only |

### Migration / Data

| # | File:Line | Finding | Fix |
|---|---|---|---|
| C-7 | `0045_recurring_events.sql:46-54` | `cron.schedule()` is **NOT idempotent** — re-running migration (e.g. `supabase db reset` in DEV) raises duplicate-jobname. Header comment claiming "upserts on jobname" is wrong. Migrations 0013/0017 in this repo already have the correct guard. | Wrap with `do $$ if exists (select 1 from cron.job where jobname=...) then perform cron.unschedule(...); end if; end$$;` per 0013 pattern |
| C-8 | `0045_recurring_events.sql:49` | pg_cron writes `status='warning'` to pipeline_runs but writer taxonomy is fixed `{success, fallback, failure}`. Phase 15 enum-matching will silently ignore or mis-categorize. | Either extend taxonomy + add CHECK constraint, OR change cron to write `status='success'` with structured error_msg |
| C-9 | `0046:18` | New `restaurant_id` column has **no index**; RLS policy filters every read | `create index if not exists pipeline_runs_restaurant_id_idx on pipeline_runs (restaurant_id);` |

### Chaos / Production reliability

| # | File:Line | Finding | Fix |
|---|---|---|---|
| C-10 | `transit.py:86` | **feedparser silent fail.** Primary BVG URL is documented stale → returns HTTP 200 + HTML. feedparser parses HTML to `entries=[]`, NO error raised. `_run_transit` writes `status=success, row_count=0`. **Repeat of `.claude/memory/project_silent_error_isolation.md` pattern.** | Check `feed.bozo` AND content-type after `feedparser.parse()`. Raise `UpstreamUnavailableError` if either fails |
| C-11 | `holidays.py:31` | BE-vs-federal merge: when BE row name differs from federal, code overwrites and drops federal name; when names match, code keeps federal seed marking `subdiv_code=NULL` even if BE also has the date. Downstream filters on `subdiv_code` will mis-bucket holidays. | Use `Germany(subdiv='BE')` ALONE; mark `subdiv_code='BE'` iff date NOT in federal-only set |
| C-12 | `run_all.py:50` | **Weather backfill silently extends end_date.** `wend = max(end_date, today + 7)` for a 2-day backfill in 2025 fetches data through ~today+7 (10+ months extra). Risks 15-min GHA timeout. | Drop `max()`; use `wend = end_date` for explicit ranges |
| C-13 | `weather.py:138` | Forecast dates are in the future → `freshness_h = (now - future_dt)` is **negative**. Dashboard freshness badge interprets smaller numbers as fresher → stale forecast feed appears ultra-fresh. | Compute against `MAX(date <= today)`; clamp `max(0.0, ...)` |
| C-14 | `weather.py:104` | Single chunk 5xx in a 12-chunk backfill **throws away all already-fetched rows**. Comment claims "lets one failed chunk be reported as fallback without nuking" — code does opposite. | Flush rows per-chunk; on chunk N failure, upsert chunks 1..N-1 then raise with partial marker |
| C-15 | `transit.py:48` | `alert_id = sha256(title + pub_date)[:32]`; if `entry.published_parsed` missing, falls back to `datetime.now()` → re-fetches produce different IDs (duplicates). Same-second identical titles collide (overwrite). | Hash on `entry.id`/`entry.link` (RSS guid) when available; never fall back to wall-clock |
| C-16 | `events.py:28` | Duplicate `event_id` in `recurring_events.yaml` silently overwrites. Copy-paste 2026 → 2027 forgetting to bump id eats one event. | Assert `len({r['event_id'] for r in rows}) == len(rows)`; raise on dupes |
| C-17 | `events.py:24`, `shop_calendar.py:34` | Missing config file → uncaught FileNotFoundError; or REPO_ROOT mis-resolves on pip-install layout (currently relies on source-checkout path) | Fail-fast at top of `main()`: assert both YAMLs exist before any fetcher runs |
| C-18 | `external-data-refresh.yml` (top) | No `concurrency:` block — manual `workflow_dispatch` backfill can race against scheduled cron | `concurrency: { group: external-data-refresh, cancel-in-progress: false }` |
| C-19 | `run_all.py:53-67` | Each fetcher upserts data FIRST, then writes pipeline_runs. If the writer fails, data lands but no breadcrumb (or worse: writer-failure caught and reported as 'failure' for successful data) | Two-phase write: insert pipeline_runs row as `started`, then update to `success` after upsert |

### Performance

| # | File:Line | Finding | Fix |
|---|---|---|---|
| C-20 | `weather.py:103` (and school, transit) | No shared `httpx.Client` across chunks → 100-300ms TLS handshake × N chunks wasted | Single `httpx.Client(timeout=httpx.Timeout(30.0, connect=10.0))` reused |
| C-21 | `weather.py:100` (and school, transit) | **No retry/backoff** for 429/503/ConnectError/ReadTimeout. One transient blip during 12-chunk backfill aborts the whole night. | Add tenacity retry wrapper: 3 attempts, exponential backoff, retry on 429/503/network errors |
| C-22 | `run_all.py:175` | 6 fetchers run **serially**; nightly target is <5min. Slow upstream → blown SC. Independent fetchers are textbook `asyncio.gather`. | Convert to async or `concurrent.futures.ThreadPoolExecutor(max_workers=6)` |

---

## Testing gaps (P1 — block merge for gaps in critical paths)

| # | File:Line | Finding |
|---|---|---|
| T-1 | every fetcher `tests/external/test_*.py` | `upsert()` and `freshness_hours()` helpers in **all 6 fetchers** lack direct unit tests. on_conflict keys, empty-rows guards, freshness contracts unverified. |
| T-2 | `test_run_all.py` | Fallback path (`UpstreamUnavailableError → write_fallback`) tested only for weather; school + transit branches untested |
| T-3 | `test_run_all.py` | No general `Exception → write_failure` test per fetcher; per-source failure-row shape unverified |
| T-4 | `test_run_all.py` | `_run_shop_calendar` `restaurant_id` propagation to pipeline_runs (the one tenant-scoped writer call) is uncovered |
| T-5 | `test_pipeline_runs_writer.py` | Missing: `restaurant_id` propagation, `_commit_sha()` env fallback, `_truncate(None)` branch |
| T-6 | `tenant-isolation.test.ts:147` | INSERT-denied test uses `{noop:'x'}` payload — passes via constraint violation regardless of RLS state |
| T-7 | `tenant-isolation.test.ts:168` | Tenant-B isolation test passes trivially on empty result; doesn't distinguish "RLS works" from "JWT lacks claim" |
| T-8 | `tenant-isolation.test.ts:201` | Pipeline_runs RLS test only checks tenant A's view; doesn't catch one-sided bugs (literal UUID hardcoded) |
| T-9 | `migrations-13.test.ts:150` | Cron schedule regex `/15\s+9/` too loose — matches both correct `'0 9 15 9 *'` and incorrect `'0 0 15 9 *'` |
| T-10 | `migrations-13.test.ts:184` | RLS-policy test only asserts policyname exists, not the policy `qual` body. A future `using (true)` regression silently passes. |
| T-11 | `tests.yml:48` | `pytest-external` job runs `tests/external/` only — `tests/ci-guards/test_check_cron_schedule.py` (Guard 8) is NEVER run in CI. Regression in cron-schedule guard ships unnoticed. |

---

## Informational (P2 — fix in a follow-up)

### Indexes
- `0043_school_holidays.sql` — add `(state_code, start_date, end_date)` for date-range queries
- `0044_transit_alerts.sql` — add `(pub_date desc)` for recency queries
- `0045_recurring_events.sql` — add `(start_date, end_date)` for date-window joins

### Forkability / configurability
- `weather.py:23` — hardcoded LOCATION/LAT/LON/timezone (Berlin). Should be env-tunable.
- `school.py:15` — hardcoded `STATE='BE'` (Berlin). Same.
- `transit.py:36` — BVG-specific URLs + German keywords. Module name `transit.py` is too generic; document or rename.

### Maintainability / DRY
- `run_all.py:45-169` — 6 nearly-identical `_run_X()` functions. Extract a single helper driven by a `SOURCES` dispatch table.
- `pipeline_runs_writer.py:42-120` — 3 nearly-identical `write_*` functions. Extract `_write(status=...)` + 3 wrappers.
- `pipeline_runs_writer.py:18` — uses `Optional[X]` while rest of codebase uses PEP 604 `X | None`. Inconsistent.
- `pipeline_runs_writer.py:31` — truncation appends `'...'` indistinguishably from organic ending. Use `' [TRUNCATED — N chars; see GHA log]'`.
- `run_all.py:63` — `error_msg=str(e)` loses exception type. Use `f'{type(e).__name__}: {e}'`.

### Performance — secondary
- `shop_calendar.py:74` — single 365-row upsert; multi-tenant scaling will hit 1MB cap. Add chunked-upsert helper.
- `pipeline_runs_writer.py:64` — 6 sequential single-row inserts (~1s round-trip total). Batch after fetchers parallelize.
- `external-data-refresh.yml:19` — 15-min timeout is tight for cold backfill if any upstream slow. Acceptable for now; revisit after fetcher parallelization.

### Security — secondary
- `transit.py:85` — `feedparser.parse(body)` on attacker-controllable bytes. Pin `feedparser>=6.0.10` (XXE/entity hardening); cap response size.
- `pipeline_runs_writer.py:31` — char-naive truncation; multibyte split possible (Postgres TEXT is unbounded so safe today; document).
- `transit.py:65, weather.py, school.py` — no `max_response_size` on `httpx.get()`; malicious upstream could OOM the runner.

### Data model gaps
- `0041_weather_daily.sql` — schema can't distinguish observation vs forecast. Cron during backfill races on same `(date, location)` PK. Consider `record_kind` column.
- `transit.py:40` — substring match for `Streik` matches `Werbestreikbruch` etc. Use `\b` word-boundary regex.
- `0046:18` — FK `on delete cascade` deletes audit history when tenant deleted. Confirm intent.

### Adversarial — secondary
- `weather.py:67` — `normalize_brightsky` doesn't filter results to requested date range; edge dates leak in.
- `weather.py:126` — `WEATHER_PROVIDER` env unvalidated; typo silently falls through to brightsky.

---

## Decision audit trail

No fixes applied yet. All findings are presented for triage.

---

## Summary

- **Ship-blockers (P1):** 22 critical findings + 11 testing gaps
- **Cross-specialist confirmed:** 4 (highest signal)
- **Highest immediate risk:** GHA shell injection (MS-1) — public repo, service-role key exposed
- **Highest design risk:** RLS info leak via global pipeline_runs rows (MS-2) — multi-tenant time bomb

**Recommended path:**
1. Fix MS-1, C-1, C-3, C-7, C-9, C-13, C-12, C-21 mechanically — these are 1-3 line changes
2. Decide the design-affecting items (MS-2, C-8, C-11, C-14, C-19, C-22) — discuss before fixing
3. Bulk-add the missing tests (T-1..T-11)
4. Defer P2 to a Phase 13.1 follow-up branch
