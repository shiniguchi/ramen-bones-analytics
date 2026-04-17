// quick-260418-28j Pass 2: tests for new retention-axis caps and 12-line palette.
// RED→GREEN: written before sparseFilter.ts exports MAX_PERIOD_* / MAX_COHORT_LINES
// and chartPalettes.ts exports COHORT_LINE_PALETTE.
import { describe, it, expect } from 'vitest';
import {
  MAX_PERIOD_WEEKS,
  MAX_PERIOD_MONTHS,
  MAX_COHORT_LINES,
  SPARSE_MIN_COHORT_SIZE,
  pickVisibleCohorts,
  type RetentionRow
} from '../../src/lib/sparseFilter';
import { COHORT_LINE_PALETTE } from '../../src/lib/chartPalettes';

describe('constants', () => {
  it('MAX_PERIOD_WEEKS === 52 (caps the retention chart x-axis on day/week grain)', () => {
    expect(MAX_PERIOD_WEEKS).toBe(52);
  });

  it('MAX_PERIOD_MONTHS === 12 (caps the retention chart x-axis on month grain)', () => {
    expect(MAX_PERIOD_MONTHS).toBe(12);
  });

  it('MAX_COHORT_LINES === 12 (up from the old hard-coded 4)', () => {
    expect(MAX_COHORT_LINES).toBe(12);
  });
});

describe('pickVisibleCohorts respects MAX_COHORT_LINES', () => {
  it('returns the last 12 cohorts when 20 non-sparse cohorts are provided', () => {
    // Build 20 cohorts, each with a single period_weeks=0 row and cohort_size_week=10
    // (safely above SPARSE_MIN_COHORT_SIZE). Ordered Monday-aligned dates so .sort()
    // lines up with intended chronological order.
    const fixture: RetentionRow[] = Array.from({ length: 20 }, (_, i) => {
      const month = String((i % 12) + 1).padStart(2, '0');
      const day = String(((i % 28) + 1)).padStart(2, '0');
      const year = 2024 + Math.floor(i / 12);
      const cohort_week = `${year}-${month}-${day}`;
      return {
        cohort_week,
        period_weeks: 0,
        retention_rate: 1,
        cohort_size_week: 10, // > SPARSE_MIN_COHORT_SIZE
        cohort_age_weeks: 10
      };
    });

    const visible = pickVisibleCohorts(fixture);
    const uniqueCohorts = new Set(visible.map((r) => r.cohort_week));
    expect(uniqueCohorts.size).toBe(MAX_COHORT_LINES); // 12, not 4
  });

  it('keeps the sparse fallback: if all cohorts are below min size, show all up to MAX_COHORT_LINES', () => {
    const fixture: RetentionRow[] = Array.from({ length: 3 }, (_, i) => ({
      cohort_week: `2026-01-${String(i + 6).padStart(2, '0')}`,
      period_weeks: 0,
      retention_rate: 1,
      cohort_size_week: SPARSE_MIN_COHORT_SIZE - 1,
      cohort_age_weeks: 2
    }));
    const visible = pickVisibleCohorts(fixture);
    expect(new Set(visible.map((r) => r.cohort_week)).size).toBe(3);
  });
});

describe('COHORT_LINE_PALETTE', () => {
  it('is exactly 12 hex colors', () => {
    expect(COHORT_LINE_PALETTE.length).toBe(12);
  });

  it('each entry is a valid 6-digit hex color', () => {
    for (const c of COHORT_LINE_PALETTE) {
      expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('all entries are unique', () => {
    expect(new Set(COHORT_LINE_PALETTE).size).toBe(COHORT_LINE_PALETTE.length);
  });
});
