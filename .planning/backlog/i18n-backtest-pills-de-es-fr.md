# i18n Backlog — Backtest Pills (de / es / fr)

**Phase:** 17 (Backtest Gate & Quality Monitoring)
**Plan:** 17-09 (ModelAvailabilityDisclosure backtest column)
**Date:** 2026-05-06
**Owner:** TBD (translator pool, v1.4)

## Placeholder Keys

The following 8 keys ship with EN-verbatim placeholder values in de/es/fr; real
translations queued for v1.4 (per Phase 16.1-02 i18n discipline pattern).

Long-form (used in tooltips / a11y):
- `model_avail_backtest_pass` (e.g. en "PASS", ja "合格")
- `model_avail_backtest_fail` (en "FAIL", ja "不合格")
- `model_avail_backtest_pending` (en "PENDING", ja "集計中")
- `model_avail_backtest_uncalibrated` (en "UNCALIBRATED — 2y data needed", ja "較正前（2年要）")

Short-form (used in compact pill cells):
- `model_avail_backtest_short_pass` (✓ — universal)
- `model_avail_backtest_short_fail` (✗ — universal)
- `model_avail_backtest_short_pending` (… — universal)
- `model_avail_backtest_short_uncalibrated` (~ — universal)

## Notes

Friend-owner only verifies ja + en in v1.3 (per CONTEXT.md). de/es/fr are
placeholders to keep the type system happy and prevent runtime missing-key warnings.
Short-form keys may stay universal (Unicode symbols) — translator decides.
