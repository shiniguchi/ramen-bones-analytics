#!/usr/bin/env python3
"""Guard 8 — cron schedule overlap / cascade-gap check.

FND-11 (Phase 12): parses every .github/workflows/*.yml `schedule.cron`
string AND every `cron.schedule(...)` call in supabase/migrations/*.sql,
computes UTC + CET (UTC+1) + CEST (UTC+2) wall-clock times, asserts
(a) no two crons collide in either DST regime, and
(b) cascade ordering preserved with >=60-min gap between consecutive
    stages of the nightly cascade (external-data -> forecast-refresh ->
    pg_cron MV refresh).

Exit 0 on clean schedule, 1 on any violation. Markdown table to stdout
on failure, mirroring the schedule contract table in 12-CONTEXT.md D-12.

Stdlib only: pathlib, re, sys, argparse. NO pyyaml, NO croniter, NO
python-crontab. The supported cron format is the narrow 5-field form
used in this project: `M H D Mon DOW` where each field is a literal
integer or '*'. Multi-value (e.g. '0,30') and step (e.g. '*/5') forms
are TREATED AS WILDCARDS — the project does not use them in any current
cron string, and a permissive treatment errs on the side of skipping
the check (with a stderr warning) rather than crashing the guard.
"""
from __future__ import annotations
import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]  # scripts/ci-guards/check-cron-schedule.py -> repo root
GHA_DIR = REPO_ROOT / ".github" / "workflows"
MIG_DIR = REPO_ROOT / "supabase" / "migrations"

CASCADE_GAP_MIN = 60  # D-13 — minimum gap between consecutive cascade stages

# Cascade membership detection — these job-name substrings (lower-cased)
# identify cron entries that participate in the nightly cascade. ORDER
# MATTERS: a job whose name contains the FIRST entry must run BEFORE
# any job containing the SECOND entry, etc.
CASCADE_NAME_ORDER = [
    "external-data",                    # Phase 13 — fetches upstream data
    "forecast-refresh",                 # Phase 14 — Python forecast fits
    "refresh-analytics-mvs",            # Phase 14 / migration 0013 — pg_cron MV refresh
]


@dataclass
class CronEntry:
    source: str        # human-readable origin: "gha:its-validity-audit.yml" or "pg_cron:refresh-analytics-mvs"
    job_name: str      # lower-cased; the cascade detector matches against substrings of this
    cron: str          # the raw 5-field cron string
    minute: int        # parsed minute (literal int or -1 for wildcard)
    hour: int          # parsed hour
    dom: int           # parsed day-of-month (-1 for wildcard)
    month: int         # parsed month
    dow: int           # parsed day-of-week (0=Sunday in cron — but we don't compare DOW for daily crons)


# ----- parsing -----

def parse_cron(s: str) -> tuple[int, int, int, int, int] | None:
    """Parse a 5-field cron string. Returns (minute, hour, dom, month, dow)
    with each field either a literal int or -1 for '*'. Returns None on
    forms we don't support (multi-value, step, named DOW)."""
    parts = s.strip().split()
    if len(parts) != 5:
        return None
    out: list[int] = []
    for p in parts:
        if p == "*":
            out.append(-1)
        elif p.isdigit():
            out.append(int(p))
        else:
            # Multi-value, step, range, or named: not supported by this
            # narrow parser. Return None so the caller can warn + skip.
            return None
    return tuple(out)  # type: ignore[return-value]


GHA_CRON_RE = re.compile(
    r"-\s*cron:\s*['\"]([0-9*/, \-]+)['\"]",
    re.MULTILINE,
)

PG_CRON_RE = re.compile(
    r"cron\.schedule\(\s*'([^']+)'\s*,\s*'([0-9*/, \-]+)'",
    re.IGNORECASE | re.DOTALL,
)


def collect_gha_crons() -> list[CronEntry]:
    entries: list[CronEntry] = []
    if not GHA_DIR.is_dir():
        return entries
    for yml in sorted(GHA_DIR.glob("*.yml")):
        text = yml.read_text(encoding="utf-8")
        for cron_str in GHA_CRON_RE.findall(text):
            parsed = parse_cron(cron_str)
            if parsed is None:
                print(
                    f"check-cron-schedule: WARN: skipped unsupported cron "
                    f"'{cron_str}' in {yml.relative_to(REPO_ROOT)}",
                    file=sys.stderr,
                )
                continue
            entries.append(
                CronEntry(
                    source=f"gha:{yml.name}",
                    job_name=yml.stem.lower(),
                    cron=cron_str,
                    minute=parsed[0], hour=parsed[1],
                    dom=parsed[2], month=parsed[3], dow=parsed[4],
                )
            )
    return entries


def collect_pg_crons() -> list[CronEntry]:
    entries: list[CronEntry] = []
    if not MIG_DIR.is_dir():
        return entries
    for sql in sorted(MIG_DIR.glob("*.sql")):
        text = sql.read_text(encoding="utf-8")
        for job_name, cron_str in PG_CRON_RE.findall(text):
            parsed = parse_cron(cron_str)
            if parsed is None:
                print(
                    f"check-cron-schedule: WARN: skipped unsupported cron "
                    f"'{cron_str}' in {sql.relative_to(REPO_ROOT)}",
                    file=sys.stderr,
                )
                continue
            entries.append(
                CronEntry(
                    source=f"pg_cron:{job_name}",
                    job_name=job_name.lower(),
                    cron=cron_str,
                    minute=parsed[0], hour=parsed[1],
                    dom=parsed[2], month=parsed[3], dow=parsed[4],
                )
            )
    return entries


# ----- DST simulation -----

def utc_to_local_minutes(hour: int, minute: int, offset_hours: int) -> int:
    """Return wall-clock as minutes-from-midnight in the local timezone,
    or -1 if either hour or minute is a wildcard.

    A wildcard hour/minute means the cron fires every hour/minute — there
    is no single wall-clock slot to compare against. The detector treats
    this as a "skip" signal (caller must check for >=0 before comparing).
    Returning -1 (instead of 0 / midnight) avoids a false-positive collision
    between a wildcard-hour cron and a literal-midnight cron — they don't
    fire at the same wall-clock minute; one fires every hour, the other
    once a day at 00:00.

    Wraps around midnight via the % 24 on `hour + offset_hours`. We compare
    day-of-week separately for weekly crons; for daily crons (dow=-1) the
    wrap is fine because both crons wrap consistently.
    """
    if hour < 0 or minute < 0:
        return -1
    return ((hour + offset_hours) % 24) * 60 + minute


def detect_overlaps(entries: list[CronEntry]) -> list[str]:
    """Return list of human-readable violation strings for any two crons
    that fire at the same wall-clock minute in EITHER CET or CEST,
    considering also the day-of-week + day-of-month restrictions."""
    violations: list[str] = []
    for i in range(len(entries)):
        for j in range(i + 1, len(entries)):
            a, b = entries[i], entries[j]
            # Day-of-week filter: if both crons specify a DOW (not -1),
            # they only collide on shared DOWs. If either is daily
            # (dow=-1), they share every day. Same for DOM.
            if a.dow != -1 and b.dow != -1 and a.dow != b.dow:
                continue
            if a.dom != -1 and b.dom != -1 and a.dom != b.dom:
                continue
            if a.month != -1 and b.month != -1 and a.month != b.month:
                continue
            for label, off in (("CET", 1), ("CEST", 2)):
                a_loc = utc_to_local_minutes(a.hour, a.minute, off)
                b_loc = utc_to_local_minutes(b.hour, b.minute, off)
                # -1 = wildcard hour/minute; cannot compare wall-clock
                # collision against a literal time. Skip the pair.
                if a_loc < 0 or b_loc < 0:
                    continue
                if a_loc == b_loc:
                    violations.append(
                        f"OVERLAP: {a.source} ('{a.cron}') and "
                        f"{b.source} ('{b.cron}') both fire at "
                        f"{a_loc//60:02d}:{a_loc%60:02d} {label} "
                        f"(UTC+{off})"
                    )
    return violations


def detect_cascade_gap_violations(entries: list[CronEntry]) -> list[str]:
    """For each consecutive pair in CASCADE_NAME_ORDER that BOTH have a
    cron entry in the repo, assert local-time gap >=CASCADE_GAP_MIN in
    both CET and CEST."""
    violations: list[str] = []
    # Find at most one entry per cascade member by substring match.
    cascade: dict[str, CronEntry] = {}
    for member in CASCADE_NAME_ORDER:
        for e in entries:
            if member in e.job_name:
                # First match wins. If multiple workflows match the same
                # cascade member that's a different bug we surface here.
                if member in cascade:
                    violations.append(
                        f"CASCADE-AMBIGUOUS: multiple entries match "
                        f"cascade member '{member}': "
                        f"{cascade[member].source} and {e.source}"
                    )
                else:
                    cascade[member] = e
    # Walk consecutive pairs.
    for i in range(len(CASCADE_NAME_ORDER) - 1):
        prev_name = CASCADE_NAME_ORDER[i]
        next_name = CASCADE_NAME_ORDER[i + 1]
        prev = cascade.get(prev_name)
        next_ = cascade.get(next_name)
        if prev is None or next_ is None:
            # Phase 12: only the third cascade member ('refresh-analytics-mvs')
            # exists today. The first two land in Phase 13 + 14. Skipping is
            # correct — Guard 8 only enforces what is OBSERVED.
            continue
        for label, off in (("CET", 1), ("CEST", 2)):
            p_loc = utc_to_local_minutes(prev.hour, prev.minute, off)
            n_loc = utc_to_local_minutes(next_.hour, next_.minute, off)
            # -1 = wildcard; cascade gap is undefined when a stage runs at
            # every hour/minute. Skip rather than raise a misleading violation.
            if p_loc < 0 or n_loc < 0:
                continue
            gap = (n_loc - p_loc) % (24 * 60)  # next-day wrap if needed
            if gap < CASCADE_GAP_MIN:
                violations.append(
                    f"CASCADE-GAP: {prev.source} ({p_loc//60:02d}:{p_loc%60:02d} {label}) "
                    f"-> {next_.source} ({n_loc//60:02d}:{n_loc%60:02d} {label}) "
                    f"is only {gap} min, below required {CASCADE_GAP_MIN} min"
                )
    return violations


# ----- output -----

def _fmt_local(t: int) -> str:
    """Render minutes-from-midnight as HH:MM, or '*:*' for wildcard sentinel (-1)."""
    if t < 0:
        return "*:*"
    return f"{t//60:02d}:{t%60:02d}"


def render_markdown_table(entries: list[CronEntry]) -> str:
    lines = [
        "| Source | Cron (UTC) | CET (UTC+1) | CEST (UTC+2) |",
        "|---|---|---|---|",
    ]
    for e in sorted(entries, key=lambda x: (x.hour if x.hour >= 0 else 99, x.minute if x.minute >= 0 else 99, x.source)):
        cet = utc_to_local_minutes(e.hour, e.minute, 1)
        cest = utc_to_local_minutes(e.hour, e.minute, 2)
        lines.append(
            f"| {e.source} | `{e.cron}` | {_fmt_local(cet)} | {_fmt_local(cest)} |"
        )
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Guard 8 — cron schedule overlap / cascade-gap check (FND-11).",
    )
    parser.add_argument(
        "--print-table",
        action="store_true",
        help="Always print the markdown table of detected schedules to "
        "stdout, even on success. Useful for local debugging.",
    )
    args = parser.parse_args()

    entries = collect_gha_crons() + collect_pg_crons()

    violations: list[str] = []
    violations += detect_overlaps(entries)
    violations += detect_cascade_gap_violations(entries)

    if violations:
        print("::error::Guard 8 (cron-schedule) FAILED: overlap or cascade-gap violation")
        print()
        print(render_markdown_table(entries))
        print()
        for v in violations:
            print(f"  - {v}")
        return 1

    if args.print_table:
        print(render_markdown_table(entries))
    print(f"Guard 8 (cron-schedule): clean ({len(entries)} cron entries scanned)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
