---
name: LayerChart horizontal scroll needs tooltipContext touchEvents override
description: Any scrollable LayerChart bar chart on mobile must pass tooltipContext={{ touchEvents: 'pan-x' }} or horizontal swipes become tooltip taps instead of scrolling.
type: feedback
---

When putting a LayerChart `BarChart` inside a horizontally-scrollable wrapper (e.g. `overflow-x-auto` + `touch-pan-x` for wide charts on mobile), always pass `tooltipContext={{ touchEvents: 'pan-x' }}` to the chart.

**Why:** LayerChart's `TooltipContext` wraps the chart in a div styled `touch-action: var(--touch-action)` whose default is `pan-y`. iOS (and most mobile browsers) resolve `touch-action` to the **innermost** element's value for gestures starting in that region. So an outer `touch-action: pan-x` wrapper loses to the inner `pan-y`, and horizontal finger swipes get sent to LayerChart's pointer handlers (showing the tooltip) instead of native scrolling. Diagnosed 2026-04-17; PRs #6–#10 were the full arc including two failed attempts before pinning the real root cause.

**How to apply:**
- When you add a new LayerChart bar chart that might scroll horizontally on mobile, pass `tooltipContext={{ touchEvents: 'pan-x' }}` alongside `width={...}` from `computeChartWidth`.
- Don't bother with CSS `pointer-events: none` hacks on `.lc-tooltip-rect` — they mask the symptom but block legitimate tap-to-tooltip on mobile.
- If you need two-axis scroll (rare), use `'auto'` instead of `'pan-x'` so the inner defers to whatever ancestor `touch-action` says.
- Desktop hover is unaffected either way — this only matters for coarse-pointer devices.
- Vertical swipes continue to bubble up to the page scroll container as expected.

## Update 2026-04-18

Relaxed the default rule from `'pan-x'` → `'auto'` after the PC trackpad vertical-scroll regression surfaced on the full dashboard. On desktop, `'pan-x'` was blocking the browser from routing vertical trackpad gestures up to the page scroll container — charts effectively swallowed vertical intent.

Updated rule-of-thumb:
- Default to `tooltipContext={{ touchEvents: 'auto' }}` on LayerChart charts that live inside horizontally-scrollable wrappers.
- Only fall back to `'pan-x'` if `'auto'` actively causes the tooltip-on-swipe regression on a real mobile device (symptom: horizontal swipe shows tooltip instead of scrolling).
- Nuclear CSS fallback if neither works: `.chart-touch-safe :global(.lc-tooltip-context) { touch-action: manipulation; }` in `src/app.css` — only apply when the component-level prop fails.
- Applied across 6 dashboard charts in quick-260418-f99.
