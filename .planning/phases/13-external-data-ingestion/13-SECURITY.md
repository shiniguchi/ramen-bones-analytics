---
phase: 13
slug: external-data-ingestion
status: verified
threats_open: 0
asvs_level: 1
created: 2026-04-30
---

# Phase 13 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| GHA Runner → Supabase | Python fetchers write to DB via service-role key | Weather, holidays, transit, events, shop calendar rows |
| External APIs → GHA Runner | HTTP responses from brightsky, open-meteo, ferien-api, BVG RSS | JSON/XML payloads (untrusted) |
| workflow_dispatch → GHA Runner | Manual trigger inputs (start_date, end_date) | User-supplied strings (untrusted) |
| Supabase → Frontend (PostgREST) | RLS-filtered reads via wrapper views | pipeline_runs status (error_msg hidden) |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-SEC-01 | Elevation of Privilege / Tampering | external-data-refresh.yml | mitigate | Inputs via `env:` block + DATE_RE regex validation (not shell interpolation) | closed |
| T-SEC-02 | Information Disclosure | external-data-refresh.yml | mitigate | Service-role key scoped to specific step, not job-level env | closed |
| T-SEC-03 | Elevation of Privilege | external-data-refresh.yml | mitigate | `permissions: contents: read` restricts GITHUB_TOKEN | closed |
| T-SEC-04 | Information Disclosure | 0046 + 0049 migrations | mitigate | Wrapper view `pipeline_runs_status_v` excludes error_msg/commit_sha from anon | closed |
| T-SEC-05 | Tampering (XSS) | transit.py | mitigate | `_strip_html` + `_safe_url` (allowlists http/https only) at ingest | closed |
| T-SEC-06 | Information Disclosure | weather.py, school.py | mitigate | Stripped `r.text[:200]` from exception messages (commit `277bcae`) + 0049 view lockdown | closed |
| T-SEC-07 | Tampering (Race Condition) | external-data-refresh.yml | mitigate | `concurrency:` block prevents workflow_dispatch/cron races | closed |
| T-SEC-08 | Tampering | migrations 0041-0047 | mitigate | Hybrid RLS: shared tables `USING (true)` + REVOKE writes; tenant tables JWT-scoped | closed |

---

## Accepted Risks Log

No accepted risks.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-04-30 | 8 | 8 | 0 | gsd-security-auditor + manual fix |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-04-30
