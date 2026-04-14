// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import EmptyState from '../../src/lib/components/EmptyState.svelte';
import KpiTile from '../../src/lib/components/KpiTile.svelte';
import { emptyStates } from '../../src/lib/emptyStates';

describe('Phase 4 card components (RED stubs — flip to it() as cards land)', () => {
  // ── KpiTile tests (flipped from todo in 04-03) ──────────────────────────
  it('KpiTile renders integer EUR with thousands separator (D-09)', () => {
    // 428000 cents = €4.280 in de-DE locale (dot as thousands separator)
    render(KpiTile, {
      title: 'Revenue · 7d',
      value: 428000,
      prior: 382000,
      format: 'eur-int',
      windowLabel: 'prior 7d',
      emptyCard: 'revenueFixed'
    });
    // de-DE formats 4280 EUR as "4.280 €" (dot thousands, space before €)
    const num = screen.getByText(/4[\.,]280/);
    expect(num).toBeInTheDocument();
  });

  it('KpiTile renders ▲ +12% delta in green-700 for positive (D-08)', () => {
    // value=428000, prior=382000 → pct = round((428000-382000)/382000 * 100) = round(12.04) = 12
    const { container } = render(KpiTile, {
      title: 'Revenue · 7d',
      value: 428000,
      prior: 382000,
      format: 'eur-int',
      windowLabel: 'prior 7d',
      emptyCard: 'revenueFixed'
    });
    // Query within this render's container to avoid collision with prior renders
    const delta = container.querySelector('p.text-green-700');
    expect(delta).toBeInTheDocument();
    expect(delta?.textContent).toMatch(/▲.*\+12%/);
    expect(delta).toHaveClass('text-green-700');
  });

  it('KpiTile renders ▼ −8% delta in red-700 for negative (D-08)', () => {
    // value=352000, prior=382000 → pct = round((352000-382000)/382000 * 100) = round(-7.85) = -8
    render(KpiTile, {
      title: 'Revenue · 7d',
      value: 352000,
      prior: 382000,
      format: 'eur-int',
      windowLabel: 'prior 7d',
      emptyCard: 'revenueFixed'
    });
    // Uses real U+2212 minus sign
    const delta = screen.getByText(/▼.*8%/);
    expect(delta).toBeInTheDocument();
    expect(delta).toHaveClass('text-red-700');
  });

  it('KpiTile shows "— no prior data" gray when prior window zero (D-08)', () => {
    render(KpiTile, {
      title: 'Transactions',
      value: 150,
      prior: 0,
      format: 'int',
      windowLabel: 'prior 7d',
      emptyCard: 'revenueChip'
    });
    const noData = screen.getByText(/— no prior data/);
    expect(noData).toBeInTheDocument();
    expect(noData).toHaveClass('text-zinc-500');
  });
  it.todo('FreshnessLabel muted <=30h, yellow >30h, red >48h (D-10a)');
  it.todo('CohortRetentionCard does NOT accept a range prop (D-04/Pitfall 6)');
  it.todo('CohortRetentionCard drops cohorts where cohort_size < 5 (D-14)');
  it.todo('CohortRetentionCard renders at most 4 series (D-11)');
  it.todo('LtvCard renders persistent italic caveat footer (D-17)');
  it.todo('LtvCard uses same grain URL param as cohort card (D-16)');
  it.todo('FrequencyCard uses plain divs not LayerChart (D-18)');
  it.todo('NewVsReturningCard IS chip-scoped (D-19a exception)');
  it.todo('NewVsReturningCard tie-out: returning + new + cash === revenue (D-19)');
  it('EmptyState renders per-card copy from emptyStates.ts (D-20)', () => {
    render(EmptyState, { card: 'cohort' });
    const copy = emptyStates.cohort;
    expect(screen.getByText(copy.heading)).toBeInTheDocument();
    expect(screen.getByText(copy.body)).toBeInTheDocument();
  });
  it.todo('Per-card error fallback does NOT throw whole page (D-22)');
});
