---
plan: 17-09
phase: 17-backtest-gate-quality-monitoring
status: complete
completed: 2026-05-06
---

# Plan 17-09 Summary — ModelAvailabilityDisclosure Backtest Pills

## What Was Built

Extended `ModelAvailabilityDisclosure.svelte` with a 5th "Backtest" column showing 4 horizon pills (h=7/35/120/365) per model row, color-coded by backtest verdict.

## Commits

| Commit | Description |
|--------|-------------|
| `53bd26d` | feat(17-09): extend /api/forecast with modelBacktestStatus field |
| `336c4f0` | feat(17-09): add 8 i18n keys x 5 locales for backtest verdict pills |
| `4bea811` | feat(17-09): add backtest verdict pills column to ModelAvailabilityDisclosure |

## Key Files Changed

- `src/routes/api/forecast/+server.ts` — queries `forecast_quality` (rolling_origin_cv), deduplicates latest verdict per (model, horizon), returns `modelBacktestStatus: Record<string, {h7,h35,h120,h365}>`
- `src/lib/i18n/messages.ts` — 40 new entries: 8 keys × 5 locales (en+ja real, de/es/fr placeholder)
- `src/lib/components/ModelAvailabilityDisclosure.svelte` — 5th `<td>` with 4 pills, `min-w-[840px]`, `verdictColorClass()` + `verdictShortKey()` helpers, `backtestStatus` prop defaulting to null
- `src/lib/components/CalendarRevenueCard.svelte` — wires `backtestStatus={overlay.forecastData?.modelBacktestStatus ?? null}`
- `src/lib/components/CalendarCountsCard.svelte` — same wiring
- `src/lib/forecastOverlay.svelte.ts` — `modelBacktestStatus` field added to overlay store type
- `tests/unit/ModelAvailabilityDisclosure.test.ts` — 6 new vitest cases (all pass)
- `.planning/backlog/i18n-backtest-pills-de-es-fr.md` — backlog stub for v1.4 translations

## Test Results

```
Test Files  1 passed (1)
Tests       6 passed (6)
```

All 6 new vitest cases pass: pill rendering, PASS (emerald), FAIL (rose), UNCALIBRATED (amber), cold-start null (zinc), missing-model fallback (zinc).

## Localhost QA — Visual verification: PASS

Verified at desktop viewport (Chrome MCP) in both ja and en locales:

**ja locale:**
- Disclosure trigger: "なぜ一部のモデルは無効？" opens correctly
- 5-column table: モデル | 状態 | 最小データ | 理由 | Backtest
- 28 pills (7 models × 4 horizons), all gray `bg-zinc-50 text-zinc-400` (cold-start PENDING — no rolling_origin_cv rows yet, correct)
- `min-w-[840px]` confirmed via DOM inspection
- No console errors

**en locale:**
- Disclosure trigger: "Why are some models disabled?" opens correctly
- 5 headers: Model | Status | Min data | Why | Backtest
- `title="PENDING"` on each pill (English i18n key resolved correctly vs 集計中 in ja)
- 28 pills confirmed, same gray fallback
- No console errors

## Self-Check: PASSED

- [x] `/api/forecast` returns `modelBacktestStatus` field
- [x] 40 i18n entries (8 keys × 5 locales) added
- [x] en + ja real translations; de/es/fr placeholder
- [x] Backlog stub created
- [x] `min-w-[640px]` → `min-w-[840px]`
- [x] 4 pills per model row with correct color helpers
- [x] CalendarRevenueCard + CalendarCountsCard wired
- [x] 6 vitest tests green
- [x] Localhost QA PASS (ja + en)
- [x] No console errors
