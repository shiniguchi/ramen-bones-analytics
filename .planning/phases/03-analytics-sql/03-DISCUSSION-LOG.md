# Phase 3: Analytics SQL - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents. For decisions that bind downstream work, see `03-CONTEXT.md`.

**Date:** 2026-04-14
**Mode:** discuss (standard, no `--auto`, no `--batch`)
**Advisor mode:** off (no `USER-PROFILE.md` present)

---

## Gray areas presented

1. **Cohort definition & grain default** — first-visit rule, default grain, min cohort size, April blackout handling.
2. **Survivorship guard shape** — how horizon-clipping surfaces to UI (NULL-mask vs row-filter vs column-based).
3. **LTV flavor + frequency buckets + new-vs-returning rule** — three load-bearing metric definitions.
4. **pg_cron orchestration** — MV vs plain-view shape, job count, schedule, failure visibility.

User selected: **all four.**

---

## Area ① — Cohort definition & grain default

**Q1.** What cohort grain should be the default shown in the UI?
- Options: Weekly (recommended) / Monthly / Daily
- **User answer:** Weekly (Recommended)
- → Locked as D-04

**Q2.** Minimum cohort size before a cohort is displayed — hide cohorts with very few customers?
- Options: Show all N≥1 (recommended) / Hide N<5 / Hide N<10
- **User answer:** Show all (N≥1) (Recommended)
- → Locked as D-05

**Q3.** How should the April 2026 Worldline blackout be handled in identity metrics?
- Options: Expose `data_quality` column (recommended) / Exclude April rows entirely / Do nothing — UI caveats it
- **User answer:** Exclude April rows entirely
- → Diverged from recommendation; triggered follow-up Q3a.

**Q3a (follow-up).** Exclude April from which views?
- Options: Identity metrics only (recommended) / All MVs including kpi_daily / Exclude from transactions at load
- **User answer:** Identity metrics only (Recommended)
- → Locked as D-06 and D-07.

**Q4.** First-visit cohort assignment rule — pure `MIN(occurred_at)` or edge-case handling?
- Options: Pure MIN(occurred_at) (recommended) / Freeze on first observation
- **User answer:** Pure MIN(occurred_at) (Recommended)
- → Locked as D-01

---

## Area ② — Survivorship guard shape

**Q5.** How should `retention_curve_v` surface the survivorship-bias guard?
- Options: NULL-mask past horizon (recommended) / Row-filtered / Column-based UI-filtered
- **User answer:** NULL-mask past horizon (Recommended) — selected with preview
- → Locked as D-08 and D-10

**Q6.** How should `ltv_v` handle the same survivorship problem?
- Options: Same NULL-mask pattern (recommended) / Running LTV up to observed age / Clip all cohorts to shortest
- **User answer:** Same NULL-mask pattern (Recommended)
- → Locked as D-08

**Q7.** How is the "shortest observable horizon" computed?
- Options: Per-cohort `now() - cohort_start` (recommended) / Global shortest cohort's age
- **User answer:** Per-cohort (Recommended)
- → Locked as D-09

---

## Area ③ — LTV flavor + frequency buckets + new-vs-returning rule

**Q8.** What does `ltv_v.ltv_cents` represent?
- Options: Avg LTV per acquired customer (recommended) / Cumulative cohort revenue / Both
- **User answer:** Avg LTV per acquired customer (Recommended)
- → Locked as D-11

**Q9.** `frequency_v` buckets — fixed, raw, or both?
- Options: Fixed 1 / 2 / 3–5 / 6–10 / 11+ (recommended) / Raw visit_count only / Both
- **User answer:** Fixed (Recommended)
- → Locked as D-12. Raw-count view moved to Deferred Ideas.

**Q10.** How is "returning customer" defined in `new_vs_returning_v`?
- Options: First-ever-visit split (recommended) / Active returning 60-day window / Both
- **User answer:** First-ever-visit split (Recommended)
- → Locked as D-13. 60-day active window moved to Deferred Ideas.

**Q11.** How should cash appear in `new_vs_returning_v` given it can't be identity-split?
- Options: Third bucket `cash_anonymous` (recommended) / Drop cash entirely / Fold into "returning"
- **User answer:** Third bucket `cash_anonymous` (Recommended)
- → Locked as D-14. Revenue tie-out test captured in D-26 #3.

---

## Area ④ — pg_cron orchestration + MV/view shape

**Q12.** Which leaves are materialized vs plain wrapper views?
- Options: Only cohort_mv + kpi_daily_mv (recommended) / All leaves materialized / Cohort+kpi+ltv hybrid
- **User answer:** Only `cohort_mv` + `kpi_daily_mv` (Recommended)
- → Locked as D-16. Materializing leaves moved to Deferred Ideas.

**Q13.** pg_cron job structure?
- Options: One job, sequential function (recommended) / N staggered jobs / One job, parallel refreshes
- **User answer:** One job, sequential function (Recommended)
- → Locked as D-20

**Q14.** What time should the nightly refresh run?
- Options: 03:00 UTC / 05:00 Berlin (recommended) / 04:00 UTC / 06:00 Berlin / Founder triggers manually
- **User answer:** 03:00 UTC = 05:00 Berlin (Recommended)
- → Locked as D-21

**Q15.** How should refresh failures surface in v1?
- Options: pg_cron built-in `cron.job_run_details` (recommended) / Custom `mv_refresh_log` table
- **User answer:** pg_cron built-in (Recommended)
- → Locked as D-22. Custom log table + alerting moved to Deferred Ideas.

---

## Wrap-up

**Q16.** Ready to write CONTEXT.md?
- Options: Write context (recommended) / One more thing
- **User answer:** Write context (Recommended)

---

## Deferred ideas surfaced during discussion

(See `<deferred>` section in 03-CONTEXT.md for the authoritative list.)

- Materialized LTV / retention / frequency / new_vs_returning leaves
- Raw per-customer visit count view
- Active-60-day returning definition
- Cumulative cohort revenue total column in ltv_v
- Custom `mv_refresh_log` table + email/webhook alerting
- `data_quality_exclusions` managed table
- Cohort grains beyond day/week/month

---

## Canonical refs added during discussion

None beyond what was already captured from ROADMAP.md / prior CONTEXT.md / existing migrations during the scout_codebase step. No new user-referenced docs or specs surfaced in the Q&A.

---

*End of discussion log.*
