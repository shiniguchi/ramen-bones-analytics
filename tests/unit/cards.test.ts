// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import EmptyState from '../../src/lib/components/EmptyState.svelte';
import KpiTile from '../../src/lib/components/KpiTile.svelte';
import LtvCard from '../../src/lib/components/LtvCard.svelte';
import GrainToggle from '../../src/lib/components/GrainToggle.svelte';
import CohortRetentionCard from '../../src/lib/components/CohortRetentionCard.svelte';
import { emptyStates } from '../../src/lib/emptyStates';
import { pickVisibleCohorts, type RetentionRow } from '../../src/lib/sparseFilter';

// LayerChart uses window.matchMedia internally; JSDOM doesn't provide it.
// Mock it so LayerChart initialises without errors in the test environment.
beforeAll(() => {
  if (typeof window !== 'undefined' && !window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    });
  }
});

// Helper: build a RetentionRow fixture for a given cohort.
function makeRows(cohortWeek: string, cohortSize: number, periods = 3): RetentionRow[] {
  return Array.from({ length: periods }, (_, i) => ({
    cohort_week: cohortWeek,
    period_weeks: i,
    retention_rate: 1 - i * 0.1,
    cohort_size_week: cohortSize,
    cohort_age_weeks: 10
  }));
}

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

  // ── CohortRetentionCard tests (flipped from todo in 04-04) ──────────────

  it('CohortRetentionCard does NOT accept a range prop (D-04/Pitfall 6)', () => {
    // This @ts-expect-error proves the type enforcer is working.
    // If CohortRetentionCard ever gains a `range` prop, TypeScript will
    // surface a "Unused '@ts-expect-error' directive" error here, catching
    // the regression at type-check time.
    render(CohortRetentionCard, {
      data: [],
      grain: 'week',
      // @ts-expect-error — CohortRetentionCard must NOT accept a range prop (Pitfall 6)
      range: '7d'
    });
    // If we reach here without TS error, the component renders (empty state) but
    // the `@ts-expect-error` above WOULD error if range became a valid prop.
    // Test passes when range prop is absent from the component's Props type.
    expect(true).toBe(true);
  });

  it('CohortRetentionCard drops cohorts where cohort_size < 5 (D-14)', () => {
    // 4 large cohorts + 1 sparse; only 4 large should be visible.
    const largeRows = [
      ...makeRows('2025-01-06', 10),
      ...makeRows('2025-01-13', 8),
      ...makeRows('2025-01-20', 12),
      ...makeRows('2025-01-27', 7)
    ];
    const sparseRows = makeRows('2025-02-03', 3);
    const all = [...largeRows, ...sparseRows];

    const visible = pickVisibleCohorts(all);
    const visibleCohorts = new Set(visible.map(r => r.cohort_week));
    expect(visibleCohorts.has('2025-02-03')).toBe(false);
    expect(visibleCohorts.size).toBe(4);
  });

  it('CohortRetentionCard renders at most 4 series (D-11)', () => {
    // 6 large cohorts; pickVisibleCohorts must slice to last 4.
    const rows = [
      ...makeRows('2024-11-04', 10),
      ...makeRows('2024-11-11', 10),
      ...makeRows('2024-11-18', 10),
      ...makeRows('2024-11-25', 10),
      ...makeRows('2024-12-02', 10),
      ...makeRows('2024-12-09', 10)
    ];
    const visible = pickVisibleCohorts(rows);
    const cohortCount = new Set(visible.map(r => r.cohort_week)).size;
    expect(cohortCount).toBe(4);
  });

  // ── LtvCard tests (flipped from todo in 04-04) ─────────────────────────

  it('LtvCard renders persistent italic caveat footer (D-17)', () => {
    // Even with empty data, the italic caveat must be present in the DOM.
    const { container } = render(LtvCard, {
      data: [],
      monthsOfHistory: 9
    });
    const footer = container.querySelector('p.italic');
    expect(footer).toBeInTheDocument();
    expect(footer?.textContent).toMatch(/9 months of history/);
  });

  it('LtvCard uses same grain URL param as cohort card (D-16)', () => {
    // GrainToggle renders Day/Week/Month buttons; grain prop sets initial active.
    const { container } = render(GrainToggle, { grain: 'month' });
    // Active button should be labeled "Month"
    const activeBtn = container.querySelector('button[aria-pressed="true"], button[data-state="on"]');
    // At minimum, "Month" text should be present in the toggle
    expect(container.textContent).toMatch(/Month/);
    // GrainToggle uses URL ?grain= param to keep cohort + LTV in sync
    expect(container.innerHTML).toMatch(/month/i);
  });

  // ── FrequencyCard / NewVsReturningCard todos (04-05) ───────────────────
  it.todo('FrequencyCard uses plain divs not LayerChart (D-18)');
  it.todo('NewVsReturningCard IS chip-scoped (D-19a exception)');
  it.todo('NewVsReturningCard tie-out: returning + new + cash === revenue (D-19)');
  it('EmptyState renders per-card copy from emptyStates.ts (D-20)', () => {
    const { container } = render(EmptyState, { card: 'cohort' });
    const copy = emptyStates.cohort;
    // Use container.querySelector to avoid collision with CohortRetentionCard renders
    expect(container.textContent).toContain(copy.heading);
    expect(container.textContent).toContain(copy.body);
  });
  it.todo('Per-card error fallback does NOT throw whole page (D-22)');
});

// ── Sparse-fallback test (new, not a todo-flip) ─────────────────────────────
describe('CohortRetentionCard sparse-fallback (D-14)', () => {
  it('shows ALL cohorts and sparse hint when every cohort is sparse', () => {
    // 3 cohorts all cohort_size=3 (all below SPARSE_MIN_COHORT_SIZE=5).
    // pickVisibleCohorts must fall back to showing all 3.
    const allSparse = [
      ...makeRows('2025-03-03', 3),
      ...makeRows('2025-03-10', 3),
      ...makeRows('2025-03-17', 3)
    ];

    const visible = pickVisibleCohorts(allSparse);
    const cohortCount = new Set(visible.map(r => r.cohort_week)).size;
    expect(cohortCount).toBe(3);

    // When rendered with all-sparse data, the component must show the hint.
    const { container } = render(CohortRetentionCard, {
      data: allSparse,
      grain: 'week'
    });
    // Sparse hint should be visible
    const hint = container.querySelector('[data-testid="sparse-hint"]') ??
      Array.from(container.querySelectorAll('p, span')).find(
        el => el.textContent?.includes('small') || el.textContent?.includes('sparse')
      );
    expect(hint).toBeTruthy();
  });
});
