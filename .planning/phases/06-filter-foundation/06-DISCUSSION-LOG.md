# Phase 6: Filter Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-15
**Phase:** 06-filter-foundation
**Areas discussed:** Scope reality check, Filter bar layout, Date picker + presets, Dropdown widget + 'All', Reset + URL hygiene

---

## Scope Reality Check (pre-gray-area)

| Option | Description | Selected |
|--------|-------------|----------|
| Ship 4, defer 2 | Phase 6 ships date-picker + grain + sales-type + payment-method. FLT-05 → Phase 7, FLT-06 → Phase 8. Roadmap amended. | ✓ |
| Ship 6, 2 disabled | Build all 6 controls + full zod schema; FLT-05/06 greyed with tooltip until their columns land. | |
| Ship 6, stub data | Wire FLT-05/06 against stopgap stg-table joins; replace in 7/8. | |
| Let's discuss | Talk through tradeoff before locking. | |

**User's choice:** Ship 4, defer 2
**Notes:** `wl_issuing_country` promotion is Phase 7; `lifetime_bucket` is Phase 8 (per `.planning/v1.1-DATA-MODEL.md`). Phase 6 cannot satisfy FLT-05/06 against v1.0 wrapper views. Planner must patch ROADMAP.md + REQUIREMENTS.md as phase deliverables.

---

## Gray Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Filter bar layout | Placement at 375px, split/group of controls, active-state indicator, scroll reachability. | ✓ |
| Date picker + presets | Widget kind, preset location, default range, closed-button label. | ✓ |
| Dropdown widget + 'All' | Widget kind, single vs multi-select, 'All' sentinel semantics, empty-options handling. | ✓ |
| Reset + URL hygiene | Reset affordance, defaults-in-URL policy, invalid-param handling, SSR vs CSR on change. | ✓ |

All 4 selected.

---

## Filter Bar Layout

### Bar placement
| Option | Description | Selected |
|--------|-------------|----------|
| Inline, top of page | Bar above first card, scrolls away. | |
| Sticky top bar | Pins to viewport; always reachable. | ✓ |
| Collapsible 'Filters' sheet | Single button opens everything; most card space. | |

**User's choice:** Sticky top bar

### Split / hierarchy
| Option | Description | Selected |
|--------|-------------|----------|
| Split: date+grain primary | Date + grain inline sticky; sales + payment inside Filters sheet. | ✓ |
| All together | All 5 controls on same surface. | |
| All inside sheet | Only a single Filters button visible. | |

**User's choice:** Split — date+grain primary

### Active state indicator
| Option | Description | Selected |
|--------|-------------|----------|
| Badge count | "Filters (2)" badge. | |
| Inline chips | Removable active-filter chips above cards. | |
| Subtle highlight | Non-default controls get colored border/tint. | ✓ |

**User's choice:** Subtle highlight

### Scroll reachability
| Option | Description | Selected |
|--------|-------------|----------|
| Yes — must be reachable | Sticky or FAB; no scroll-back. | ✓ |
| No — scroll back fine | Set-once UX, acceptable friction. | |

**User's choice:** Yes — sticky covers it.

---

## Date Picker + Presets

### Picker widget
| Option | Description | Selected |
|--------|-------------|----------|
| Native `<input type=date>` pair | Zero deps, OS-native, free a11y. | ✓ |
| shadcn-svelte Calendar | Consistent look, ~8–12kb, built-in range. | |
| Custom Svelte 5 popover | Max control, own the edge cases. | |

**User's choice:** Native pair (inside a custom popover surface alongside preset buttons)

### Preset location
| Option | Description | Selected |
|--------|-------------|----------|
| Inside picker popover | Presets above/beside the calendar. | ✓ |
| Alongside picker | Chip row + custom button. | |
| Only inside picker | No chips at all. | |

**User's choice:** Inside popover

### Default range
| Option | Description | Selected |
|--------|-------------|----------|
| 7d (current) | Preserves v1.0. | ✓ |
| 30d | Wider default. | |
| Last full week/month | Stable comparisons. | |

**User's choice:** 7d

### Closed-button label
| Option | Description | Selected |
|--------|-------------|----------|
| Preset name if matching | "7d" / "Custom" + dates subtitle. | ✓ |
| Always the dates | "Apr 8 – Apr 15" literal. | |
| You decide | Claude picks later. | |

**User's choice:** Preset name if matching, two-line with dates underneath.

---

## Dropdown Widget + 'All'

### Widget (first pass)
| Option | Description | Selected |
|--------|-------------|----------|
| Native `<select>` | Zero JS, ugliest. | ✓ (later overridden) |
| shadcn-svelte Select | bits-ui based. | |
| Bottom-sheet list | Mobile-native, most code. | |

**User's choice (first pass):** Native — conflicted with multi-select; re-asked.

### Single vs multi-select
| Option | Description | Selected |
|--------|-------------|----------|
| Single-select | One value + All. | |
| Multi-select | Array, IN() SQL. | ✓ |

**User's choice:** Multi-select

### Conflict resolution (re-ask)
| Option | Description | Selected |
|--------|-------------|----------|
| Drop multi, keep native | Single-select native — ship fast. | |
| Keep multi, custom widget | Build checkbox bottom-sheet. | |
| Keep multi, shadcn-svelte | Command/Popover combobox multi-select. | ✓ |

**User's choice:** shadcn-svelte Command/Popover with checkboxes.
**Notes:** Overrides the native choice. Matches the rest of the UI kit with minimal custom code.

### 'All' sentinel
| Option | Description | Selected |
|--------|-------------|----------|
| Absent param = All | No ?payment= in URL; zod default undefined; skip `.in()`. | ✓ |
| Explicit 'all' in URL | ?payment=all literal. | |

**User's choice:** Absent param

### Empty options
| Option | Description | Selected |
|--------|-------------|----------|
| Hide dropdown | No control at all if 0 distinct values. | ✓ |
| Disabled 'All' only | Shows disabled All. | |
| Populate from full table | Options ignore current filter state. | |

**User's choice:** Hide dropdown
**Notes:** Combined with the "decouple options from current filter state" clarification — the `DISTINCT` query itself runs against the full wrapper view unfiltered by other filters (D-14), but if that still returns 0 rows the control is hidden entirely.

---

## Reset + URL Hygiene

### Reset affordance
| Option | Description | Selected |
|--------|-------------|----------|
| Yes — inside sheet | Bottom/top of Filters sheet. | ✓ |
| Yes — inline on bar | Always-visible 'x' on sticky bar. | |
| No reset | User clears individually. | |

**User's choice:** Inside sheet

### Defaults in URL
| Option | Description | Selected |
|--------|-------------|----------|
| Strip defaults | Clean URLs, deltas only. | |
| Keep defaults | Explicit, verbose, debuggable. | ✓ |

**User's choice:** Keep defaults
**Notes:** Founder will paste URLs into notes/bug reports; explicitness > cleanliness.

### Invalid param handling
| Option | Description | Selected |
|--------|-------------|----------|
| Coerce to default | `z.enum().catch(default)`. | ✓ |
| Strip and redirect | 302 to cleaned URL. | |
| 400 error page | Strict, hostile to typoed URLs. | |

**User's choice:** Coerce to default

### SSR vs CSR on filter change
| Option | Description | Selected |
|--------|-------------|----------|
| Full SSR navigation | `goto()` reruns load(). | ✓ |
| Invalidate + re-run load | `goto()` with `invalidateAll`. | |
| You decide | Claude picks. | |

**User's choice:** Full SSR navigation — matches existing DateRangeChips/GrainToggle pattern.

---

## Claude's Discretion

- Sheet transition animation (slide/drawer/modal)
- Exact Tailwind token for active-state border/tint
- `invalidateAll: true` flag inside `goto()` (D-18 allows either)
- Transition-loading skeleton strategy
- Popover positioning at 375px

## Deferred Ideas

See CONTEXT.md `<deferred>` section. Key items:
- FLT-05 → Phase 7 (column promotion)
- FLT-06 → Phase 8 (star schema)
- Badge-count active state (rejected)
- Removable chip row (rejected)
- Bottom-sheet custom multi-select (rejected)
- Strip-defaults URL mode (rejected)
- Client-side query caching (rejected)
</content>
</invoke>
