# Feature Research

**Domain:** Restaurant growth analytics for non-technical SMB owners (mobile-first, banking-style cohorts/LTV)
**Researched:** 2026-04-13
**Confidence:** MEDIUM-HIGH (SMB POS dashboard conventions are well-documented; "banking analytics applied to restaurants" is novel so differentiators are opinionated)

## Executive Summary

Toast/Square/Lightspeed dashboards optimize for one question: "how much did I make today?" They expose sales totals, top items, labor %, and a few trendlines. They do **not** expose cohorts, retention curves, or LTV by acquisition week — those are bank/SaaS concepts that don't exist in mainstream restaurant tooling. That gap **is the product**.

Non-technical restaurant owners on phones want: big number, arrow (up/down vs last week), one-sentence interpretation. They bounce from dense tables, legends, and any chart requiring zoom. The winning UX is a vertically-stacked stream of "card = one insight" with date-range as the only global filter.

## Feature Landscape

### Table Stakes (Users Expect These)

Missing these makes the product feel broken to a restaurant owner who has ever seen a Toast/Square backend.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Revenue today / this week / this month with delta vs prior period | Every POS dashboard leads with this; it's the "is the business okay" glance | LOW | Already in Active requirements. Must be the first thing on screen. |
| Transaction count + average ticket | Standard POS triumvirate alongside revenue | LOW | Cheap to compute; high signal for owners |
| Daily revenue trendline (last 30/90 days) | Spark-line equivalent; owners scan for dips visually | LOW | Use a simple area chart, not candlesticks |
| Date range selector (today / 7d / 30d / 90d / custom) | Every dashboard has this; owners filter by "how's this week" | LOW | Mobile pattern: preset chips > date picker. Custom range behind a "More" tap. |
| Day-of-week / hour-of-day heatmap | Standard in Toast/Square; owners use it for staffing | MEDIUM | High value but easy to over-design. A 7x24 grid is fine; label only peaks. |
| Repeat visit rate (% customers returning within N days) | Banking-style but increasingly table-stakes in loyalty tools | LOW | Already in Active requirements |
| Mobile-optimized layout (single column, thumb-reachable, no horizontal scroll) | Owners check this between tickets on the floor | MEDIUM | Non-negotiable per PROJECT.md. All charts must render <375px wide. |
| Login-protected per-tenant access | Basic expectation for any business data | LOW | Supabase Auth + RLS already planned |
| "Last updated at" timestamp on every view | Trust signal — owners want to know if data is fresh | LOW | Daily cron means show "Updated 6h ago" |
| Empty/low-data state messaging | Owners panic when a chart is blank; needs explanation | LOW | "Not enough data yet — come back in 7 days" beats a broken chart |

### Differentiators (Competitive Advantage)

The "banking playbook applied to restaurants" edge. None of Toast/Square/Lightspeed ship these to owners.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| First-visit acquisition cohorts (daily/weekly/monthly) with retention curves | Answers "are customers who found me in March still coming back?" — no restaurant tool does this for owners | HIGH | Core Active requirement. Needs card-hash identity + cohort SQL. Viz: stacked retention curve OR triangle table; mobile likely curve. |
| LTV per customer segment (by cohort, by channel, by first-order size) | Turns "our regulars matter" intuition into a number the owner can act on | HIGH | Depends on cohort model. V1 can ship 90-day LTV proxy, note the data-depth limitation |
| "What changed this week" narrative card (plain-English insight) | Non-technical owners can't read charts fluently; one sentence beats ten axes | MEDIUM | Claude API already in stack. Prompt: "Given these deltas, write one sentence a restaurant owner would act on." Guard against hallucination with deterministic rules. |
| Repeat-vs-new customer revenue split | Shows whether growth is from new traffic or loyalty — banking's acquisition/retention decomposition | LOW | Trivial once cohort model exists. Very high owner AHA value. |
| Visit frequency distribution (1x, 2x, 3-5x, 6-10x, 11+) | Reveals the "super-regular" tail that drives most revenue — classic banking power-law lens | LOW | Bar chart, 5 buckets. Active requirement. |
| "Regulars at risk" list (customers whose inter-visit gap just broke) | Actionable retention alerting; restaurant equivalent of churn risk scoring | MEDIUM | Needs per-customer inter-visit baseline. Powerful if accurate, creepy if wrong. |
| Acquisition channel attribution (if/when UTM or promo-code data exists) | Banks obsess over CAC by channel; restaurants almost never measure it | HIGH | V1 defer — Orderbird data likely has no channel field. Flag as v2. |
| Forkable open-source repo with one-click self-host | Every other tool is SaaS lock-in; forkability is the distribution strategy | MEDIUM | Active requirement. The docs matter as much as the code. |
| Single-glance "owner briefing" on load (3 numbers + 1 sentence + 1 alert) | Optimizes for the 15-second phone check — the actual user behavior | MEDIUM | The app's opinionated home screen. Replaces the generic "dashboard grid". |

### Anti-Features (Commonly Requested, Often Problematic)

Things that look smart on a roadmap but confuse or get ignored by the target user.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Real-time / live-updating numbers | "Feels modern", competitors market it | Owners don't act on intraday noise; adds webhook/stream complexity; daily refresh is already in Out of Scope | Daily refresh + visible "Updated Xh ago" timestamp |
| Cohort triangle (retention matrix) as primary viz | It's how analysts view cohorts | Unreadable on 375px; owners can't decode the diagonal | Retention curve (line chart) per cohort; triangle optional in "details" |
| Customizable dashboard / drag-drop widgets | Enterprise BI convention | Non-technical owners never customize; adds state, bugs, empty-state hell | One opinionated screen. No customization in v1. |
| Multi-chart comparison grids (4+ charts on screen) | "Show me everything" | Phone screen can't fit, owners get overwhelmed, nothing stands out | Vertical stream of single-purpose cards |
| Forecasting / ML revenue prediction | Sounds impressive in demos | Needs years of data; any wrong prediction destroys trust; Orderbird data is 3-12mo | Trend direction arrows + week-over-week delta only |
| Export to CSV / PDF report | Classic BI checkbox | Owner is on a phone, not emailing decks; validates the wrong product | Shareable link to the live view if needed later |
| Filter builder / SQL-like segment UI | Banking analysts love this | Non-technical owners won't touch it; eats design budget | 3-5 hardcoded segments (new/returning/regulars/at-risk) as tappable chips |
| Menu-item-level profitability with COGS | Operators theoretically want it | Requires COGS data Orderbird doesn't have; turns into manual data entry | Defer until ingredient cost integration exists |
| Labor cost % / scheduling | Toast/Square have it | Out of scope for data source (no labor data in Orderbird CSV) | Explicitly not this product |
| Benchmarks vs "other restaurants" | Sounds valuable | Single-tenant v1 has no peer set; false benchmarks destroy trust | Defer until N>20 tenants on the same platform |
| Email/push daily digests | "I'll check it without opening the app" | Owner ignores emails during service; adds infra; v1 is a web app | Make the web app so fast to open that a bookmark wins |
| Dark mode / theming | "Modern app expectation" | Zero business value in v1, real CSS cost | Pick one mode, make it readable outdoors (high contrast light) |
| In-app chat with an AI analyst | Everyone is shipping this in 2026 | Owner doesn't know what to ask; freeform chat = freeform confusion | Pre-computed "what changed" narrative card (deterministic prompt) |
| Onboarding tour / feature tooltips | Standard SaaS UX | Single-tenant v1 has one user who got a personal walkthrough | Skip. Revisit when multi-tenant signup ships. |

## Feature Dependencies

```
Orderbird CSV extraction (Playwright)
    └──requires──> Card-hash customer identity
                       └──requires──> Per-transaction normalized schema in Postgres
                                          ├──enables──> Revenue / tx / avg-ticket KPIs
                                          ├──enables──> Day-of-week / hour heatmap
                                          └──enables──> First-visit cohort model (mat view)
                                                            ├──enables──> Retention curves
                                                            ├──enables──> LTV per segment
                                                            ├──enables──> Repeat visit rate
                                                            ├──enables──> Visit frequency distribution
                                                            ├──enables──> Repeat-vs-new revenue split
                                                            └──enables──> Regulars-at-risk list

Mobile SvelteKit shell + Supabase Auth/RLS
    └──enables──> Any view at all

"What changed this week" narrative card
    └──requires──> KPI deltas computed + Claude API wiring
    └──enhances──> Owner briefing home screen

Acquisition channel attribution
    └──conflicts──> Orderbird-only data source (no channel field exists)
```

### Dependency Notes

- **Everything analytical depends on card-hash identity.** Without it, there is no "customer", so no cohort, no LTV, no repeat rate. This is the single most load-bearing piece.
- **Cohort materialized view is the trunk.** Retention, LTV, repeat rate, frequency distribution, new/returning split, and at-risk list are all leaves on the same SQL tree. Build the view once, derive the rest cheaply.
- **Narrative card is an enhancer, not a dependency.** Ship KPIs first without it; add Claude-powered narrative once deltas are stable. Don't block launch on prompt tuning.
- **Channel attribution conflicts with v1 data source.** Orderbird CSV has no UTM/channel. Do not promise it in v1.
- **Mobile layout is a cross-cutting constraint, not a feature.** Every card above must be designed <375px first.

## MVP Definition

### Launch With (v1 — 2-week target per PROJECT.md)

Ruthless minimum to put something real in the friend's hands and validate that banking metrics change restaurant decisions.

- [ ] Daily Orderbird CSV ingestion + card-hash normalization — no data, no product
- [ ] Supabase schema with RLS + cohort/retention/LTV materialized views — the analytical backbone
- [ ] Owner briefing home screen: revenue (today/7d/30d) + delta + tx count + avg ticket — the 15-second glance
- [ ] First-visit cohort retention curve (weekly cohorts, 8-week horizon) — the hero differentiator
- [ ] Repeat visit rate + visit frequency distribution — cheap wins off the cohort view
- [ ] Repeat-vs-new revenue split — the "aha" chart
- [ ] Simple LTV-to-date by weekly cohort (with honest "data only covers N weeks" disclaimer) — the banking signature, caveated
- [ ] Date range preset chips (7d / 30d / 90d) — the only filter in v1
- [ ] "Last updated" timestamp + empty-state copy — trust signals
- [ ] Supabase Auth single-tenant login — access control

### Add After Validation (v1.x — once friend is using it weekly)

- [ ] Day-of-week / hour-of-day heatmap — add once owner asks "when are my slow times?"
- [ ] "What changed this week" Claude-generated narrative card — add once deltas stabilize and prompt is tuned
- [ ] Regulars-at-risk list — add once inter-visit baselines are reliable (needs ≥60 days data)
- [ ] Segment filter chips (new / returning / regulars) — add when owner asks the first segmentation question
- [ ] Custom date range picker — add only if preset chips prove insufficient

### Future Consideration (v2+)

- [ ] Multi-tenant onboarding UI — only after KPIs are validated with tenant #1
- [ ] Acquisition channel attribution — only if/when Orderbird API or promo-code data unlocks channel field
- [ ] Peer benchmarking — only after N≥20 tenants on the platform
- [ ] Menu-item profitability — only after COGS integration exists
- [ ] Forecasting — only after 12+ months of history per tenant

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Revenue/tx/avg-ticket KPIs + deltas | HIGH | LOW | P1 |
| First-visit weekly cohort retention curve | HIGH | HIGH | P1 |
| Repeat visit rate + frequency distribution | HIGH | LOW | P1 |
| Repeat-vs-new revenue split | HIGH | LOW | P1 |
| LTV-to-date per cohort (caveated) | HIGH | MEDIUM | P1 |
| Date preset chips (7/30/90) | MEDIUM | LOW | P1 |
| Owner briefing home screen layout | HIGH | MEDIUM | P1 |
| Mobile-first responsive shell | HIGH | MEDIUM | P1 |
| "Last updated" + empty states | MEDIUM | LOW | P1 |
| Day-of-week / hour heatmap | MEDIUM | MEDIUM | P2 |
| Claude narrative "what changed" card | HIGH | MEDIUM | P2 |
| Regulars-at-risk list | HIGH | MEDIUM | P2 |
| Segment filter chips | MEDIUM | MEDIUM | P2 |
| Custom date range picker | LOW | LOW | P2 |
| Forkable self-host docs | MEDIUM | MEDIUM | P2 |
| Channel attribution | HIGH | HIGH | P3 (blocked by data) |
| Peer benchmarks | MEDIUM | HIGH | P3 |
| Forecasting | LOW | HIGH | P3 |
| Customizable dashboard | LOW | HIGH | Anti |
| Real-time streaming | LOW | HIGH | Anti |
| CSV/PDF export | LOW | LOW | Anti |
| AI chat interface | LOW | MEDIUM | Anti |

**Priority key:**
- P1: Must ship in v1 MVP
- P2: Add after validation with tenant #1
- P3: Defer to v2+ or blocked on external dependency
- Anti: Explicitly NOT building (see Anti-Features table)

## Competitor Feature Analysis

| Feature | Toast Dashboard | Square for Restaurants | Lightspeed Analytics | Our Approach |
|---------|-----------------|------------------------|---------------------|--------------|
| Revenue KPIs | Hero metric, desktop-first | Hero metric, mobile-ok | Hero metric, desktop-first | Hero metric, mobile-first, with delta narrative |
| Day/hour heatmap | Yes | Yes | Yes | P2 — ship after core cohorts |
| First-visit cohort retention | **No** | **No** | **No** | **P1 — our hero differentiator** |
| LTV per segment | No (basic loyalty only) | No (basic repeat % only) | No | **P1 — banking-grade, caveated** |
| Repeat visit rate | Partial (loyalty module) | Partial | Partial | P1 — surfaced by default, no separate module |
| Visit frequency distribution | No | No | No | **P1** |
| Mobile-first phone UX | Desktop-primary, mobile afterthought | Mobile-decent | Desktop-primary | **Mobile-first, single column, preset chips** |
| Narrative/insight text | No | Minimal | No | **P2 — Claude-generated "what changed"** |
| Customization / widgets | Yes | Yes | Yes | **No — opinionated single screen** |
| Export CSV/PDF | Yes | Yes | Yes | **No — live shareable link only** |
| Real-time stream | Partial | Partial | No | **No — daily refresh, visible timestamp** |
| Forkable / self-host | No (SaaS) | No (SaaS) | No (SaaS) | **Yes — open source, one-click deploy** |
| Price | $$$/mo + hardware | $$/mo + hardware | $$/mo + hardware | **Free** |

## Mobile UX Considerations (Cross-Cutting)

Called out per quality gate — these apply to every P1 feature, not a single line item.

- **Viewport floor:** iPhone SE (375px). If it doesn't fit there, it doesn't ship.
- **Single-column vertical stream:** each insight is a card; no side-by-side, no tabs, no drawers in v1.
- **Thumb zone:** primary actions (date chips, nav) in the bottom third of the screen.
- **Chart readability outdoors:** high contrast, min 14px axis labels, no relying on color alone (add up/down arrows + numbers).
- **No hover:** every tooltip must also work on tap. Prefer annotating the chart directly over tooltips.
- **No zoom-to-read:** if a cohort triangle needs pinch-zoom to decode, use a retention curve instead.
- **Fast first paint:** owner opens the app on 4G between tickets. Static-generate what you can, cache materialized view reads, keep JS bundle <150kb.
- **One filter global:** date range. Segment filters are P2. Resist filter-builder creep.
- **Empty state is a feature:** "Not enough data yet — cohort view unlocks after 14 days" beats a broken curve.

## Sources

- PROJECT.md requirements and context (primary — the user's own prioritization is authoritative)
- Toast / Square / Lightspeed public product pages and demo screenshots (competitor dashboard conventions) — MEDIUM confidence, WebSearch-derived, not live-verified
- Banking growth analytics conventions (cohort/LTV/retention curve practice) — HIGH confidence from founder domain expertise stated in PROJECT.md
- SMB mobile dashboard UX patterns (preset chips, single-column stream, narrative cards) — MEDIUM confidence, industry convention

**Confidence caveats:**
- Anti-features list reflects strong opinion grounded in non-technical SMB user patterns; LOW confidence that every owner will ignore every item, HIGH confidence that shipping all of them in v1 kills the 2-week timeline.
- Cohort retention curve vs triangle recommendation is opinionated; validate with the actual friend in week 1.
- Narrative card ROI unproven — keep P2, not P1.

---
*Feature research for: restaurant growth analytics, mobile-first, banking-style metrics*
*Researched: 2026-04-13*
