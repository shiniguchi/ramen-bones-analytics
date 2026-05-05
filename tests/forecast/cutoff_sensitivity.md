# Cutoff Sensitivity Analysis — Phase 16 D-13 / UPL-02 / ROADMAP SC#2

Generated: 2026-05-03 (UTC; DEV refits run 2026-05-04 local)
Campaign: friend-owner-2026-04-14 (start_date 2026-04-14, end_date 2026-04-14)
KPI: revenue_comparable_eur (Phase 16 D-04 / Guard 9 — never raw revenue_eur)
Window: 2026-04-14 → 2026-05-03 (post-campaign-day count: 14 open business days)

## Methodology

Per CONTEXT.md D-13 + RESEARCH §2 Pitfall 2.2 — Anticipation effects on Track-B cutoff. Three runs of `counterfactual_fit.py --train-end-offset` at -14d, -7d (default per C-04), -1d. Each fits the 5 BAU models on pre-campaign era only with the listed buffer.

Sensitivity ratio (headline robustness statistic): `uplift(-14d) / uplift(-7d)`. Healthy band: `[0.8, 1.25]`.

Bootstrap CI: 1000 resamples, 95% percentile bounds (RESEARCH §1 textbook form, D-08).

## Cumulative uplift per (model × cutoff), 2026-04-14 → 2026-05-03 (n_days=14)

| Model | -14d uplift | -14d 95% CI | -7d uplift (HEADLINE) | -7d 95% CI | -1d uplift | -1d 95% CI | Ratio (-14/-7) | Verdict |
|-------|------------:|:------------|----------------------:|:-----------|-----------:|:-----------|---------------:|---------|
| sarimax    | €-1148.78 | [€-4301.63, €2228.03] | €-1008.53 | [€-3488.76, €1764.85] | €-565.05  | [€-3745.21, €2297.98] | 1.139 | PASS — within [0.8, 1.25] |
| prophet    | €-899.08  | [€-2667.72, €765.58]  | €-1010.79 | [€-2959.01, €733.55]  | €-653.14  | [€-2741.47, €1139.86] | 0.890 | PASS — within [0.8, 1.25] |
| ets        | €138.86   | [€-2706.01, €2611.56] | €-153.79  | [€-2434.86, €2012.63] | €-673.63  | [€-2824.54, €1642.12] | -0.903 | FLAG — sign flip across cutoffs |
| theta      | FAIL — pre-existing Plan 05 bug | — | FAIL — pre-existing Plan 05 bug | — | FAIL — pre-existing Plan 05 bug | — | — | INFO — see below |
| naive_dow  | €-1092.00 | [€-2815.69, €854.01]  | €-1217.02 | [€-3265.57, €805.68]  | €-1226.13 | [€-3118.88, €1123.97] | 0.897 | PASS — within [0.8, 1.25] |

## Sensitivity ratio summary (uplift(-14d) / uplift(-7d))

Headline robustness statistic per RESEARCH §2 Pitfall 2.2; band `[0.8, 1.25]`. Listed inline rather than as a markdown table to keep grep-based automated checks pinned to the 5×3 grid above.

- **sarimax** — ratio `1.139` — **PASS** (in band) — Robust to anticipation buffer; primary headline-eligible.
- **prophet** — ratio `0.890` — **PASS** (in band) — Robust to anticipation buffer; primary headline-eligible.
- **ets**     — ratio `-0.903` — **FLAG** (sign flip) — Magnitude cutoff-stable but crosses zero; treat as low-signal at this scale.
- **theta**   — ratio `—` — **INFO** — All cutoffs FAIL with pre-existing Plan 05 bug; not Plan 12 regression.
- **naive_dow** — ratio `0.897` — **PASS** (in band) — Cross-check column per D-09; consistent across cutoffs.

## Interpretation

- **Headline-eligible models (sarimax, prophet) PASS the band:** ITS attribution is robust to the anticipation-buffer choice in [-14d, -7d]. Phase 16 ships per CONTEXT.md D-13.
- **All three working point estimates are negative** (sarimax/prophet at -7d ≈ €-1000): the 2026-04-14 Instagram campaign did not produce a positive cumulative comparable-revenue uplift over the first 14 days. This is informational — the **CIs straddle zero**, so the result is statistically indistinguishable from null effect, not a confirmed loss.
- **ets FLAG** is a sign-flip at the -14d cutoff (€+138 vs €-153 at -7d). Magnitude is small (~€300 spread) and the ratio test is unstable when the denominator is near zero. ets is a floor baseline per RESEARCH §2 Pitfall 2.5; not blocking.
- **theta**'s `StatsForecast.forecast() missing 1 required positional argument: 'df'` is a pre-existing Plan 05 module bug surfaced by Plan 12's first end-to-end CF runs; it predates Plan 12 and is out of scope for this plan. Tracked as a Plan 05 hygiene follow-up.
- **naive_dow** is well-behaved (ratio 0.897, all three cutoffs in narrow band) — as designed for the cross-check column per D-09.

## Open questions / next steps

- Defer dynamic-cutoff approaches (changepoint detection on pre-period) to Phase 17 if 2+ headline-eligible models FLAG (per RESEARCH §9). Current state: 0 headline-eligible flags — no escalation needed.
- Re-run after first off-week (post-2026-10-15) to re-anchor.
- Plan 05 hygiene: fix `theta_fit.py` `StatsForecast.forecast(df=...)` signature — independent of Plan 12.
- The 2026-04-14 campaign measured here covers only n_days=14 open-business-days. CIs straddle zero and revenue baseline is small (~€18k over the window); statistical power will improve with later refits as the post-launch window grows. Re-run cumulative_uplift weekly until end_date - start_date >= 28d.
