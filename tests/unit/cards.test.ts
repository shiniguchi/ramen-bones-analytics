import { describe, it } from 'vitest';

describe('Phase 4 card components (RED stubs — flip to it() as cards land)', () => {
  it.todo('KpiTile renders integer EUR with thousands separator (D-09)');
  it.todo('KpiTile renders ▲ +12% delta in green-700 for positive (D-08)');
  it.todo('KpiTile renders ▼ -8% delta in red-700 for negative (D-08)');
  it.todo('KpiTile shows "— no prior data" gray when prior window zero (D-08)');
  it.todo('FreshnessLabel muted <=30h, yellow >30h, red >48h (D-10a)');
  it.todo('CohortRetentionCard does NOT accept a range prop (D-04/Pitfall 6)');
  it.todo('CohortRetentionCard drops cohorts where cohort_size < 5 (D-14)');
  it.todo('CohortRetentionCard renders at most 4 series (D-11)');
  it.todo('LtvCard renders persistent italic caveat footer (D-17)');
  it.todo('LtvCard uses same grain URL param as cohort card (D-16)');
  it.todo('FrequencyCard uses plain divs not LayerChart (D-18)');
  it.todo('NewVsReturningCard IS chip-scoped (D-19a exception)');
  it.todo('NewVsReturningCard tie-out: returning + new + cash === revenue (D-19)');
  it.todo('EmptyState renders per-card copy from emptyStates.ts (D-20)');
  it.todo('Per-card error fallback does NOT throw whole page (D-22)');
});
