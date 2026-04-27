# Pitfalls Research

**Domain:** Free, forkable, mobile-first restaurant POS analytics (Orderbird → Supabase → SvelteKit/CF)
**Researched:** 2026-04-13
**Confidence:** HIGH for analytics/RLS/Postgres pitfalls (well-documented); MEDIUM for Orderbird-specific CSV gotchas (inferred from generic EU POS CSV patterns and hospitality GAAP); HIGH for scope/UX traps.

---

## Executive Take

The three pitfalls that will actually hurt this project are:

1. **The cohort survivorship / short-history LTV trap** — the founder's banking instincts will produce LTV numbers that are *technically correct* but *socially wrong* (friend sees "€18 LTV" for a cohort that's only 14 days old and either panics or loses trust). Caveating is not optional; it's a P1 feature.
2. **RLS-on-materialized-views silent leak** — already surfaced in ARCHITECTURE.md; reinforced here because this is the single bug that ends the project if it ships to tenant #2 undetected.
3. **Timezone off-by-one on day boundaries** — Berlin `Europe/Berlin` is UTC+1/+2, pg_cron runs in UTC, Orderbird CSV timestamps are local-naive, SvelteKit on CF is UTC. Any one of three mistakes silently shifts "Tuesday revenue" by 24 hours.

The 2-week MVP timeline is most threatened not by the scraper or the charts, but by **scope creep driven by the founder's analyst instincts** (over-modeling, feature-itis, building-for-self). Explicit anti-feature discipline from FEATURES.md must hold.

---

## Critical Pitfalls (Project-Ending if Missed)

### Pitfall 1: RLS silently bypassed via materialized views
**Category:** Multi-tenant security
**What goes wrong:** Postgres MVs don't honor RLS. A `SELECT * FROM cohort_mv` from an authenticated user returns **all tenants' data** unless `REVOKE ALL` is enforced and the only read path is a security-definer wrapper view. Silent — no error, no log.
**Warning signs:**
- MV created before the `_v` wrapper view pattern is muscle memory
- Any `supabase.from('cohort_mv')` reference in SvelteKit code (should be `cohort_v`)
- Test suite has only one seeded `restaurant_id`
- Grepping the codebase for `_mv` returns hits outside migration files
**Prevention:**
- Enforce the build order from ARCHITECTURE.md: tables + RLS + wrapper-view template **before** any analytical SQL
- Seed a **second throwaway tenant** from day 1 and write a CI test asserting user A can't see user B's rows in every `_v` view
- Lint/grep rule in CI: `grep -r '_mv' src/` must return zero matches in `+page.server.ts` and friends
- `REVOKE ALL ON cohort_mv FROM authenticated, anon` in the same migration that creates the MV
**Phase:** Phase 1 (Foundation) — before first MV exists
**Confidence:** HIGH

### Pitfall 2: Cohort survivorship bias + short-history LTV shown without caveat
**Category:** Analytics correctness
**What goes wrong:** With only 3–12 months of data, any cohort older than ~6 weeks has "full" retention curves while recent cohorts look artificially worse (they haven't had time to retain). LTV shows €X for cohort March; €Y (much lower) for cohort October — the owner concludes "October customers are worse" when really they've had 2 weeks vs 30 weeks to spend. Classic survivorship / right-censoring trap.
**Warning signs:**
- LTV numbers decline monotonically toward recent cohorts
- Retention curves all end at "100% at week 0" but recent ones truncate at week 2
- No "cohort age" column in the MV
- No empty-state message for cohorts younger than N weeks
**Prevention:**
- Every cohort/LTV view displays **cohort age in weeks** next to the number
- Hard rule: LTV number is hidden (replaced with "—  need ≥N weeks of data") for cohorts younger than the max-observable horizon of the oldest cohort
- Present LTV-to-date (not projected LTV) and label it "LTV through week N, capped at oldest available window"
- Retention curves clip x-axis to the shortest cohort's horizon when comparing cohorts, not the longest
- Write the caveat copy **before** the SQL — if you can't explain the caveat in one sentence, the view is wrong
**Phase:** Phase 2 (Core analytics SQL) — enforce in MV + render layer simultaneously
**Confidence:** HIGH

### Pitfall 3: Timezone off-by-one day boundary
**Category:** Analytics correctness
**What goes wrong:** Five timezones in the chain: (1) Orderbird CSV timestamps (local naive, likely `Europe/Berlin`), (2) pg_cron UTC, (3) Supabase storage UTC, (4) CF Pages edge UTC, (5) user's phone local time. `date_trunc('day', occurred_at)` on a UTC timestamp assigns a 00:30 Berlin Wednesday sale to *Tuesday*. "Revenue yesterday" shows the wrong number depending on which service is asking.
**Warning signs:**
- `occurred_at timestamptz` populated without explicit TZ conversion from scraper
- SQL uses `date_trunc('day', occurred_at)` without `AT TIME ZONE`
- Daily revenue totals differ by a small constant between two views
- 2am Berlin-time sales "disappear" or double-count at month boundaries
**Prevention:**
- Scraper: parse Orderbird CSV timestamps explicitly as `Europe/Berlin`, store as `timestamptz` (Postgres will normalize to UTC)
- Every SQL day-truncation: `date_trunc('day', occurred_at AT TIME ZONE r.timezone)::date as business_date` (join to `restaurants.timezone`)
- Store a **pre-computed `business_date`** column on `transactions` to avoid TZ math at read time
- Test fixture: include a transaction at `23:45 Berlin` and assert it lands in the correct `business_date`
- pg_cron schedule accounts for Berlin TZ: if "nightly at 3am local" is desired, schedule `'0 1 * * *'` UTC in winter / `'0 2 * * *'` DST-aware (or just run at 02:00 UTC and accept minor drift)
**Phase:** Phase 1 (schema) — bake `business_date` into `transactions` immediately
**Confidence:** HIGH

### Pitfall 4: Claude hallucinates a number in the narrative card
**Category:** LLM-in-production
**What goes wrong:** Prompt includes "revenue was €4,230 yesterday, up 12% from €3,775 the week prior" and Claude writes "Revenue climbed to €4,320, a 15% jump" — close enough to look right, wrong enough to destroy trust. Non-technical owner has no way to spot it.
**Warning signs:**
- Prompt asks Claude to "summarize the week's performance" (too open-ended)
- Output contains any digit not explicitly in the input
- No post-generation validation
- Owner asks "why does the card say X but the chart says Y"
**Prevention:**
- **Instruct Claude to phrase, never to calculate.** Prompt: "Given these exact numbers, write one sentence an owner would act on. Do not compute new figures. Do not mention any number not in the input list."
- **Regex guard post-generation:** extract all digit runs from the output, assert each is a substring of the input numbers (or one of `1|2|...|7` for day references). Reject and fall back to a deterministic template if any digit fails.
- Template fallback: `"Revenue {direction} {pct}% vs last week — {top_driver}."` — filled from KPI deltas, never from Claude, used when API fails or guard trips.
- Log the full prompt + response to a `llm_calls` table for audit.
**Phase:** Phase 3 (Narrative insights) — guard code ships with first Claude call, not later
**Confidence:** HIGH

### Pitfall 5: Card-hash PII creep via join to real identity
**Category:** Security / data protection
**What goes wrong:** A future "regulars at risk" feature adds name/email from a loyalty CSV. Suddenly `card_hash` → email mapping exists somewhere and the "no PII" promise is dead. GDPR scope explodes.
**Warning signs:**
- Any table referencing `card_hash` that also contains name/email/phone
- Import flow that accepts "customer list" CSV
- Support request: "can you tell me who customer abc123 is?"
**Prevention:**
- Schema comment on `transactions.card_hash`: `-- PII boundary: never join to personally identifiable fields. Add new PII? Update PROJECT.md Out of Scope first.`
- Hash salt includes `restaurant_id` (already planned) so the same card across restaurants doesn't correlate
- Explicit CI check: no table may contain both `card_hash` and any column matching `/email|phone|name|address/i`
- Put "no PII" in PROJECT.md Constraints (it is) and review at every milestone transition
**Phase:** Phase 1 (schema) — constraint in code; revisit every phase
**Confidence:** HIGH

---

## Moderate Pitfalls (Measurable Pain, Recoverable)

### Pitfall 6: Window function off-by-one in cohort SQL
**What goes wrong:** `ROW_NUMBER() OVER (PARTITION BY card_hash ORDER BY occurred_at)` — was the first visit row 0 or row 1? Off-by-one silently classifies first-time customers as returning or vice versa, inflating retention by ~15%.
**Warning signs:** Week-0 retention is not 100%; "new customers" count doesn't match `COUNT(DISTINCT card_hash WHERE first_visit)`.
**Prevention:** Test fixture with 3 customers (1 visit, 2 visits, 5 visits) and assert exact counts at each retention bucket. Use `MIN(occurred_at) GROUP BY card_hash` to compute `first_visit_date` — avoid `ROW_NUMBER` for this entirely.
**Phase:** Phase 2
**Confidence:** HIGH

### Pitfall 7: Playwright storageState expires, silent stale dashboard
**What goes wrong:** `storageState.json` works for 3–7 days, then Orderbird forces re-login (maybe with captcha). GHA job fails silently if no alerting, dashboard shows "updated 6h ago" then "updated 30h ago" and the friend assumes nothing is broken.
**Warning signs:** GHA workflow "failed" badge on README; `cron.job_run_details` shows no new `stg_orderbird_tx` rows; "Last updated" exceeds 30h.
**Prevention:**
- GHA workflow posts to Discord/Slack/email on failure (use `if: failure()` step)
- Dashboard banner: "⚠ Data is Xh stale" when >30h since last ingest
- Weekly refresh-storage-state GHA workflow with human-in-the-loop reminder
- Consider headless login with `OB_USER` / `OB_PASS` from secrets as fallback when `storageState` fails — accepts captcha risk but recovers automatically most days
**Phase:** Phase 4 (Scraper hardening)
**Confidence:** HIGH

### Pitfall 8: Orderbird CSV schema drift (column rename, new delimiter)
**What goes wrong:** Orderbird ships a UI update; CSV gains a column, renames `Umsatz` to `Bruttoumsatz`, switches decimal separator `,` → `.`, or swaps delimiter `;` → `,`. pandas throws `KeyError` and the scraper falls over.
**Warning signs:** GHA fails on `pandas.read_csv` or column access; schema hash of first row changes.
**Prevention:**
- Compute and log a `hashlib.sha256` of the CSV header row every run; alert on change
- Preserve full row as `raw jsonb` in `stg_orderbird_tx` (already in architecture) so replay after fix is possible
- Pin pandas column access via a single `COLUMN_MAP` dict at the top of the scraper; fix = update one dict
- Add a "schema sentinel" test fixture: checked-in tiny CSV, assert scraper parses it — fails CI when `COLUMN_MAP` drifts from fixture
**Phase:** Phase 4
**Confidence:** MEDIUM (Orderbird-specific behavior inferred from generic POS CSV patterns)

### Pitfall 9: Voids, refunds, tips, tax-inclusive mishandled in revenue math
**What goes wrong:** Orderbird CSV (like most EU POS) exports:
- **Voids** (canceled orders) — either excluded or marked with `status=voided`; if included as positive, revenue is inflated
- **Refunds** — negative rows; if filtered out, revenue is inflated; if summed wrong, double-subtracted
- **Tips (Trinkgeld)** — may or may not be in the "total" field; if included, ticket totals exaggerate food revenue
- **Tax-inclusive (`brutto`) vs tax-exclusive (`netto`)** — EU POS commonly exports gross (VAT-inclusive) by default; comparing to US-style net figures breaks
- **Service charge** vs tip — different in DE
All of these silently change "revenue" by 5–20%.
**Warning signs:** Revenue number differs from what the owner quotes; negative rows in `gross_cents`; suspiciously round tip totals.
**Prevention:**
- Explicit schema: `gross_cents` (brutto, incl VAT, excl tip), `net_cents` (netto, excl VAT, excl tip), `tip_cents`, `refund_cents`, `voided bool`
- Default every KPI to `gross_cents WHERE NOT voided` and document it in the card tooltip ("Gross revenue, VAT included, tips excluded")
- Sit with the friend in week 1 and **read 20 CSV rows together** — confirm field semantics before writing SQL
- Unit test: seed a void + refund + tipped order and assert the reported revenue matches hand-calculated expected
**Phase:** Phase 1 (schema), Phase 2 (SQL) — verify with real data sample before writing MVs
**Confidence:** MEDIUM (inferred from EU POS conventions; confirm with actual CSV in week 1)

### Pitfall 10: Mobile chart illegibility (too many series, tooltip-on-hover)
**What goes wrong:** Cohort retention chart with 12 weekly cohorts = 12 overlapping lines on a 375px viewport. Legend eats half the screen. Tooltip requires hover which doesn't exist on touch. Chart looks "professional" to the analyst, unreadable to the owner.
**Warning signs:** Any chart with >4 series; any tooltip code path that relies on `mouseover` without `touchstart`; axis labels <14px.
**Prevention:**
- Hard cap: 4 series per chart. If more cohorts, show top 2 + bottom 2 + "avg of rest" line.
- Test every chart at 375px width in Chrome DevTools mobile mode **before** merging
- Use direct labels on chart end points, not a separate legend
- LayerChart `Tooltip` with `on:click` / touch trigger, not hover
- Contrast check: min 14px axis labels; no color-only encoding (arrows + numbers for up/down)
**Phase:** Phase 3 (UI) — applies to every chart shipped
**Confidence:** HIGH

### Pitfall 11: Free-tier landmines (Supabase 500MB, pg_cron limits, GHA minutes)
**What goes wrong:**
- **Supabase 500MB** — `stg_orderbird_tx.raw jsonb` for 3 years of data + MVs + insights can hit 400MB fast with `raw` duplicated across staging and normalized
- **pg_cron on free tier** — works but jobs share a connection pool; long MV refresh can stall other Supabase features
- **CF Pages builds: 500/mo** — a commit-per-tweak workflow blows through that in 2 weeks
- **GHA minutes: free unlimited for public repos, ~2000/mo private** — if the repo goes private pre-launch, 2min daily scraper + CI runs + preview deploys can squeeze
- **Supabase Edge Functions: 500K/month** — nightly × 1 tenant is nothing; OK for v1 but watch when multi-tenant
**Warning signs:** Supabase dashboard shows >80% storage; CF build quota warning email; GHA "minutes remaining" low.
**Prevention:**
- Schedule monthly `DELETE FROM stg_orderbird_tx WHERE ingested_at < now() - interval '30 days'` (raw replayable from Orderbird if needed)
- Keep `raw jsonb` compact: exclude fields you'll never replay (e.g., raw UI metadata)
- CF Pages: use branch-based preview only for PRs, not every commit; main deploy only on merge
- Keep repo **public** until multi-tenant ships — solves GHA minutes automatically and aligns with "forkable" goal
- Budget check at each milestone: Supabase storage %, pg_cron p95 duration, CF build count
**Phase:** Phase 1 (setup); revisit at each milestone
**Confidence:** HIGH

### Pitfall 12: Claude API cost blowup / rate limits
**What goes wrong:** Dev loop iterates on the insights prompt → 200 calls/day at `sonnet-4.5` rates → unexpected $30 bill. Or: "let's call Claude from the frontend for chat" PR slips in, rate limits hit, users see errors.
**Warning signs:** Anthropic usage dashboard ticking up; any `fetch('anthropic')` call in `src/` (should be in Edge Function only).
**Prevention:**
- Default model: **Haiku 4**, not Sonnet — 10× cheaper, plenty for one-sentence phrasing
- Hard-coded monthly budget in Edge Function: check a `llm_spend_month` counter, abort if exceeded
- Cache the narrative by `(restaurant_id, date)` — only regenerate on MV refresh, not on page load
- CI grep: `fetch.*anthropic` outside `supabase/functions/` = fail
- Dev iteration uses **cached responses** fixture during prompt tuning, not live API
**Phase:** Phase 3 (Narrative insights)
**Confidence:** HIGH

### Pitfall 13: `REFRESH MATERIALIZED VIEW` without CONCURRENTLY
**What goes wrong:** Already in ARCHITECTURE.md anti-patterns. `ACCESS EXCLUSIVE` lock blocks readers during refresh. Dashboard hangs at 3am, fine; but if pg_cron shifts due to DST or retry, it blocks during daytime.
**Warning signs:** Supabase query logs show `AccessExclusiveLock` on `cohort_mv`; dashboard stalls at MV-refresh window.
**Prevention:** Enforce `UNIQUE INDEX` creation in the **same migration** as the MV. Refresh statement always `CONCURRENTLY`. Add a SQL lint test: grep migrations for `REFRESH MATERIALIZED VIEW` lines and require `CONCURRENTLY` on each.
**Phase:** Phase 2
**Confidence:** HIGH

### Pitfall 14: JWT claim injection / missing claim
**What goes wrong:** Custom access token hook (`add_restaurant_claim`) has a bug, logged-in user's JWT lacks `restaurant_id`, all `_v` views return 0 rows (best case) or — if RLS policy has a typo — return *all* rows (worst case).
**Warning signs:** New user logs in, dashboard is empty; RLS policy uses `coalesce(... , true)` or any permissive fallback.
**Prevention:**
- `+layout.server.ts` checks the claim at every request and redirects to a "not provisioned" page if null
- RLS policies never use `coalesce` or `OR true` patterns; missing claim = zero rows by design
- CI test: user with no membership row sees exactly 0 rows in every `_v` view
- Test: user with spoofed `restaurant_id` in cookie (not signed) sees 0 rows (proves JWT is trusted, not cookie)
**Phase:** Phase 1
**Confidence:** HIGH

---

## Minor Pitfalls (Annoyances, Fast to Fix)

### Pitfall 15: `getSession()` used instead of `getUser()` on server
**What goes wrong:** Supabase docs warn: `getSession()` trusts the cookie without revalidating. Tampered cookie passes.
**Prevention:** Grep CI: `getSession` in `+*.server.ts` files = fail. Always `getUser()` or `getClaims()`.
**Phase:** Phase 1
**Confidence:** HIGH

### Pitfall 16: `generate_series` timezone trap for filling empty date buckets
**What goes wrong:** `generate_series(date '2026-01-01', date '2026-02-01', '1 day')` in UTC — when joined to `business_date` in Berlin TZ, boundaries misalign.
**Prevention:** Generate series in the restaurant's TZ: `generate_series((start AT TIME ZONE tz)::date, (end AT TIME ZONE tz)::date, '1 day')`.
**Phase:** Phase 2
**Confidence:** MEDIUM

### Pitfall 17: Multi-currency assumption break
**What goes wrong:** Orderbird supports EUR; if a restaurant uses CHF or does multi-currency sales (tourists paying in USD), revenue math concatenates currencies.
**Prevention:** v1 assumes single-currency per restaurant; add `currency` column to `restaurants` and assert at ingest. Fail loudly on unexpected currency. Defer multi-currency to v2+.
**Phase:** Phase 1 (schema)
**Confidence:** MEDIUM

### Pitfall 18: "Last updated" timestamp is server-side, not data-side
**What goes wrong:** Timestamp shows "6h ago" because the page rendered 6h ago (CF cache), not because data is 6h old. Owner trusts a lie.
**Prevention:** `kpi_daily_v` exposes `MAX(ingested_at)` as a column; render "Updated Xh ago" from that, not from page render time.
**Phase:** Phase 3
**Confidence:** HIGH

### Pitfall 19: DST transition double-counts / zero-counts an hour
**What goes wrong:** Spring DST = 02:00 → 03:00, no sales in that hour (zero-count). Fall DST = 03:00 → 02:00, sales appear twice if joined by hour-of-day.
**Prevention:** Daily and weekly rollups are safe; hour-of-day heatmap (P2) must use `occurred_at AT TIME ZONE tz` and render the "missing" hour as N/A, not zero. Document in the heatmap card.
**Phase:** Phase 3 (heatmap, P2)
**Confidence:** MEDIUM

### Pitfall 20: Forkability promise broken by hardcoded config
**What goes wrong:** `restaurant_id`, Supabase URL, Anthropic endpoint hardcoded in Svelte files. A forker has to grep-replace across the codebase.
**Prevention:** Every environment-dependent value comes from `$env/static/private` or `$env/static/public`. One `.env.example` file. README explains three commands to fork + deploy.
**Phase:** Phase 5 (Forkability hardening, late)
**Confidence:** HIGH

---

## Category-Specific Pitfalls (Scope & Process)

### Pitfall 21: Founder scope creep — "banking analyst builds for themselves"
**Category:** Project management / founder psychology
**What goes wrong:** Founder's analyst reflexes fire: "what if we add a segment filter", "we need a SQL REPL", "let me build a cohort triangle because that's how I'd view it", "the prompt should let Claude propose hypotheses". Each is 2–8 hours; the 2-week MVP is toast. Friend ends up with a dashboard the *analyst* would love, not a screen the *owner* would open.
**Warning signs:**
- Any feature appearing in code that's not in FEATURES.md P1 list
- Git commits touching `+page.svelte` files in Week 1 before ingestion is working
- "Quick refactor" of the cohort SQL that expands it
- Founder iterating on prompts before KPIs render
- New entries in FEATURES.md MVP without corresponding entries removed
**Prevention:**
- **FEATURES.md P1 is the contract.** Anything not on it is post-MVP, period.
- Weekly check-in against the "Add After Validation" list: if it's there, it's explicitly not now
- **Show the friend a clickable KPI screen before writing any cohort SQL** — forces user feedback to drive priority, not analyst instinct
- Delete-first refactor rule: before adding a view, delete an unused one
- Keep a "cutting room" list in PROJECT.md for things the founder wants to build — defer, don't debate
**Phase:** Every phase, every milestone
**Confidence:** HIGH

### Pitfall 22: Over-modeling the schema before seeing real data
**Category:** Data engineering
**What goes wrong:** Founder designs `dim_customer`, `dim_restaurant`, `dim_channel`, `dim_payment_method`, `fact_transaction`, `bridge_customer_visit` — a 6-table star schema — before loading a single CSV row. Reality: Orderbird CSV has ~15 columns and the product needs 1 fact table + 4 MVs.
**Warning signs:** Schema migration adding a `dim_*` or `bridge_*` table; more than one foreign key on `transactions`; ER diagram exists before scraper runs.
**Prevention:**
- **Rule: one fact table (`transactions`) + one staging table (`stg_orderbird_tx`) + four MVs. That's it for v1.**
- Add dims only when (a) the same string appears in 10k+ rows AND (b) querying it is slow
- Load one real CSV before writing migration #2
**Phase:** Phase 1
**Confidence:** HIGH

### Pitfall 23: Dashboard-for-self vs dashboard-for-user
**Category:** UX / product
**What goes wrong:** Founder builds a filter bar, a cohort triangle, a SQL export, and a "compare any two date ranges" panel — all things a *banking analyst* wants. Friend opens it on the phone once, sees complexity, never opens again.
**Warning signs:** Any UI element with >1 dropdown in v1; SQL visible anywhere in the UI; the friend's reaction to a mockup is "what does this mean?"
**Prevention:**
- **Test every screen against the non-technical friend weekly.** If they can't explain what a card means in one sentence, it's wrong.
- One filter global: date range presets (7/30/90). No custom picker in v1.
- No "advanced" / "expert" / "analyst mode" toggles
- The friend's screen recording is the acceptance test, not the analyst's SQL
**Phase:** Phase 3 (UI) and every phase with UI
**Confidence:** HIGH

### Pitfall 24: Playwright captcha / bot detection
**Category:** Scraper resilience
**What goes wrong:** Orderbird's auth may front with Cloudflare Turnstile, hCaptcha, or bot detection. Playwright gets flagged after N login attempts.
**Warning signs:** Sudden 403s from `my.orderbird.com`; `storageState` invalidation increases frequency; captcha challenge in page HTML.
**Prevention:**
- Persist `storageState` aggressively — login is the captcha risk surface
- Use `playwright-stealth` plugin if detection triggers
- Run from GHA (residential IPs rotate, but datacenter IPs might flag) — if blocked, switch to self-hosted runner or email-parse fallback
- **Backup path: Orderbird DATEV export email → IMAP parse** — already in PROJECT.md context as last-resort, worth having a Phase 4 spike
**Phase:** Phase 4
**Confidence:** MEDIUM

### Pitfall 25: Pre-mature multi-tenancy UX (onboarding, signup)
**Category:** Scope
**What goes wrong:** Founder builds onboarding flow for tenant #2 before tenant #1 has seen the product work. PROJECT.md explicitly lists this Out of Scope; temptation is real.
**Warning signs:** Any `+page.svelte` for signup/onboarding; any email template; any "create restaurant" button
**Prevention:** Out of Scope list in PROJECT.md is authoritative; tenant #2 is provisioned by running a SQL insert until V2.
**Phase:** Don't
**Confidence:** HIGH

---

## Phase-Specific Warnings

| Phase | Top 3 Pitfalls to Watch |
|-------|-------------------------|
| **Phase 1 — Foundation (schema, auth, RLS)** | #1 RLS-on-MV leak, #14 JWT claim missing, #3 Timezone day-boundary, #22 Over-modeling |
| **Phase 2 — Analytics SQL (MVs)** | #2 Cohort survivorship, #6 Window off-by-one, #9 Voids/refunds/tips math, #13 Missing CONCURRENTLY |
| **Phase 3 — UI (SvelteKit + charts)** | #10 Mobile chart illegibility, #23 Dashboard-for-self, #18 Stale "last updated" lie |
| **Phase 4 — Scraper hardening** | #7 StorageState expiry silent, #8 CSV schema drift, #24 Captcha / bot detection |
| **Phase 5 — Narrative insights (Claude)** | #4 LLM hallucination on numbers, #12 Cost blowup, #20 Forkability config leaks |
| **Every phase** | #21 Founder scope creep, #11 Free-tier quota drift |

---

## Anti-Patterns Summary (one-liners)

- Never `REFRESH MATERIALIZED VIEW` without `CONCURRENTLY` + unique index
- Never query `*_mv` directly from SvelteKit; go through `*_v` wrapper
- Never `getSession()` on the server; always `getUser()`
- Never trust tenant_id from client; always from signed JWT claim
- Never let Claude compute a number; only phrase given numbers
- Never join `card_hash` to PII; it voids the "no PII" promise
- Never show LTV for a cohort younger than max-observable horizon
- Never build features beyond FEATURES.md P1 before validating with the friend
- Never hardcode config; fork-ability is a day-1 requirement
- Never `date_trunc('day', ...)` without `AT TIME ZONE`

---

## Detection Automation (CI-Enforceable)

These checks prevent multiple critical pitfalls at once. Add to CI from Phase 1:

```bash
# Pitfall #1, #5 — no raw MV access, no PII joins
grep -rE '_mv\b' src/ && exit 1
grep -rE 'card_hash.*(email|phone|name)' migrations/ && exit 1

# Pitfall #4, #12 — Claude never from client, never Sonnet by default
grep -r 'anthropic' src/ && exit 1
grep -r 'claude-sonnet' supabase/functions/ && exit 1

# Pitfall #13 — CONCURRENTLY mandatory
grep -r 'REFRESH MATERIALIZED VIEW' migrations/ | grep -v CONCURRENTLY && exit 1

# Pitfall #15 — no getSession on server
grep -rn 'getSession' src/ | grep 'server' && exit 1

# Pitfall #3 — SQL day-truncation must include AT TIME ZONE
grep -rE "date_trunc\('day'" migrations/ | grep -v 'AT TIME ZONE' && exit 1
```

Plus a **two-tenant RLS integration test** seeded in the test DB: user A can never see user B's rows in any `_v` view, enforced in CI before every merge. This single test catches pitfalls #1, #14, and every future tenancy bug.

---

## Sources

- ARCHITECTURE.md (sibling) — RLS/MV wrapper pattern, idempotency, anti-patterns
- STACK.md (sibling) — stack-specific gotchas (CF Workers runtime, Supabase SSR, pg_cron)
- FEATURES.md (sibling) — anti-features list drives scope-creep prevention
- Supabase discussions #17790 (RLS on MVs) — HIGH
- Supabase `@supabase/ssr` auth docs — `getUser()` vs `getSession()` trust boundary
- Anthropic Claude API docs — Haiku pricing, rate limits
- GDPR restaurant payment data guidance — card-hash + no-PII boundary
- EU POS CSV conventions (brutto/netto, VAT, Trinkgeld) — MEDIUM; confirm in week 1 with real CSV
- Postgres docs — `REFRESH MATERIALIZED VIEW CONCURRENTLY`, `date_trunc AT TIME ZONE`
- PROJECT.md — constraints, Out of Scope, founder context

---
*Pitfalls research for: restaurant POS analytics (Orderbird → Supabase → SvelteKit/CF)*
*Researched: 2026-04-13*
