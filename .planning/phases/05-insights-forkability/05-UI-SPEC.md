---
phase: 5
slug: insights-forkability
status: draft
shadcn_initialized: true
preset: shadcn-svelte@next (zinc base) — inherited from Phase 4 (components.json)
created: 2026-04-15
inherits_from: .planning/phases/04-mobile-reader-ui/04-UI-SPEC.md
---

# Phase 5 — UI Design Contract

> Visual and interaction contract for the nightly Claude Haiku insight card and forkability surface. **Inherits 100% of the Phase 4 design contract** — this document only declares DELTAS and NEW elements. For all spacing, typography, color, icon, font, and accessibility rules not listed below, Phase 4's `04-UI-SPEC.md` is the source of truth.
>
> Requirements covered: INS-01, INS-02, INS-03, INS-04, INS-05, INS-06 (visual surfaces only; backend pipeline specified in `05-CONTEXT.md` and `05-RESEARCH.md`).

**New UI surfaces in this phase:**
1. `InsightCard.svelte` — new tenth card, prepended to the card stream (above the three fixed revenue tiles).
2. `README.md` + `.env.example` + `LICENSE` — forkability docs, no runtime UI.

**No new in-app "forkability surface" UI** — no footer repo link, no self-host banner, no "last updated" badge beyond the existing `FreshnessLabel`. Forkability is pure docs per CONTEXT.md D-17..D-20. The visual surface of this phase is **exactly one new component**: `InsightCard.svelte`.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | shadcn-svelte `@next` (inherited from Phase 4; `components.json` already committed) |
| Preset | Tailwind v4 + Svelte 5 + `data-slot`, base color `zinc` |
| Component library | shadcn-svelte primitives — **no new blocks required for this phase** (`card` already installed) |
| Icon library | `lucide-svelte` — **no new icons in this phase** (no icons inside InsightCard per D-02) |
| Font | System font stack (inherited) |
| Theme | Light only (inherited) — dark mode still deferred |

**Inheritance verdict:** Phase 5 introduces ZERO new design tokens, ZERO new colors, ZERO new font sizes, ZERO new spacing values, ZERO new shadcn blocks. This is deliberate per CONTEXT.md D-04 and the "Reusable Assets" section of CONTEXT.md code_context.

---

## Spacing Scale

**No deltas.** Phase 4's 8-point Tailwind scale applies verbatim.

**InsightCard specifics:**
- Outer padding: `p-4` (16px, matches all other cards)
- Gap between headline and body: `mt-2` (8px)
- Gap between body and "auto-generated" chip (when shown): `mt-3` (12px — falls on 4-multiple via Tailwind default)
- Gap between "From yesterday" label and headline (fallback mode): `mb-1` (4px)
- Card-to-next-card vertical gap: `gap-6` (inherited from card stream flex container)

---

## Typography

**No new roles.** Reuses Phase 4's 4 roles verbatim.

| Role used by InsightCard | Size | Weight | Line Height | Tailwind | Usage in InsightCard |
|---------------------------|------|--------|-------------|----------|----------------------|
| Caption | 12px | 400 | 1.4 | `text-xs leading-[1.4] font-normal` | "From yesterday" fallback label; "auto-generated" chip |
| Body | 14px | 400 | 1.5 | `text-sm leading-normal font-normal` | Insight body copy (2–3 sentences) |
| Heading | 20px | 600 | 1.2 | `text-xl leading-tight font-semibold` | Insight headline (one line, wraps to max 2 lines at 375px) |
| Display | 32px | — | — | — | **NOT USED** in InsightCard (no big numbers; per D-02 text-only card) |

**Rules specific to InsightCard:**
- Headline uses `text-zinc-900` (primary text), wraps naturally; no truncation, no ellipsis. Let 2-line wrap happen if Haiku writes a long headline — the component has no `line-clamp`.
- Body uses `text-zinc-700` — slightly darker than Phase 4's `text-zinc-500` muted text, because this is primary reading content, not a caption. Rationale: 2–3 sentences at `zinc-500` would feel washed out. `zinc-700` on `white` = 10.3:1 contrast, exceeds WCAG AAA.
- No `tabular-nums` on InsightCard text — this is prose, not tabular numbers. Numbers that appear in the body flow with normal kerning.
- No italic anywhere in InsightCard (italic is reserved exclusively for the LTV data-depth footer per Phase 4).
- Headline has no trailing period. Body sentences end with `.` normally.

---

## Color

**No new tokens.** Full palette inherited from Phase 4.

| Role used | Tailwind | Usage in InsightCard |
|-----------|----------|----------------------|
| Card surface | `bg-white` | InsightCard background (matches all other cards) |
| Card border | `border border-zinc-200` | 1px border (matches all other cards) |
| Card radius | `rounded-xl` (12px) | Matches all other cards |
| Primary text | `text-zinc-900` | Headline |
| Body text | `text-zinc-700` | Body copy (new usage of an existing zinc step; no new token) |
| Muted text | `text-zinc-500` | "From yesterday" label, "auto-generated" chip |
| Accent | `text-blue-600` | **NOT USED** in InsightCard — no links, no CTAs, no focus rings (card is not interactive) |

**Accent reserved-for list (unchanged from Phase 4):** active chip background, `/login` Sign in button, focus ring on interactive elements, active grain toggle segment. **InsightCard adds nothing to this list** — the card is purely passive/read-only.

**No destructive color, no success color, no warning color** used in InsightCard. Insight body may describe negative trends ("revenue slipped 18%") but the TEXT stays `zinc-700` — no red/green semantic coloring on prose (would imply editorializing, violates the D-06 "neutral news headline" voice).

---

## Copywriting Contract

### Insight Card — visible UI copy (static labels only)

The card's HEADLINE and BODY are LLM-generated at runtime or deterministic-template-generated in fallback mode. The LLM copy contract lives in the Voice & Prompt Rules section below. This table covers ONLY the static chrome.

| Element | Copy | Notes |
|---------|------|-------|
| "From yesterday" fallback label | `From yesterday` | Rendered only when today's row is missing and the most-recent row is shown. Caption role, `text-zinc-500`. No icon. Plain text. |
| "Auto-generated" fallback chip | `auto-generated` | Rendered only when `fallback_used = true` (digit-guard rejected LLM or API error). Lowercase. Caption role, `text-zinc-500`. No background, no border — inline muted text with a leading `· ` separator: `· auto-generated`. Alternative layout allowed: small uppercase-tracked chip `bg-zinc-100 text-zinc-500 text-[10px] px-2 py-0.5 rounded-full` — planner picks one and the checker accepts either as long as the literal word `auto-generated` appears and color is `zinc-500`. |
| Empty state | **(none)** | Per CONTEXT.md D-03 + INS-03, the card is HIDDEN entirely when no row exists. No empty-state copy, no placeholder, no skeleton. `{#if latestInsight}` wrapper in `+page.svelte`. |
| Error state | **(none visible)** | Per CONTEXT.md D-22 inheritance: if `insights_v` query errors, the card hides silently and the error logs server-side. No "Couldn't load" rendering for this specific card — an insight is non-critical, silent-hide is preferable to showing "Couldn't load" above the revenue tiles. This is a DELTA from Phase 4's card-level error state. |

**Why no error card:** Phase 4 cards use `Couldn't load / Try refreshing` because missing a KPI is user-visible broken. An insight card is supplementary — a failed fetch should degrade gracefully to "no insight today" rather than shouting an error above the numbers. Server-side `console.error` captures the failure for ops.

### LLM Voice & Prompt Rules (consumed by `supabase/functions/generate-insight/prompt.ts`)

These rules are the copywriting contract for Claude Haiku. The planner MUST encode them in the system prompt.

**Voice:** Neutral news-headline. Terse financial reporter. Dry precision. CONTEXT.md D-06. **Do not soften.**

**Allowed tone examples:**
- `Weekend traffic slipped 18%`
- `Repeat customers drove 62% of the week's spend`
- `Revenue held at €4,280 — flat vs prior 7 days`
- `Saturday was the slowest day in 4 weeks`

**Forbidden phrasings** (the system prompt must explicitly reject these):

| Category | Forbidden | Reason |
|----------|-----------|--------|
| Cheerleading | `Great job!`, `Awesome week!`, `You're crushing it`, `Keep it up` | Violates D-06 dry voice |
| Coaching / advice | `You should`, `Consider`, `Try`, `Make sure to`, `Remember to` | Not a coach — just report facts (D-06) |
| Questions | `Did you know that…?`, `Why not…?` | Not interactive |
| Hedging | `It seems`, `Perhaps`, `Maybe`, `Could be`, `Likely` | Banking-analyst framing wants certainty or nothing |
| Emojis / decoration | Any emoji, any `!!`, any ALL CAPS words | Mobile reader, serious tone |
| Rounding hedges | `about`, `around`, `roughly`, `approximately`, `~`, `≈` | Digit-guard (D-11) forbids unrounded invention; the prompt forbids ROUNDED invention too so Haiku doesn't try to smooth numbers |
| Time inventions | `next week`, `going forward`, `projected`, `forecast`, `expected` | No forecasting in v1 (PROJECT.md out-of-scope) |
| Competitor / benchmark | `industry average`, `competitors`, `benchmark` | No such data in payload |
| Greetings / signoffs | `Good morning`, `Hello`, `Today:`, `— Claude`, `Here's your…` | Card is not a letter |

**Length rules:**
- `headline`: 1 sentence, max 80 characters, no trailing period, no colons except inside numbers
- `body`: 2 to 3 sentences, max 280 characters total (tweet-sized cap), each sentence ends with a period
- Both fields are REQUIRED and NON-EMPTY strings; empty string triggers fallback

**Number rules** (soft guard — the hard guard is D-11 digit-guard regex):
- Every numeric token in the output must appear verbatim in the flattened `input_payload` JSON
- No rounding (`€4,280` not `€4.3k`, `18%` not `~20%`)
- Currency symbol `€` always prefixes revenue numbers, no trailing `EUR`
- Percentages always written `N%` (no space, no `percent`)
- Deltas written with Unicode up-arrow `▲` or down-arrow `▼` (matches Phase 4 delta caption convention) OR written as plain words (`slipped`, `rose`, `held`) — planner picks; both OK as long as the raw digit matches the payload

### Deterministic Fallback Template (D-12)

When the digit-guard rejects Haiku's output OR the Anthropic call errors OR JSON parse fails, the Edge Function writes a row with these exact strings. All `{placeholders}` are substituted from the input payload — the template is 100% payload-sourced, so it passes the digit-guard by construction.

```
headline: Revenue €{today_revenue_int} today {today_delta_glyph} {today_delta_pct}% vs last week
body:    Week-to-date revenue is €{7d_revenue_int} ({7d_delta_glyph} {7d_delta_pct}% vs prior 7d). {returning_pct}% of this week's spend came from returning customers.
```

**Placeholder rules:**
- `{*_revenue_int}` — integer euros, thousands separator `,` (Tailwind formatting match)
- `{*_delta_glyph}` — `▲` if positive, `▼` if negative, `—` if flat (|pct| < 1)
- `{*_delta_pct}` — integer, absolute value, no sign (sign carried by glyph)
- `{returning_pct}` — integer percentage from `new_vs_returning_v` 7d window: `returning / (new + returning + cash)`

**Edge cases:**
- If `7d_delta` has no prior data: substitute body with `Week-to-date revenue is €{7d_revenue_int}. {returning_pct}% of this week's spend came from returning customers.` (drop the delta parenthetical)
- If `returning_pct` is 0 or undefined (no repeat customers yet): substitute second sentence with `No repeat customers in the last 7 days.`
- If `today_revenue` is 0: substitute headline with `No transactions recorded today — €{7d_revenue_int} over the prior 7 days.`

**`fallback_used` is always `true`** when this template fires, which triggers the `· auto-generated` chip per D-04.

### Destructive actions

**None.** InsightCard is read-only. No dismiss, no hide, no "regenerate" button (D-deferred: real-time regeneration). No confirmation flows added in this phase.

---

## Card Layout Spec

### InsightCard.svelte — normal mode

```
┌─────────────────────────────────────────┐
│                                         │  ← p-4 (16px) all sides
│  Weekend traffic slipped 18%      (20px)│  ← headline, text-xl font-semibold text-zinc-900
│                                         │  ← mt-2 (8px)
│  Saturday and Sunday transactions were  │  ← body, text-sm text-zinc-700 leading-normal
│  the lowest in 4 weeks, driving €620    │
│  below the prior weekend. Weekday       │
│  revenue held steady at €2,840.         │
│                                         │
└─────────────────────────────────────────┘
```

Tailwind class skeleton (illustrative, planner owns final form):
```svelte
<section class="rounded-xl border border-zinc-200 bg-white p-4">
  <h2 class="text-xl font-semibold leading-tight text-zinc-900">
    {latestInsight.headline}
  </h2>
  <p class="mt-2 text-sm leading-normal text-zinc-700">
    {latestInsight.body}
  </p>
</section>
```

### InsightCard.svelte — fallback mode (yesterday + auto-generated)

```
┌─────────────────────────────────────────┐
│  From yesterday                    (12px)│  ← caption, text-xs text-zinc-500
│  Revenue €4,280 today ▼ 8% vs last (20px)│  ← headline (template-filled)
│  week                                   │
│                                         │
│  Week-to-date revenue is €28,140    (14px)│  ← body (template-filled)
│  (▼ 6% vs prior 7d). 62% of this week's │
│  spend came from returning customers.   │
│                                         │
│  · auto-generated                   (12px)│  ← caption, text-xs text-zinc-500, mt-3
└─────────────────────────────────────────┘
```

### InsightCard.svelte — hidden state

```svelte
{#if latestInsight}
  <InsightCard insight={latestInsight} />
{/if}
```

No rendering at all when no row exists (INS-03). The card stream's `gap-6` collapses naturally — revenue tiles become the first visible card. No layout shift, no placeholder.

---

## Placement in Card Stream

**Revised card order** (delta from Phase 4 D-02 — prepends ONE card, rest of order unchanged per CONTEXT.md D-01):

1. **InsightCard** (new — this phase, top of fold, above the chip bar's "last updated" line)
2. Revenue · Today (fixed tile)
3. Revenue · 7d (fixed tile)
4. Revenue · 30d (fixed tile)
5. Transactions (chip-scoped)
6. Avg ticket (chip-scoped)
7. Cohort retention
8. LTV-to-date
9. Visit frequency
10. New vs returning

**Integration point:** `src/routes/+page.svelte` — add `{#if data.latestInsight}<InsightCard insight={data.latestInsight} />{/if}` as the first child of `<div class="flex flex-col gap-6">` inside `<main>`. Sticky chip bar and `FreshnessLabel` remain ABOVE `<main>` — InsightCard is inside `<main>`, as the first card.

**Scroll behavior:** InsightCard scrolls away with the rest of the stream (not sticky). Only the chip bar is sticky (unchanged from Phase 4).

---

## Interaction Contracts

**InsightCard has NO interactions.** Not tappable, not focusable, no tooltips, no expand/collapse, no "read more", no dismiss, no share, no copy-to-clipboard. It is a passive card that renders text.

- `role="article"` on the `<section>` (semantic: it IS a self-contained article).
- `<h2>` is the headline (matches other cards using `<h2>` for their title — preserves heading hierarchy).
- No `tabindex`, no `aria-label` beyond the natural heading.
- No focus ring (not interactive).
- No animations, no transitions. Card appears statically on SSR.

**Respects `prefers-reduced-motion`:** trivially, since there are no animations to suppress.

---

## Accessibility Contract

Inherited verbatim from Phase 4 (WCAG AA, 44px touch targets where applicable, semantic HTML, keyboard nav, reduced motion, aria-labels).

**InsightCard-specific checks:**
- `text-zinc-900` on `bg-white` = 16.1:1 (headline) — PASS AAA
- `text-zinc-700` on `bg-white` = 10.3:1 (body) — PASS AAA
- `text-zinc-500` on `bg-white` = 4.6:1 (fallback labels) — PASS AA for small text
- Headline is `<h2>` — preserves document outline, screen readers announce correctly
- Body is `<p>` — screen readers pause naturally between sentences
- "From yesterday" label and "auto-generated" chip are plain `<span>` with visible text — no aria-hidden, no icon-only affordance
- Card is NOT focusable — nothing interactive to focus, so no focus ring required
- No decorative images; no `alt` text needed

---

## Viewport Contract

Inherited verbatim from Phase 4: 375px baseline, single column, no horizontal scroll, `max-w-screen-sm` centered, PR screenshots at iPhone SE.

**InsightCard at 375px:**
- Available content width: `375 - 16(page px) - 16(page px) - 16(card p) - 16(card p) = 311px`
- Headline (20px, semibold) at 311px wraps roughly at 20–25 chars per line — a 60-char headline will wrap to 2–3 lines. Acceptable; no truncation.
- Body (14px) at 311px wraps roughly at 40–50 chars per line — a 280-char body wraps to 5–7 lines. Fits on fold above the first revenue tile on most phones.
- Total card height in normal mode ≈ 140–180px; fallback mode adds ~24px for the chip row. Still comfortable on a 667px iPhone SE viewport together with the sticky chip bar.

---

## Forkability Surfaces (non-UI)

Phase 5 ships three files with NO in-app visual rendering. They are called out here for completeness so the checker and planner know they exist and are in scope — but they do NOT require color/spacing/typography review.

| File | Content contract | Source of truth |
|------|------------------|-----------------|
| `README.md` | Numbered, copy-paste Phase 1 → Ship checklist (CONTEXT.md D-17). No marketing copy, no screenshots required for v1 (planner may add at discretion). Tone: technical, terse, same as existing Phase 1 forker quickstart. | CONTEXT.md D-17 |
| `.env.example` | Single file, sectioned `# --- destination: {cf pages / supabase secrets / github actions / local dev} ---` comment blocks. Every required env var documented with a one-line comment above it. | CONTEXT.md D-18 |
| `LICENSE` | MIT by default. Plain text, standard SPDX header, copyright holder = repo owner name (planner resolves). | CONTEXT.md D-20 |

**No in-app footer, no repo link in the header, no "self-host" banner, no "forked from" attribution widget.** These were considered and rejected: forkability is a docs concern, not a UI concern. The dashboard stays focused on the numbers (PROJECT.md core-value discipline).

---

## Component Inventory

| Component | Status | Path | Responsibility |
|-----------|--------|------|---------------|
| `InsightCard.svelte` | **NEW this phase** | `src/lib/components/InsightCard.svelte` | Renders the tenth card: headline + body (+ optional "from yesterday" label + optional "auto-generated" chip). Pure presentational — no data fetching, no state. Receives `insight: { headline, body, business_date, fallback_used, is_yesterday }` as props. |
| All 9 Phase 4 components | Unchanged | `src/lib/components/*.svelte` | No edits required. Phase 4 contract holds. |

**shadcn blocks installed (inherited — no new installs):** `button`, `card`, `input`, `label`, `toggle-group`, `tooltip`. InsightCard uses raw Tailwind classes on a `<section>` (matching how the existing KPI tiles render — they don't wrap shadcn `card` either). No new shadcn block required.

---

## URL & State Contract

**No deltas.** Phase 4's `?range=` and `?grain=` URL params are the only filter state. InsightCard is NOT filtered by either — the insight is always "the latest row for this tenant in `insights_v`", independent of the selected date range or cohort grain.

**Rationale:** Chip filters change the KPI windows, but the insight was generated at 03:15 Berlin against a fixed payload snapshot. Re-scoping the insight to match the chip would be a lie (the narrative text wouldn't match the new window). The insight is a daily artifact — it shows as-generated, period.

---

## Registry Safety

| Registry | Blocks Used in Phase 5 | Safety Gate |
|----------|------------------------|-------------|
| shadcn-svelte official (`https://shadcn-svelte.com`) | **none new** (card shape is hand-rolled Tailwind, matching KPI tile pattern from Phase 4) | not required |
| LayerChart (npm) | **none** (InsightCard is text-only per D-02) | not applicable |
| Anthropic `@anthropic-ai/sdk` (npm) | — | not a UI registry; backend-only; covered in RESEARCH.md §Pitfalls |

**No third-party registries declared.** No vetting gate required. If the executor proposes pulling a new shadcn block or a third-party component mid-implementation, it MUST re-invoke the ui-researcher vetting gate before merging.

---

## Deltas from Phase 4 — Explicit List

For the checker's convenience:

| # | Delta | Reason |
|---|-------|--------|
| 1 | New card order: InsightCard prepended as #1 | CONTEXT.md D-01 |
| 2 | New `text-zinc-700` usage for body prose (existing token, new role) | Prose needs AAA contrast, `zinc-500` too light for 14px body copy |
| 3 | New component `InsightCard.svelte` | INS-03 requires a card; D-02 specifies shape |
| 4 | New static labels: `From yesterday`, `auto-generated` | D-03, D-04 |
| 5 | New LLM voice rules & forbidden-phrase list | D-06, D-09 |
| 6 | New deterministic fallback template | D-12 |
| 7 | Card-level error state DIVERGES: silent hide instead of "Couldn't load" | InsightCard is non-critical supplementary content |
| 8 | InsightCard is non-interactive (no focus ring, no tap) | Passive read-only card |

**No deltas** to: spacing scale, font sizes, font weights, color palette, chart palette, chip/toggle interaction, FreshnessLabel, sticky header behavior, viewport baseline, accessibility contract, registry safety posture.

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS  (static chrome + LLM voice rules + fallback template all declared)
- [ ] Dimension 2 Visuals: PASS  (one new component, inherits card shape)
- [ ] Dimension 3 Color: PASS  (zero new tokens; one new usage of existing `zinc-700`)
- [ ] Dimension 4 Typography: PASS  (uses 3 of Phase 4's 4 roles; Display unused)
- [ ] Dimension 5 Spacing: PASS  (zero new values; all multiples of 4)
- [ ] Dimension 6 Registry Safety: PASS  (no new registries, no new blocks)

**Approval:** pending
