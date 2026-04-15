---
phase: 06-filter-foundation
plan: 02
subsystem: ui-primitives
tags: [svelte5, ui, primitives, a11y]
requires: []
provides:
  - "Popover (portaled, Escape/backdrop close)"
  - "Sheet (bottom slide-up, role=dialog aria-modal, scroll lock)"
  - "Checkbox (20px visual + 44px touch target)"
  - "Command (role=listbox multiselect container)"
  - "#popover-root portal target"
affects:
  - "Plan 06-04 composition layer (FilterBar, DatePickerPopover, FilterSheet, MultiSelectDropdown)"
tech-stack:
  added: []
  patterns:
    - "Svelte 5 runes with $bindable props for open state"
    - "data-slot attributes matching existing ui/ primitives"
    - "cn() class-merging via $lib/utils"
    - "harness .svelte components under tests/unit/fixtures/ for snippet-accepting primitives"
key-files:
  created:
    - src/lib/components/ui/popover.svelte
    - src/lib/components/ui/sheet.svelte
    - src/lib/components/ui/checkbox.svelte
    - src/lib/components/ui/command.svelte
    - tests/unit/ui-primitives.test.ts
    - tests/unit/fixtures/SheetHarness.svelte
    - tests/unit/fixtures/PopoverHarness.svelte
    - tests/unit/fixtures/CommandHarness.svelte
  modified:
    - src/app.html
    - src/lib/components/ui/index.ts
decisions:
  - "Popover portaling uses physical DOM relocation via $effect (appendChild into #popover-root) with best-effort restore on cleanup — avoids Svelte mount() recursion and keeps the snippet tree intact"
  - "Snippet-accepting primitives (Popover/Sheet/Command) are unit-tested through lightweight harness .svelte components rather than constructing snippets from TS, matching existing tests/unit conventions"
  - "prefers-reduced-motion honored via motion-safe:/motion-reduce: Tailwind variants on sheet transitions rather than manual matchMedia checks"
metrics:
  duration: "~12min"
  completed: 2026-04-15
---

# Phase 06 Plan 02: UI Primitives Summary

Hand-rolled four net-new shadcn-style primitives (popover, sheet, checkbox, command) plus `#popover-root` portal target, matching existing `src/lib/components/ui/` Svelte 5 runes conventions, with 6 green vitest unit tests covering ARIA contracts and touch targets.

## Primitives Shipped

| Primitive | File                                    | Key ARIA / props                                                |
| --------- | --------------------------------------- | --------------------------------------------------------------- |
| Popover   | `src/lib/components/ui/popover.svelte`  | `role="dialog"`, `$bindable(open)`, portals to `#popover-root`  |
| Sheet     | `src/lib/components/ui/sheet.svelte`    | `role="dialog" aria-modal="true"`, scroll lock, 24px grabber    |
| Checkbox  | `src/lib/components/ui/checkbox.svelte` | `aria-checked`, `min-h-11` wrapper, hidden native input         |
| Command   | `src/lib/components/ui/command.svelte`  | `role="listbox" aria-multiselectable="true"`                    |

All four primitives:
- Use Svelte 5 runes (`$props`, `$bindable`, `$effect`)
- Merge `class` via `cn()` from `$lib/utils`
- Expose `data-slot="…"` attributes matching existing primitives
- Ship zero new dependencies (no `bits-ui` / `melt-ui`)

## ARIA Verification

| Contract                                            | Location                                 | Verified by                                    |
| --------------------------------------------------- | ---------------------------------------- | ---------------------------------------------- |
| Popover content has `role="dialog"`                 | popover.svelte                           | grep + renders in test                         |
| Sheet has `role="dialog"` + `aria-modal="true"`     | sheet.svelte                             | Test: "renders role=dialog and aria-modal"     |
| Sheet fully absent from DOM when `open=false`       | sheet.svelte `{#if open}`                | Test: "not in the document when open=false"    |
| Checkbox wrapper ≥44px touch target                 | checkbox.svelte `min-h-11`               | Test: "has min-h-11 wrapper"                   |
| Checkbox toggles `aria-checked` via native input    | checkbox.svelte                          | Test: "aria-checked false → true on click"     |
| Command is `role="listbox" aria-multiselectable`    | command.svelte                           | Test: "renders role=listbox container"         |
| Popover renders portaled children when `open=true`  | popover.svelte                           | Test: "renders children content when open"     |

## Test Coverage

`tests/unit/ui-primitives.test.ts` — **6/6 passing**:
1. Checkbox `aria-checked` toggles false → true on click
2. Checkbox wrapper has `min-h-11` class
3. Sheet `open=true` renders `role=dialog` + `aria-modal=true`
4. Sheet `open=false` has no dialog in document
5. Command renders `role=listbox` container with `aria-multiselectable=true`
6. Popover renders children content when `open=true`

Full unit suite: **54/54 passing** (no regressions in existing tests).

## Deviations from Plan

### Auto-fixed / adapted

**1. [Rule 3] Snippet-accepting primitives tested via harness .svelte files**
- **Found during:** Task 2 test authoring
- **Issue:** Popover/Sheet/Command take `children`/`trigger` snippet props that are awkward to construct inline in a `.test.ts` file with `@testing-library/svelte`.
- **Fix:** Created three lightweight harness components under `tests/unit/fixtures/` (SheetHarness, PopoverHarness, CommandHarness) that import the primitive and supply literal snippet bodies. The test file then renders the harness.
- **Impact:** No production code change; test fixtures only.

**2. [Rule 1] Popover portal approach simplified**
- **Issue:** Plan described "append a detached HTMLDivElement and mount content inside it", which conflicts with how Svelte 5 snippets are anchored in the parent render tree (mounting children into a detached node from inside the component requires `mount()` recursion and breaks cleanup).
- **Fix:** Physically relocate the already-rendered content wrapper (`bind:this`) into `#popover-root` via `$effect` on open, then restore to original parent on cleanup so Svelte's anchor teardown still runs. Same user-visible behavior; cleaner lifecycle.
- **Impact:** popover.svelte implementation only.

**Auth gates:** None.

**Architectural changes:** None.

## Acceptance Criteria Check

- [x] `grep -n "id=\"popover-root\"" src/app.html` → match
- [x] `grep -n "data-slot=\"popover-content\"" src/lib/components/ui/popover.svelte` → match
- [x] `grep -n "role=\"dialog\"" src/lib/components/ui/popover.svelte` → match
- [x] `grep -n "export { default as Popover }"` → match
- [x] `grep -n "\$bindable" src/lib/components/ui/popover.svelte` → match
- [x] `role="dialog"`, `aria-modal="true"` in sheet.svelte → match
- [x] `min-h-11` in checkbox.svelte → match
- [x] `role="listbox"` in command.svelte → match
- [x] `document.body.style.overflow` scroll lock in sheet.svelte → match
- [x] 3 new exports (Sheet, Checkbox, Command) in ui/index.ts → match
- [x] `vitest run tests/unit/ui-primitives.test.ts` exits 0, 6 tests passing
- [x] Full unit suite 54/54 passing — no regressions
- [x] `scripts/ci-guards.sh` green
- [x] No changes outside declared `files_modified` set (plus fixtures/)

## Known Stubs

None. Primitives are complete for Plan 04's needs: `import { Popover, Sheet, Checkbox, Command } from '$lib/components/ui'` is ready.

## Commits

- `eee74fc` feat(06-02): add popover primitive + #popover-root portal target
- `2f38b74` feat(06-02): add sheet + checkbox + command primitives with vitest coverage

## Self-Check: PASSED

All declared files exist:
- src/lib/components/ui/popover.svelte — FOUND
- src/lib/components/ui/sheet.svelte — FOUND
- src/lib/components/ui/checkbox.svelte — FOUND
- src/lib/components/ui/command.svelte — FOUND
- tests/unit/ui-primitives.test.ts — FOUND
- src/app.html `#popover-root` — FOUND
- src/lib/components/ui/index.ts exports — FOUND (4 new)

All commits exist in `git log`:
- eee74fc — FOUND
- 2f38b74 — FOUND
