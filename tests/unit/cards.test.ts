// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import EmptyState from '../../src/lib/components/EmptyState.svelte';
import FreshnessLabel from '../../src/lib/components/FreshnessLabel.svelte';
import KpiTile from '../../src/lib/components/KpiTile.svelte';
import GrainToggle from '../../src/lib/components/GrainToggle.svelte';
import CohortRetentionCard from '../../src/lib/components/CohortRetentionCard.svelte';
import { emptyStates } from '../../src/lib/emptyStates';
import { messages as i18nMessages } from '../../src/lib/i18n/messages';
const messagesEn = i18nMessages.en;
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

  it('FreshnessLabel muted <=24h, yellow >24h, red >30h (D-10a / BCK-08)', () => {
    // Muted (<=24h): 10 hours ago
    const recent = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString();
    const { container: c1 } = render(FreshnessLabel, { lastIngestedAt: recent });
    const p1 = c1.querySelector('p');
    expect(p1).toHaveClass('text-zinc-500');
    expect(p1?.textContent).toMatch(/Last updated/);

    // Yellow (>24h): 26 hours ago
    const stale = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
    const { container: c2 } = render(FreshnessLabel, { lastIngestedAt: stale });
    const p2 = c2.querySelector('p');
    expect(p2).toHaveClass('text-yellow-600');

    // Red (>30h): 32 hours ago
    const veryStale = new Date(Date.now() - 32 * 60 * 60 * 1000).toISOString();
    const { container: c3 } = render(FreshnessLabel, { lastIngestedAt: veryStale });
    const p3 = c3.querySelector('p');
    expect(p3).toHaveClass('text-red-600');
    expect(p3?.textContent).toMatch(/data may be outdated/);
  });

  it('FreshnessLabel BCK-08 boundary: yellow at 25h', () => {
    // Was gray at 25h under old >30h threshold; now yellow under >24h
    const stale25h = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const { container } = render(FreshnessLabel, { lastIngestedAt: stale25h });
    const p = container.querySelector('p');
    expect(p).toHaveClass('text-yellow-600');
  });

  it('FreshnessLabel BCK-08 boundary: red at 31h', () => {
    // Was yellow at 31h under old >48h threshold; now red under >30h
    const stale31h = new Date(Date.now() - 31 * 60 * 60 * 1000).toISOString();
    const { container } = render(FreshnessLabel, { lastIngestedAt: stale31h });
    const p = container.querySelector('p');
    expect(p).toHaveClass('text-red-600');
  });

  it('FreshnessLabel BCK-08 boundary: muted at 23h (under 24h threshold)', () => {
    const fresh23h = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString();
    const { container } = render(FreshnessLabel, { lastIngestedAt: fresh23h });
    const p = container.querySelector('p');
    expect(p).toHaveClass('text-zinc-500');
    expect(p).not.toHaveClass('text-yellow-600');
    expect(p).not.toHaveClass('text-red-600');
  });

  // ── CohortRetentionCard tests (flipped from todo in 04-04) ──────────────

  it('CohortRetentionCard does NOT accept a range prop (D-04/Pitfall 6)', () => {
    // This @ts-expect-error proves the type enforcer is working.
    // If CohortRetentionCard ever gains a `range` prop, TypeScript will
    // surface a "Unused '@ts-expect-error' directive" error here, catching
    // the regression at type-check time.
    render(CohortRetentionCard, {
      props: {
        dataWeekly: [],
        dataMonthly: [],
        // @ts-expect-error — CohortRetentionCard must NOT accept a range prop (Pitfall 6)
        range: '7d'
      }
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

  it('CohortRetentionCard renders at most MAX_COHORT_LINES series (D-11)', () => {
    // quick-260418-28j Pass 2: cap raised from 4 to 12. With 6 large cohorts,
    // all 6 are visible (under the 12 cap). Check tests/unit/sparseFilter.test.ts
    // for the 20-cohort → 12 assertion that exercises the cap.
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
    expect(cohortCount).toBe(6);
  });

  it('EmptyState renders per-card copy from emptyStates.ts (D-20)', () => {
    const { container } = render(EmptyState, { card: 'cohort' });
    // After i18n migration emptyStates exposes *Key fields that resolve via
    // messages.ts. Resolve through the default-locale (en) dictionary here
    // so the test stays hermetic and doesn't depend on `page.data.locale`.
    const copy = emptyStates.cohort;
    const en = messagesEn;
    expect(container.textContent).toContain(en[copy.headingKey]);
    expect(container.textContent).toContain(en[copy.bodyKey]);
  });
  it('Per-card error fallback does NOT throw whole page (D-22)', () => {
    // KpiTile with value=null must render EmptyState, not throw.
    expect(() => {
      const { container } = render(KpiTile, {
        title: 'Revenue · 7d',
        value: null,
        prior: null,
        format: 'eur-int',
        windowLabel: null,
        emptyCard: 'revenueFixed'
      });
      // EmptyState should be in the DOM (heading text from emptyStates.revenueFixed)
      const copy = emptyStates.revenueFixed;
      expect(container.textContent).toContain(messagesEn[copy.headingKey]);
    }).not.toThrow();
  });
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
      props: { dataWeekly: allSparse, dataMonthly: [] }
    });
    // Sparse hint should be visible
    const hint = container.querySelector('[data-testid="sparse-hint"]') ??
      Array.from(container.querySelectorAll('p, span')).find(
        el => el.textContent?.includes('small') || el.textContent?.includes('sparse')
      );
    expect(hint).toBeTruthy();
  });
});
