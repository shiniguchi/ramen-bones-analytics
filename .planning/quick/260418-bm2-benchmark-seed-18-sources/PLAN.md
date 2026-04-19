---
task: 260418-bm2
title: Migration 0031 — seed 18 sources + 20 points for ramen-bones
branch: feature/dashboard-chart-improvements-260418
status: complete
created: 2026-04-19
---

# Migration 0031 — seed 18 benchmark sources

Second of 4 atomic tasks. DB seed only — no TS, no UI.

## Result (benchmark_curve_v for ramen-bones)

| period_weeks | lower_p20 | mid_p50 | upper_p80 | sources |
|---|---|---|---|---|
| 1  | 18.0 | 18.0 | 18.0 | 1 |
| 4  | 17.5 | 38.0 | 47.0 | 5 |
| 12 | 18.0 | 25.0 | 40.0 | 8 |
| 26 | 22.0 | 22.0 | 25.0 | 3 |
| 52 | 20.0 | 21.0 | 21.0 | 3 |

Total: 18 sources across JP/US/KR/CN/FR, 20 data points.
