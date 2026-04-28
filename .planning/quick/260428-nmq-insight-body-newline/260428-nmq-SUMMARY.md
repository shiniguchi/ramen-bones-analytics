---
quick_id: 260428-nmq
slug: insight-body-newline
date: 2026-04-28
status: complete
commits:
  - 3a2d2e1
---

# Quick Task 260428-nmq — Summary

## What changed

- **`src/lib/components/InsightCard.svelte:164`** — added `whitespace-pre-line` to the body `<p>` so user-typed newlines render as line breaks. Single-line change.

## Why

The edit form's `<textarea rows="4">` accepted Enter keys and the `updateInsight` action persisted the text with newlines intact (only `.trim()` is applied to the outer string). But the read-mode `<p>` had no whitespace-preservation class, so HTML's default `white-space: normal` collapsed every `\n` to a single space. User-typed 改行 had no visible effect.

`whitespace-pre-line` preserves `\n` as line breaks while still collapsing runs of spaces/tabs (so a clipboard paste with weird indentation doesn't mis-render).

## Verification

- Localhost `http://localhost:5173/?range=all&grain=week` — the previously-saved edit (typed before this fix) now renders with all line breaks visible:
  - `先週と比べると：` followed by 4 bullet lines
  - blank-line separator
  - `まとめ：Instagram…` paragraph
- No console errors at page load.
- Headline behavior unchanged (single line, as intended).

## Out of scope

- Markdown / rich-text editing.
- Auto-grow textarea or row-count tweaks.
- Preserving multiple consecutive spaces (`pre-line` collapses those — desirable).

## Commit

- `3a2d2e1` — fix(InsightCard): render newlines in body (whitespace-pre-line)
