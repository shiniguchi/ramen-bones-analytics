# Ramen Bones Analytics

## What This Is

A free, forkable, mobile-first analytics web app that turns Orderbird POS transactions into banking-grade growth metrics (cohorts, retention, LTV) for non-technical restaurant owners. V1 serves a single ramen restaurant (the founder's friend); the architecture is built multi-tenant-ready so any restaurant owner can eventually fork or self-host.

## Core Value

A restaurant owner opens the site on their phone and makes a real business decision from the numbers they see — without needing a data team, a dashboard tool, or a deck.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Automated extraction of per-transaction Orderbird data with card-hash customer ID (daily refresh)
- [ ] Supabase Postgres as single source of truth, with SQL models for cohorts/retention/LTV as materialized views refreshed nightly via pg_cron
- [ ] First-visit acquisition cohorts (daily / weekly / monthly) with retention curves
- [ ] Customer LTV per segment
- [ ] Revenue trend KPIs (daily / weekly / monthly, avg ticket, tx count)
- [ ] Repeat visit rate and visit-frequency distribution
- [ ] Mobile-first SvelteKit frontend on Cloudflare Pages with interactive date/segment filters
- [ ] Login-protected access (Supabase Auth), scoped per restaurant
- [ ] Multi-tenant-ready data model from day 1 (RLS policies in place) even while v1 serves one tenant
- [ ] Forkable open-source repo (one-click deploy) so other restaurant owners can self-host

### Out of Scope

- Real-time / streaming data — daily refresh covers 99% of decisions, webhooks add complexity
- Onboarding flow / signup UI for v1 — single tenant, manual provisioning is fine
- Paid tier / billing — free and forkable is the business model
- Slide/PDF report generation — phone dashboard is the delivery vehicle
- Embedded notebooks in the user-facing UI — notebooks are the dev environment, not the product
- Non-Orderbird POS integrations — scope creep risk
- Desktop-first layout — phone is the primary viewing surface
- Looker / Metabase / external BI tools — product requirement is a custom web UI

## Context

- **Founder background:** Growth analyst at a bank, expert in acquisition/retention/LTV modeling. Applying banking playbooks to restaurants.
- **Origin:** Helping a friend who owns a ramen restaurant. Friend is non-technical.
- **Data source:** Orderbird POS. No public API; ISV Partner API requires application (weeks). Fallback: Playwright scraper against `my.orderbird.com` CSV export; email parsing for tax/DATEV as last resort.
- **Data depth:** 3–12 months of history available — enough for meaningful first-visit cohorts and short-range retention curves, not enough for 12-month LTV yet.
- **Customer identity:** Card hash / payment token (anonymized, no opt-in required).
- **User device:** Friend (and future owners) will open this on a phone. Mobile UX is non-negotiable.
- **Prior research (completed in pre-init conversation):**
  - Streamlit rejected — mobile layout broken
  - Next.js on Cloudflare Pages rejected — adapter friction
  - Supabase RLS confirmed as multi-tenancy strategy, with materialized views to avoid the analytical-query performance trap
  - SvelteKit chosen for first-class Cloudflare adapter and mobile bundle size

## Constraints

- **Tech stack:** SvelteKit + Cloudflare Pages (frontend), Supabase Postgres + Edge Functions + pg_cron (backend), Python + Playwright (extraction), Claude API (insight generation). No paid tiers in v1.
- **Timeline:** 2 weeks to MVP in friend's hands. Aggressive — skip polish, prioritize working KPIs over pixel-perfect UI.
- **Budget:** $0/month target. Free tiers only. Acceptable to reach ~$25/mo at 100+ restaurants later.
- **Data freshness:** Daily refresh (nightly cron) — no realtime/hourly in v1.
- **Mobile-first:** All views must be usable on a phone browser. Desktop is secondary.
- **Multi-tenant readiness:** RLS and tenant-scoped schema from day 1, even though v1 has one tenant. No rewrite later.
- **Forkability:** Repo must be forkable + self-hostable with minimal steps. No proprietary SaaS lock-in.
- **Security:** Card-hash only — never store PAN, PII, or raw card data. Supabase Auth handles credentials.
- **No Orderbird API yet:** v1 ships on Playwright scraper while ISV Partner API application is pending.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Single-tenant v1, multi-tenant architecture | Validate KPIs matter before building onboarding UX; avoid rewrite | — Pending |
| SvelteKit over Next.js on Cloudflare | First-class CF adapter, smaller mobile bundle, no edge-runtime workarounds | — Pending |
| Supabase Postgres over Cloudflare D1 | Postgres window functions + CTEs + generate_series needed for cohort SQL; RLS for multi-tenancy | — Pending |
| Materialized views + pg_cron (not dbt) | Simpler at current scale; revisit dbt past 50+ models | — Pending |
| Playwright CSV scraper as v1 extract path | ISV API approval takes weeks; need data flowing day 1 | — Pending |
| Daily refresh cadence | 99% of decisions don't need intraday; simpler cron | — Pending |
| Card hash as customer ID | Works without opt-in, captures all repeat visits | — Pending |
| Forkable open-source, no paid tier | Product philosophy — give the banking playbook away | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-13 after initialization*
