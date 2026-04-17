// Phase 10 Plan 01 — Nyquist RED scaffold for CohortRetentionCard weekly-clamp hint (D-17).
// Per RESEARCH.md Open Question 2, the hint is OPTIONAL — tests are left as
// it.todo stubs intentionally. If plan 10-07 picks up this hint, these stubs
// will be converted to real assertions; otherwise they remain documented TODOs.
import { describe, it } from 'vitest';

describe('CohortRetentionCard weekly-clamp hint (D-17)', () => {
  it.todo('shows "Cohort view shows weekly" hint when global grain=day');
  it.todo('omits hint when grain=week (clamp is no-op — only day/month trigger hint)');
});
