---
type: backlog
captured: 2026-05-04
source: Phase 16 wave 4 close — owner Chrome MCP localhost review
target_phase: v1.4 polish
priority: low
status: captured
---

# ForecastLegend — pressed-vs-unpressed-vs-disabled visual affordance is weak

Owner feedback (2026-05-04):

> "why can't I select other forecasting methods like SARIMAX, ETS, Theta...etc now?"

## Context

`ForecastLegend.svelte:71-78` implements 7 chip-buttons (SARIMAX, Prophet, ETS, Theta, Naive (DoW), Chronos, NeuralProphet). They ARE interactive — `aria-pressed` toggles, `onclick` fires `ontoggle(modelKey)` on the parent (RevenueForecastCard / InvoiceCountForecastCard / CalendarRevenueCard / CalendarCountsCard). Default visible state: `{sarimax, naive_dow}`.

But the owner thought they couldn't be selected. Three states map to three nearly-identical visual treatments at 375px:

| State | Style | Owner-perceived as |
|---|---|---|
| Pressed (visible) | white bg, zinc-900 text, shadow | "selected" ✓ |
| Unpressed (toggleable) | zinc-50 bg, zinc-500 text | "disabled" ✗ |
| Disabled (chronos/neural without feature flag) | zinc-50 bg, zinc-400 text, 40% opacity | "disabled" ✓ |

The unpressed and disabled states differ only by 100 zinc shades (500 vs 400) and an opacity multiplier — visually identical on most phone screens.

## What needs to happen

Make unpressed-toggleable look obviously different from disabled. Options:

1. **Color coding:** unpressed gets the model's palette color tint (faded), disabled stays neutral grey
2. **Icon affordance:** unpressed gets a "+" or "show" icon, pressed gets a "✓" or "hide" icon, disabled gets "✗" or no icon
3. **Border treatment:** unpressed gets a dashed border, pressed gets solid, disabled gets no border
4. **Hover/active feedback:** ensure tapping an unpressed chip produces a clear visual transition (animate in, brief highlight)

## Acceptance

- Owner sees the chip row and can tell at a glance:
  - "These models are currently shown" (pressed)
  - "These I can tap to add to the chart" (unpressed)
  - "These need a feature flag flipped" (disabled)
- A11y: `aria-pressed` and `aria-disabled` already correct; visual change must be perceivable without color alone (per WCAG 1.4.1)

## Out of scope

- Adding new toggleable models (chronos / neuralprophet enablement is its own feature gated by feature flags)
- Multi-row legend layout (horizontal scroll is the chosen pattern per Phase 15 D-04)
