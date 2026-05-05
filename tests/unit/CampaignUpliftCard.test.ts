// @vitest-environment jsdom
// tests/unit/CampaignUpliftCard.test.ts
// Phase 16 Plan 09 Task 1 — RED contract tests for the new dashboard card.
// Pattern mirrors InvoiceCountForecastCard.test.ts (15-15): the card
// self-fetches /api/campaign-uplift via clientFetch on mount; we hoist a
// spy so the $effect resolves the fixture synchronously inside render().
//
// File-location deviation from the PLAN: the plan specifies a colocated
// `src/lib/components/CampaignUpliftCard.test.ts` path, but the vitest config
// include glob is `tests/unit/**/*.test.ts`. All sibling component tests
// live in tests/unit/, and the convention is well-established. Documenting
// the deviation in 16-09-SUMMARY.md.
//
// Tests labelled `layerchart_contract` and `tooltip_snippet_contract` /
// `touch_events_contract` are the source-text assertions that the plan's
// VALIDATION.md row 16-09-02 references.
import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ----- Hoisted clientFetch spy + fixture (vi.mock is top-hoisted) -----
const { clientFetchSpy, FIXTURE_HEADLINE_NORMAL, FIXTURE_HEADLINE_ZERO_OVERLAP, FIXTURE_DIVERGENCE, FIXTURE_EMPTY } = vi.hoisted(() => {
  const baseHeadlineRow = {
    model_name: 'sarimax',
    window_kind: 'cumulative_since_launch' as const,
    cumulative_uplift_eur: 1500,
    ci_lower_eur: 200,
    ci_upper_eur: 2800,
    naive_dow_uplift_eur: 1320,
    n_days: 7,
    as_of_date: '2026-04-21'
  };
  const dailyTrajectory = [
    { date: '2026-04-14', cumulative_uplift_eur: 200, ci_lower_eur: -50, ci_upper_eur: 450 },
    { date: '2026-04-15', cumulative_uplift_eur: 600, ci_lower_eur: 100, ci_upper_eur: 1100 },
    { date: '2026-04-16', cumulative_uplift_eur: 850, ci_lower_eur: 150, ci_upper_eur: 1550 },
    { date: '2026-04-17', cumulative_uplift_eur: 1100, ci_lower_eur: 180, ci_upper_eur: 2020 },
    { date: '2026-04-18', cumulative_uplift_eur: 1240, ci_lower_eur: 200, ci_upper_eur: 2280 },
    { date: '2026-04-19', cumulative_uplift_eur: 1380, ci_lower_eur: 200, ci_upper_eur: 2560 },
    { date: '2026-04-20', cumulative_uplift_eur: 1450, ci_lower_eur: 200, ci_upper_eur: 2700 },
    { date: '2026-04-21', cumulative_uplift_eur: 1500, ci_lower_eur: 200, ci_upper_eur: 2800 }
  ];

  const FIXTURE_HEADLINE_NORMAL = {
    campaign_start: '2026-04-14',
    cumulative_deviation_eur: 1500,
    as_of: '2026-05-03',
    model: 'sarimax',
    ci_lower_eur: 200,
    ci_upper_eur: 2800,
    naive_dow_uplift_eur: 1320,
    daily: dailyTrajectory,
    campaigns: [
      {
        campaign_id: 'friend-2026-04-14',
        start_date: '2026-04-14',
        end_date: '2026-04-21',
        name: 'Friend Instagram Push',
        channel: 'instagram',
        rows: [baseHeadlineRow]
      }
    ]
  };

  const FIXTURE_HEADLINE_ZERO_OVERLAP = {
    ...FIXTURE_HEADLINE_NORMAL,
    cumulative_deviation_eur: 100,
    ci_lower_eur: -300,
    ci_upper_eur: 500,
    naive_dow_uplift_eur: 80,
    campaigns: [
      {
        ...FIXTURE_HEADLINE_NORMAL.campaigns[0],
        rows: [
          {
            ...baseHeadlineRow,
            cumulative_uplift_eur: 100,
            ci_lower_eur: -300,
            ci_upper_eur: 500,
            naive_dow_uplift_eur: 80
          }
        ]
      }
    ]
  };

  const FIXTURE_DIVERGENCE = {
    ...FIXTURE_HEADLINE_NORMAL,
    cumulative_deviation_eur: 500,
    naive_dow_uplift_eur: -200,
    campaigns: [
      {
        ...FIXTURE_HEADLINE_NORMAL.campaigns[0],
        rows: [
          {
            ...baseHeadlineRow,
            cumulative_uplift_eur: 500,
            naive_dow_uplift_eur: -200
          }
        ]
      }
    ]
  };

  const FIXTURE_EMPTY = {
    campaign_start: null,
    cumulative_deviation_eur: 0,
    as_of: '2026-05-03',
    model: 'sarimax',
    ci_lower_eur: null,
    ci_upper_eur: null,
    naive_dow_uplift_eur: null,
    daily: [],
    campaigns: []
  };

  // Shared mutable holder so individual tests can swap the fixture.
  // The default points to the normal fixture; each test sets activeFixture
  // before calling render().
  const activeFixture = { current: FIXTURE_HEADLINE_NORMAL as unknown };
  const clientFetchSpy = vi.fn(async (url: string) => {
    if (!url.includes('/api/campaign-uplift')) {
      throw new Error(`Expected /api/campaign-uplift URL, got: ${url}`);
    }
    return activeFixture.current;
  });
  // Expose the holder so describe blocks can mutate.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (clientFetchSpy as any).__activeFixture = activeFixture;

  return { clientFetchSpy, FIXTURE_HEADLINE_NORMAL, FIXTURE_HEADLINE_ZERO_OVERLAP, FIXTURE_DIVERGENCE, FIXTURE_EMPTY };
});

vi.mock('$lib/clientFetch', () => ({
  clientFetch: clientFetchSpy
}));

import CampaignUpliftCard from '../../src/lib/components/CampaignUpliftCard.svelte';

afterEach(() => {
  cleanup();
  // Reset to the normal fixture between tests so test order doesn't bleed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (clientFetchSpy as any).__activeFixture.current = FIXTURE_HEADLINE_NORMAL;
});

beforeAll(() => {
  if (typeof window !== 'undefined' && !window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((q: string) => ({
        matches: false, media: q, onchange: null,
        addListener: vi.fn(), removeListener: vi.fn(),
        addEventListener: vi.fn(), removeEventListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    });
  }
  if (typeof window !== 'undefined' && !('IntersectionObserver' in window)) {
    // @ts-expect-error — test stub
    window.IntersectionObserver = class {
      observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
    };
  }
});

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const SOURCE_PATH = resolve(__dirname, '../../src/lib/components/CampaignUpliftCard.svelte');
function readSource(): string {
  return readFileSync(SOURCE_PATH, 'utf8');
}

describe('CampaignUpliftCard', () => {
  it('shows hero number when CI does not overlap zero', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (clientFetchSpy as any).__activeFixture.current = FIXTURE_HEADLINE_NORMAL;
    const { container } = render(CampaignUpliftCard);
    await flush();
    const text = container.textContent ?? '';
    expect(text).toMatch(/€\s?1[.,]?500/);
    expect(text).not.toMatch(/CI overlaps zero/);
  });

  it('shows plain-language hero + isCIOverlap testid when CI overlaps zero (UPL-06 — 16.1-03 D-05..D-12)', async () => {
    // 16.1-03 replaced the "CI overlaps zero — no detectable lift" jargon with a
    // tier-aware plain-language hero. n_days=7 → tier='early' → heroKey='uplift_hero_too_early'.
    // The dim-point-estimate testid still exists, but moved inside the {#if detailsOpen} disclosure
    // panel — not visible by default. The hero element gets data-testid="hero-ci-overlaps" when
    // isCIOverlap (CI bounds straddle zero).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (clientFetchSpy as any).__activeFixture.current = FIXTURE_HEADLINE_ZERO_OVERLAP;
    const { container } = render(CampaignUpliftCard);
    await flush();
    const text = container.textContent ?? '';
    // Plain-language hero (early-tier copy, locale=en default).
    expect(text).toMatch(/Too early to tell/);
    // CI-overlap testid present (early branch always hero-ci-overlaps when CI straddles zero OR cum=0).
    expect(container.querySelector('[data-testid="hero-ci-overlaps"]')).not.toBeNull();
    // Old jargon is GONE from the visible read.
    expect(text).not.toMatch(/CI overlaps zero — no detectable lift/);
    // Statistical detail lives inside the disclosure panel — not visible by default.
    expect(container.querySelector('[data-testid="dim-point-estimate"]')).toBeNull();
    expect(container.querySelector('[data-testid="uplift-details-panel"]')).toBeNull();
    // Disclosure trigger is present so the user CAN reveal the statistical line.
    const trigger = container.querySelector('[data-testid="uplift-details-trigger"]');
    expect(trigger).not.toBeNull();
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
  });

  it('layerchart_contract — sparkline uses Spline + Area at fill-opacity 0.06', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (clientFetchSpy as any).__activeFixture.current = FIXTURE_HEADLINE_NORMAL;
    const { container } = render(CampaignUpliftCard);
    await flush();
    const paths = container.querySelectorAll('svg path');
    // Expect at least an Area (CI band) + Spline (cumulative line) = 2 paths.
    expect(paths.length).toBeGreaterThanOrEqual(2);
    const opacityHit = Array.from(paths).some(
      (p) => p.getAttribute('fill-opacity') === '0.06' || p.getAttribute('fill-opacity') === '.06'
    );
    expect(opacityHit).toBe(true);
  });

  it('tooltip_snippet_contract — Tooltip.Root uses {#snippet children(...)} not let:data (Svelte 5 runtime)', () => {
    const src = readSource();
    expect(src).toMatch(/\{#snippet children\(/);
    expect(src).not.toMatch(/let:data/);
  });

  it("touch_events_contract — Chart wrapper sets touchEvents: 'auto' (mobile horizontal-scroll fix)", () => {
    const src = readSource();
    expect(src).toMatch(/touchEvents:\s*['"]auto['"]/);
  });

  it('shows plain-language CF computing message when campaigns array is empty (RESEARCH §4 empty-state — 16.1-03 plain copy)', async () => {
    // 16.1-03 replaced the jargon "Counterfactual is computing" with the friendly
    // "We're still calculating — first result lands tomorrow morning" (uplift_card_computing key).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (clientFetchSpy as any).__activeFixture.current = FIXTURE_EMPTY;
    const { container } = render(CampaignUpliftCard);
    await flush();
    const card = container.querySelector('[data-testid="campaign-uplift-card"]');
    expect(card).not.toBeNull();
    const cfMsg = container.querySelector('[data-testid="cf-computing"]');
    // Plain-language message — first result lands tomorrow morning (or locale equivalent).
    expect(cfMsg?.textContent ?? '').toMatch(/We're still calculating|first result lands tomorrow/);
    // Empty state must NOT show the hero number or honest-CI label or the old jargon.
    expect(card!.textContent ?? '').not.toMatch(/Cumulative uplift|CI overlaps zero|Counterfactual is computing/);
  });

  it('shows skeleton during fetch (animate-pulse before resolve)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (clientFetchSpy as any).__activeFixture.current = FIXTURE_HEADLINE_NORMAL;
    const { container } = render(CampaignUpliftCard);
    // First paint, before microtask flush — should show pulse skeleton
    const pulse = container.querySelector('.animate-pulse');
    expect(pulse).not.toBeNull();
  });

  it('shows divergence warning inside disclosure panel when sarimax vs naive_dow disagree by sign (D-09 — 16.1-03 disclosure pattern)', async () => {
    // 16.1-03 moved the divergence-warning testid from inline-visible to INSIDE
    // the {#if detailsOpen} disclosure panel. Test must click the trigger first,
    // then verify the warning is present with the new plain-language copy.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (clientFetchSpy as any).__activeFixture.current = FIXTURE_DIVERGENCE;
    const { container } = render(CampaignUpliftCard);
    await flush();
    // Before opening: divergence-warning is hidden (lives in collapsed panel).
    expect(container.querySelector('[data-testid="divergence-warning"]')).toBeNull();
    // Open the disclosure panel.
    const trigger = container.querySelector<HTMLButtonElement>('[data-testid="uplift-details-trigger"]');
    expect(trigger).not.toBeNull();
    trigger!.click();
    await flush();
    // After opening: panel + divergence warning visible with new plain-language copy.
    expect(container.querySelector('[data-testid="uplift-details-panel"]')).not.toBeNull();
    const warn = container.querySelector('[data-testid="divergence-warning"]');
    expect(warn).not.toBeNull();
    // Plain-language D-09 copy: "Two of our checks disagree — we'd want more weeks of data..."
    expect(warn?.textContent ?? '').toMatch(/Two of our checks disagree|disagree.*more weeks/i);
  });

  it('sparkline_data_contract — sparklineData consumes API daily[] (NOT a 2-point synthesized line)', () => {
    const src = readSource();
    // CONTEXT.md D-11: shape-of-uplift requires consuming the full daily[]
    // trajectory from the API, not a 2-point start/end line.
    expect(src).toMatch(/data\.daily\.map/);
    // Negative: forbid a literal 2-element array of {date, cum_uplift}
    expect(src).not.toMatch(/\[\s*\{\s*date:\s*data\.campaigns\[0\]\.start_date[^]*\},\s*\{\s*date:[^}]*as_of[^}]*\}\s*\]/);
  });
});
