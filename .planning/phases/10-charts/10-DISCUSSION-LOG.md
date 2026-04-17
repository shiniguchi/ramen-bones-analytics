# Phase 10: Charts - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-17
**Phase:** 10-charts
**Areas discussed:** Data layer architecture, Visit-count bucket encoding, Chart order + density, LTV-per-customer shape, Order items plumbing, Cohort vs global grain
**Mode:** auto-recs (user said "I follow your recs first for all questions")

---

## Pre-flight: Scope confirmation

| Option | Description | Selected |
|--------|-------------|----------|
| 7-chart scope (current roadmap) | VA-04..VA-10 — calendar revenue, calendar counts, retention, LTV distribution, item counts, cohort revenue, cohort avg LTV | ✓ |
| 3-chart scope (original 2026-04-16 plan) | Drop VA-07/08/09/10; ship only calendar revenue, calendar counts, retention | |

**User's choice:** 7-chart scope. User said "you know which charts I want" — confirmed roadmap is correct.
**Notes:** MEMORY.md's stale "only 3 charts for now" note captured earlier in the milestone; user now wants the full 7-chart set.

---

## Gray Area 1: Data Layer Architecture

| Option | Description | Selected |
|--------|-------------|----------|
| Pure client-side | Extend `transactions_filterable_v` with visit_seq + item_name; all 7 charts compute client-side from raw rows | |
| Pure MV-backed | Add rollup MVs for all 7 charts; SSR returns pre-aggregated data | |
| Hybrid (calendar = client, cohort = MV) | Extend filterable_v with visit_seq for calendar charts; new wrapper views for cohort/LTV/items | ✓ |

**User's choice (auto):** Hybrid.
**Notes:** Calendar charts need <200ms toggle response (Phase 9 VA-12) → client-side rebucketing. Cohort charts aggregate across full customer history → MVs. `customer_ltv_v` elegantly feeds VA-07 + VA-09 + VA-10 from one view.

---

## Gray Area 2: Visit-count bucket encoding

| Option | Description | Selected |
|--------|-------------|----------|
| 8 buckets, sequential color scale | 1st..8x+ with light→dark blue gradient | ✓ |
| 8 buckets, categorical palette | Distinct colors per bucket | |
| Collapsed to 5-6 buckets | e.g. 1st / 2nd / 3rd / 4-5x / 6-8x / 9+ | |
| 9th "Cash" segment in neutral gray | Cash (visit_seq IS NULL) rendered as gray stacked below card buckets | ✓ |
| Compact gradient legend below chart | Horizontal gradient scale + "Cash" swatch | ✓ |
| Per-segment labels in vertical legend | 1 label per color swatch | |

**User's choice (auto):** 8 buckets + sequential scale + cash 9th segment + compact gradient legend.
**Notes:** Roadmap specifies 8 buckets literally. Sequential scale visually reinforces loyalty gradient. Cash-as-9th mirrors Phase 4 D-19 pattern.

---

## Gray Area 3: Chart order + density

| Option | Description | Selected |
|--------|-------------|----------|
| Linear scroll, no nav | Single column, all cards visible on scroll | ✓ |
| Tabs (Revenue / Customers / Cohorts) | Grouped surface | |
| Accordion | Collapsed-by-default cards | |
| Lazy-mount below fold | First paint renders top 6 cards eagerly; rest mount on scroll | ✓ (as planner stretch) |

**User's choice (auto):** Linear scroll + lazy-mount (optional, planner decides if needed).
**Notes:** Matches Phase 4 D-01 "single column card stream" lock. Order: KPIs → Insight → 3 calendar charts → Retention → 2 cohort charts → LTV histogram. Calendar first = daily-check signal; LTV histogram last = retrospective.

---

## Gray Area 4: LTV per customer (VA-07) shape

| Option | Description | Selected |
|--------|-------------|----------|
| Histogram of per-customer revenue, 6 bins | €0-10 / €10-25 / €25-50 / €50-100 / €100-250 / €250+ | ✓ |
| One bar per customer | Unreadable for 1000+ customers | |
| Bucketed by visit_seq | Duplicates VA-04/05 + VA-09/10 info | |
| Scatter plot of revenue × visit count | Niche read, harder on 375px | |

**User's choice (auto):** 6-bin histogram.
**Notes:** Shows distribution shape — the growth-analyst question. Bins live in `src/lib/ltvBins.ts` as UI constants (Phase 4 D-14 pattern: SQL honest, UI pragmatic).

---

## Gray Area 5: Order items (VA-08) plumbing

| Option | Description | Selected |
|--------|-------------|----------|
| New MV `item_counts_daily_mv` + wrapper | Aggregates stg_orderbird_order_items by (date, item_name, sales_type, is_cash) | ✓ |
| Inline query on staging table | Heavy per-request; no RLS tenant wrapper yet | |
| Top-8 items + "Other" rollup, client-side | Top selection in-window; rest folded | ✓ |
| Show all items | 50+ colors at 375px unreadable | |
| Count order_items | "bowls sold" semantic | ✓ |
| Sum gross by item | Duplicates VA-04 story | |
| Categorical 8-color palette | Items are unordered categories | ✓ |
| Sequential scale | Doesn't match categorical data | |

**User's choice (auto):** MV-backed + top-8 + "Other" + count metric + categorical palette.
**Notes:** Top-8 mirrors 8 visit-count buckets for consistency. `d3-scale-chromatic.schemeTableau10` sliced to 8.

---

## Gray Area 6: Cohort grain vs global grain

| Option | Description | Selected |
|--------|-------------|----------|
| Global grain clamps to weekly for cohort charts | Day-grain → show "Cohort view: weekly" hint, render weekly | ✓ |
| Per-card grain toggle on cohort charts | Reverses Phase 9 D-14 "global grain" lock | |
| Disable cohort charts when grain=day | Breaks dashboard — 1/3 of charts vanish | |

**User's choice (auto):** Global grain clamps for cohort charts.
**Notes:** Preserves Phase 9 D-14 single global toggle. Smaller UX mutation than per-card toggle.

---

## Claude's Discretion (handed to planner)

- LayerChart primitive for stacked bars (BarStack vs manual Rect)
- Individual chart component file names + test structure
- Shared `CalendarChart.svelte` abstraction (VA-04/05/08 share pattern) vs 3 siblings
- Exact hex values for sequential and categorical palettes
- Unit-of-measure y-axis labels (€ vs count)
- MV refresh cost measurement — if >30s, swap `customer_ltv_mv` to regular view
- Migration numbering / splitting (e.g., 0023/0024/0025 vs combined)
- 90d+ daily-grain clamp (D-22) — planner decides hard clamp vs trust-user

## Deferred Ideas (captured for future phases / backlog)

- Revenue-by-item view (separate from VA-08 count)
- Individual customer drill-down from LTV histogram
- Per-card grain toggles
- Hourly / day-of-week heatmap (v2 ADV-01)
- At-risk customer list (v2 ADV-02)
- Segment chips (v2 ADV-03)
- Menu-item cohort analysis (v2 ADV-04)
- Custom mobile date-range picker (out of scope)
- Chart export (PDF/CSV, rejected)
- 12-month LTV projection (rejected)
- Cohort triangle / heatmap (rejected, unreadable at 375px)
