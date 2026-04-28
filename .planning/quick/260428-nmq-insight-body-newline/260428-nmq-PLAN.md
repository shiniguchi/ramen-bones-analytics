---
quick_id: 260428-nmq
slug: insight-body-newline
date: 2026-04-28
description: Render newlines in the InsightCard body so admin-edited 改行 are visible (whitespace-pre-line)
status: pending
---

# Quick Task 260428-nmq — Render insight body newlines

## Why

The InsightCard's edit form has a `<textarea rows="4">` for the body (`src/lib/components/InsightCard.svelte:226-232`). The user can type Enter to insert newlines, and the form action persists them as-is (only `.trim()` is applied — internal `\n` are kept). But the read-mode `<p>` at line 164-166 lacks any whitespace-preservation class, so HTML's default `white-space: normal` collapses every newline to a single space. Result: typing 改行 in the editor has no visible effect.

Fix: add `whitespace-pre-line` to the body's `<p>`. This preserves `\n` as line breaks while still collapsing runs of spaces/tabs (so a copy-pasted blob with weird whitespace doesn't render mis-aligned). Tailwind v4 supports the class out-of-the-box.

Headline remains single-line by design.

## Tasks

### 1. Add `whitespace-pre-line` to the body `<p>` in `InsightCard.svelte:164`

Change:
```svelte
<p class="mt-2 text-sm leading-normal text-zinc-700">
  {view.body}
</p>
```
to:
```svelte
<p class="mt-2 text-sm leading-normal whitespace-pre-line text-zinc-700">
  {view.body}
</p>
```

**Verify:**
- `npm run dev` → localhost:5173 → click "インサイトを編集" on the insight card → in the body field, type a sentence, hit Enter twice, type another sentence → save → confirm the rendered card shows two lines separated by a blank line.

### 2. Sanity-run unit tests

`npx vitest run src/lib/components/InsightCard.test.ts` — confirm no behavior assertions about whitespace break.

## must_haves

- Newlines typed in the InsightCard body editor render as visible line breaks in the read-mode card.
- Headline behavior unchanged (single line).
- No regressions in InsightCard unit tests.

## Out of scope

- Adding a Markdown / rich-text editor.
- Changing the textarea's row count or auto-grow behavior.
- Preserving leading/trailing tabs and multiple consecutive spaces (`pre-line` collapses those — desirable here, not a bug).
