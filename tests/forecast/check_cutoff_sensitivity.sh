#!/usr/bin/env bash
# tests/forecast/check_cutoff_sensitivity.sh
# Asserts cutoff_sensitivity.md (Phase 16 D-13 / UPL-02) is well-formed:
#  - 5 model rows present (one per BAU model)
#  - "Sensitivity ratio" methodology section is present
#  - sarimax + prophet ratios parse to floats and land in [0.8, 1.25]
#    (other models may FAIL or sign-flip — informational only per CONTEXT.md)
#
# Exits non-zero on a structural failure or a sarimax/prophet ratio outside
# [0.8, 1.25]. Per CONTEXT.md the band is the headline robustness statistic.

set -uo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
LOG="$REPO/tests/forecast/cutoff_sensitivity.md"

if [ ! -f "$LOG" ]; then
  echo "FAIL: $LOG not found"; exit 1
fi

# Check 5 model rows
rows=$(grep -cE "^\| (sarimax|prophet|ets|theta|naive_dow)" "$LOG")
if [ "$rows" -lt 5 ]; then
  echo "FAIL: expected 5 model rows, got $rows"; exit 1
fi

# Check Sensitivity ratio language present
if ! grep -q "Sensitivity ratio" "$LOG"; then
  echo "FAIL: 'Sensitivity ratio' methodology section missing"; exit 1
fi

# Parse sarimax + prophet ratios from the 5×3 grid's "Ratio (-14/-7)" column
# (8th cell). Headline acceptance band: [0.8, 1.25]. Other models are
# informational only per CONTEXT.md.
/usr/bin/env python3 - "$LOG" <<'PYEOF'
import re, sys, pathlib

text = pathlib.Path(sys.argv[1]).read_text()
required = ['sarimax', 'prophet']
band_lo, band_hi = 0.8, 1.25

errors = []
warnings = []

for model in required:
    # Grid row: | model | -14d uplift | -14d CI | -7d uplift | -7d CI |
    #          | -1d uplift | -1d CI | ratio | verdict |
    m = re.search(rf'^\|\s*{model}\s+\|.*$', text, flags=re.MULTILINE)
    if not m:
        errors.append(f'FAIL: row for {model} missing in 5x3 grid')
        continue
    cells = [c.strip() for c in m.group(0).strip('|').split('|')]
    if len(cells) < 9:
        errors.append(f'FAIL: {model} grid row has {len(cells)} cells, need >=9')
        continue
    ratio_str = cells[7]
    try:
        ratio = float(ratio_str)
    except ValueError:
        errors.append(f'FAIL: {model} ratio cell {ratio_str!r} is not numeric')
        continue
    if not (band_lo <= ratio <= band_hi):
        errors.append(
            f'FAIL: {model} ratio {ratio} outside [{band_lo}, {band_hi}] band — '
            f'anticipation effects propagate beyond -7d (RESEARCH §2 Pitfall 2.2)'
        )
    else:
        warnings.append(f'OK: {model} ratio {ratio} in band [{band_lo}, {band_hi}]')

for w in warnings:
    print(w)
for e in errors:
    print(e, file=sys.stderr)

sys.exit(0 if not errors else 1)
PYEOF

if [ $? -ne 0 ]; then
  echo "FAIL: cutoff_sensitivity.md sarimax/prophet ratio band check failed"
  exit 1
fi

echo "PASS: cutoff_sensitivity.md well-formed; sarimax+prophet ratios in [0.8, 1.25]"
exit 0
