---
phase: 6
slug: filter-foundation
status: draft
shadcn_initialized: false
preset: manual (shadcn-svelte @next tokens hand-rolled in src/app.css)
created: 2026-04-15
---

# Phase 6 — UI Design Contract

> Visual and interaction contract for the shared filter bar that drives every v1.0 card through a single zod-validated SSR pipeline. Mobile-first 375px. Hand-rolled primitives matching the existing `src/lib/components/ui/` pattern (shadcn-svelte CLI is unreachable per 04-01).

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (shadcn-svelte CLI unreachable; hand-rolled primitives) |
| Preset | shadcn "new-york" style, Slate neutral, OKLCH tokens already declared in `src/app.css` |
| Component library | none — hand-rolled Svelte 5 runes components under `src/lib/components/ui/` |
| Icon library | `lucide-svelte` (already used by existing components; verify at install or hand-roll inline SVG if absent) |
| Font | System UI stack (Tailwind v4 default `font-sans`); no custom webfont |

**Existing primitives (reuse, do NOT re-implement):** `button.svelte`, `card.svelte`, `input.svelte`, `label.svelte`, `toggle-group.svelte`, `tooltip.svelte`.

**New primitives to hand-roll this phase:** `popover.svelte`, `sheet.svelte`, `checkbox.svelte`, `command.svelte` (minimal — list + checkbox items, no fuzzy search in v1). All match existing file conventions (Svelte 5 runes, `$props`, `class` merging via `cn()` helper, `data-slot` attributes).

---

## Spacing Scale

Declared values (Tailwind v4 default 4px grid — multiples of 4 only):

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px (`p-1`) | Icon-to-label gap inside buttons |
| sm | 8px (`p-2`, `gap-2`) | Compact element spacing inside filter bar |
| md | 12px (`px-3`, `py-3`) | Default control inner padding |
| lg | 16px (`p-4`, `gap-4`) | Sheet inner padding, section spacing |
| xl | 24px (`p-6`) | Sheet outer padding, section breaks |
| 2xl | 32px (`gap-8`) | Major vertical breaks inside Sheet |

**Exceptions:**
- **Touch target minimum: 44px** (`min-h-11` = 44px). Mandatory on every interactive control in the filter bar, popover, and sheet. Enforced per Phase 4 contract.
- **Sticky filter bar total height: ≤ 72px** (D-05). Budget: `py-2` (8px top + 8px bottom) + 2 lines of 44px controls stacked tightly = ~72px. If two-line layout exceeds budget, collapse to single-line and move grain toggle next to the date picker button.

---

## Typography

| Role | Size | Weight | Line Height | Usage |
|------|------|--------|-------------|-------|
| Label | 12px (`text-xs`) | 500 (medium) | 1.33 (`leading-tight`) | Secondary line under date picker button ("Apr 8 – Apr 15"), filter section labels inside Sheet |
| Body | 14px (`text-sm`) | 400 (regular) | 1.5 (`leading-normal`) | Dropdown option rows, checkbox labels, Sheet body copy, empty-state copy |
| Control | 14px (`text-sm`) | 500 (medium) | 1.2 (`leading-none`) | Button labels, grain toggle segments, preset buttons inside date popover |
| Heading | 16px (`text-base`) | 600 (semibold) | 1.25 (`leading-tight`) | Sheet title ("Filters"), popover title ("Select date range") |

**Exactly 2 font weights:** 400 (regular) + 500 (medium), with 600 (semibold) reserved ONLY for the Sheet/Popover heading role. Do not introduce additional weights.

---

## Color

Uses existing OKLCH tokens from `src/app.css` (shadcn "new-york" neutral Slate). Do NOT introduce new color variables this phase.

| Role | Token | Usage |
|------|-------|-------|
| Dominant (60%) | `--background` (white) / `--foreground` (near-black) | Page background, filter bar surface, Sheet body, popover body, default control text |
| Secondary (30%) | `--card`, `--secondary`, `--muted`, `--border`, `--muted-foreground` | Filter bar bottom-border, unselected control borders, inactive preset buttons, dropdown hover rows, label text |
| Accent (10%) | `--primary` (dark slate) and `--ring` for focus | Reserved-for list below |
| Destructive | `--destructive` | Not used this phase (no destructive actions — see Copywriting) |

**Accent (`--primary` / `--ring`) reserved for — explicit list, no others:**
1. Active (non-default) filter control border-tint (D-04) — 1px border in `--primary` at ~60% opacity, or `ring-1 ring-primary/60`
2. Selected preset button inside the date popover (filled background `bg-primary text-primary-foreground`)
3. Selected segment of the `GrainToggle` (existing behavior — unchanged)
4. Checked state of Checkbox items inside the multi-select dropdowns
5. Focus ring on keyboard-focused controls (`focus-visible:ring-2 ring-ring`)
6. Primary CTA button inside the Sheet ("Apply filters" if the draft-and-apply pattern is chosen; see Interaction Contract)

**NOT permitted for accent:** default button borders, default text, dropdown row hover (use `--muted`), filter bar bottom-border (use `--border`), sheet backdrop.

**Filter-active tint spec (D-04):** A non-default control gets `border-primary/60 bg-primary/5`. Subtle, not loud. No badge count, no removable chip row.

---

## Interaction Contract

**This phase has multiple UX decisions that CONTEXT.md left to Claude's discretion. They are locked here so planner + executor do not re-ask.**

### Sheet drawer transition
**Decision: slide-up bottom Sheet (drawer from bottom edge), full-width at 375px, 85vh max height, rounded top corners (`rounded-t-xl`).** Backdrop dims page at `bg-black/40`. Tap backdrop or drag-down handle (24px grabber bar) to dismiss. Matches iOS native action-sheet affordance; avoids clipping issues with sticky header z-index (Gotcha #8).

### Draft-and-apply vs instant-apply
**Decision (researcher recommendation, now locked):**
- **Sticky-bar controls (date picker, grain toggle): instant-apply.** Selecting a preset or changing grain triggers `goto()` immediately. These are single-value controls and the user's intent is unambiguous.
- **Sheet multi-selects (sales-type, payment-method): draft-and-apply.** Changes stage in local `$state` inside the Sheet. "Apply filters" primary button at the bottom of the Sheet commits via `goto()` and closes the Sheet. "Cancel" button discards drafts and closes. Closing the Sheet via backdrop tap or drag-dismiss = cancel (discard drafts).
- **Rationale:** multi-select instant-apply causes a full SSR round-trip per checkbox tick — unacceptable at 375px over cellular.

### URL param naming
**Decision: full snake_case names, no abbreviations.** `?range=7d&grain=week&sales_type=dine_in,takeaway&payment_method=visa,mastercard&from=2026-04-01&to=2026-04-15`. Matches REQUIREMENTS.md column names and Gotcha #1 MV dim names. Defaults kept in URL per D-16.

### Date picker popover positioning at 375px
**Decision: anchored-below-button popover on ≥375px, full-width minus 16px page gutters, max-width 343px.** If viewport shrinks below 360px, fall back to centered fixed overlay (`inset-x-4 top-20`). Never use `position: absolute` inside the sticky header — use `position: fixed` + teleport via a `<svelte:body>` portal root (`#popover-root` div in `app.html`) to escape the sticky stacking context. This resolves Gotcha #8 (iOS Safari sticky z-index trap).

### Active-state tint vs existing KPI cards
**Decision: filter-active tint applies ONLY to the control that has a non-default value.** It does NOT cascade to the KPI cards. Cards remain visually unchanged whether filters are applied or default. The only card-level visual affordance for "filters are active" is the data itself differing from the 7d default — intentional, per the founder's "URLs in bug reports" use case (D-16).

### Fixed-reference KPI tiles behavior under filters
**Decision: reference tiles (Today / Last 7d / Last 30d fixed-window KPI tiles) remain unscoped by filters.** They always show the absolute figures. Only the scoped/variable tiles (the ones driven by the `range` + `sales_type` + `payment_method` filter params) respect filters. Document this in the KpiTile component's prop contract (new prop: `respectsFilters: boolean`, default `true`; reference tiles pass `false`). No visual differentiation between the two groups this phase — revisit in Phase 8 if user testing shows confusion.

### Loading state on filter change
**Decision: no transition skeleton.** `goto(newUrl, { invalidateAll: true })` — full SSR navigation. Browser-native navigation indicator suffices. SvelteKit's `$navigating` store CAN be used by FilterBar to disable controls during navigation (`aria-busy`, `pointer-events-none`, `opacity-60`) — recommended, not mandatory.

### Empty dropdown options (D-13)
**Decision: hide the entire dropdown row inside the Sheet.** Do not render a disabled stub. The `{#if options.length > 0}` guard lives in `FilterSheet.svelte`. If BOTH multi-selects are empty, the "Filters" button on the sticky bar itself disappears (sheet would be empty except for "Reset all"). Keep the date picker + grain toggle always visible.

---

## Component Inventory (net-new this phase)

| Component | File | Primitive? | Notes |
|-----------|------|------------|-------|
| FilterBar | `src/lib/components/FilterBar.svelte` | No | Sticky top shell, ≤72px. Mounts date picker button + GrainToggle + "Filters" button |
| DatePickerPopover | `src/lib/components/DatePickerPopover.svelte` | No | Two-line button trigger + anchored popover containing presets (Today/7d/30d/90d/All) and two `<input type="date">`. Replaces `DateRangeChips.svelte` entirely |
| FilterSheet | `src/lib/components/FilterSheet.svelte` | No | Bottom slide-up drawer; contains sales_type MultiSelect + payment_method MultiSelect + Reset-all + Apply/Cancel footer |
| MultiSelectDropdown | `src/lib/components/MultiSelectDropdown.svelte` | No | Label + Command-list of Checkbox rows; draft-and-apply semantics |
| Popover (primitive) | `src/lib/components/ui/popover.svelte` | Yes | Portaled to `#popover-root`, Svelte 5 runes, `open` prop + trigger snippet |
| Sheet (primitive) | `src/lib/components/ui/sheet.svelte` | Yes | Bottom slide-up only this phase; backdrop + drag-dismiss grabber |
| Checkbox (primitive) | `src/lib/components/ui/checkbox.svelte` | Yes | 20px checkbox, `--primary` fill when checked, 44px touch target via outer wrapper |
| Command (primitive, minimal) | `src/lib/components/ui/command.svelte` | Yes | List container with `role="listbox"`; no fuzzy search in v1 |

**Kept (unchanged visually):** `GrainToggle.svelte` (re-wired through new schema only), `DashboardHeader.svelte` (extended to host FilterBar), `KpiTile.svelte` (prop added: `respectsFilters`).

**Removed:** `DateRangeChips.svelte` — deleted this phase.

---

## Copywriting Contract

| Element | Copy |
|---------|------|
| Sticky bar "Filters" button | `Filters` (no count badge per D-04) |
| Sticky bar "Filters" button, active state | `Filters` + 1px primary-tint border (no text change) |
| Date picker button line 1 | Preset name (`Today`, `7d`, `30d`, `90d`, `All`) or `Custom` |
| Date picker button line 2 | Actual date range in `MMM d – MMM d` format, e.g. `Apr 8 – Apr 15` (current year omitted; if range crosses years, show `MMM d yyyy – MMM d yyyy`) |
| Date popover heading | `Select date range` |
| Date popover preset section label | `Quick select` |
| Date popover custom section label | `Custom range` |
| Date popover custom-range input labels | `From` / `To` |
| Date popover primary CTA (custom-range apply) | `Apply range` |
| Sheet heading | `Filters` |
| Sheet section label — sales type | `Sales type` |
| Sheet section label — payment method | `Payment method` |
| Sheet primary CTA | `Apply filters` |
| Sheet secondary action | `Cancel` |
| Sheet reset button | `Reset all filters` (D-15 — lives inside sheet only) |
| Multi-select "all selected" placeholder | `All` |
| Multi-select "N selected" label | `{N} selected` (e.g. `2 selected`) |
| Empty dropdown (D-13) | Dropdown hidden entirely — no copy |
| Empty state — no rows after filter | Existing per-card `EmptyState` copy unchanged: `No data for the selected filters. Try widening the range.` |
| Error state — filter validation failure | Unreachable by design (D-17 coerces to defaults). If the zod `.catch()` branch is ever logged, surface nothing to the user — page renders with defaults |
| Destructive actions | **None this phase.** "Reset all filters" is non-destructive (merely rewrites URL to defaults; data is read-only). No confirmation dialog. |

**Verb-noun discipline:** `Apply filters`, `Apply range`, `Reset all filters`, `Select date range`. Never `Submit`, `OK`, `Done`, `Save`.

---

## Responsive + Accessibility Contract

- **Baseline viewport:** 375 × 667 (iPhone SE 2nd gen). Every control tested here before merge.
- **Touch targets:** `min-h-11` (44px) on every interactive element. Checkbox visual is 20px but wrapped in a 44px tappable row.
- **Focus:** `focus-visible:ring-2 ring-ring ring-offset-2` on all controls. Trap focus inside the Sheet when open (hand-rolled focus trap in `sheet.svelte`).
- **Keyboard:** Esc closes Popover and Sheet (discarding drafts for the Sheet). Enter submits `Apply filters` when focus is inside the Sheet. Space toggles Checkboxes.
- **ARIA:** Sheet gets `role="dialog" aria-modal="true" aria-labelledby="sheet-title"`. MultiSelect gets `role="listbox" aria-multiselectable="true"`. Checkbox rows get `role="option" aria-selected`. Date popover gets `role="dialog"` with labelled heading.
- **Scroll lock:** When Sheet is open, lock `<body>` scroll (`overflow-hidden` + preserve scroll position on close). Popover does NOT scroll-lock.
- **Reduced motion:** Sheet slide-up animation respects `prefers-reduced-motion: reduce` — fade in/out only, no translate.

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| none (hand-rolled) | popover, sheet, checkbox, command | not applicable — all source written in-repo by executor, reviewed in PR |

**No third-party registries declared.** shadcn-svelte CLI unreachable (04-01 decision). All primitives hand-rolled matching existing `src/lib/components/ui/` conventions. Registry vetting gate: not applicable.

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
