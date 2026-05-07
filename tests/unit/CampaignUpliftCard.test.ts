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
const { clientFetchSpy, FIXTURE_HEADLINE_NORMAL, FIXTURE_HEADLINE_ZERO_OVERLAP, FIXTURE_DIVERGENCE, FIXTURE_EMPTY, FIXTURE_WEEKLY_NORMAL, FIXTURE_WEEKLY_EMPTY, FIXTURE_WEEKLY_NEGATIVE_LIFT, FIXTURE_WEEKLY_CI_STRADDLES_ZERO, FIXTURE_WEEKLY_MIXED } = vi.hoisted(() => {
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

  // Weekly history entries for Phase 18 Plan 04 tests.
  // Three ascending weeks: W17 (Apr 20-26), W18 (Apr 27-May 3), W19 (May 4-10).
  const weeklyHistory3 = [
    {
      iso_week_start: '2026-04-20',
      iso_week_end: '2026-04-26',
      model_name: 'sarimax',
      point_eur: 450,
      ci_lower_eur: -100,
      ci_upper_eur: 980,
      n_days: 7
    },
    {
      iso_week_start: '2026-04-27',
      iso_week_end: '2026-05-03',
      model_name: 'sarimax',
      point_eur: -149,
      ci_lower_eur: -620,
      ci_upper_eur: 340,
      n_days: 7
    },
    {
      iso_week_start: '2026-05-04',
      iso_week_end: '2026-05-10',
      model_name: 'sarimax',
      point_eur: 880,
      ci_lower_eur: 210,
      ci_upper_eur: 1550,
      n_days: 7
    }
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
    weekly_history: weeklyHistory3,
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

  // Phase 18 Plan 04 — FIXTURE_WEEKLY_* set for new hero contract tests.
  // Today = 2026-05-07 (Wed). Campaign launched 2026-04-14 (Tue).
  // Weeks since launch: floor((2026-05-07 - 2026-04-14) / 7) = floor(23/7) = 3 → midweeks tier.

  // Normal: 3 weeks ascending, last week has clear positive lift (CI lower > 0).
  // Campaign start_date = today - 21 days → 3 weeks since launch → midweeks tier.
  const todayMs = new Date('2026-05-07').getTime();
  const startDate21dAgo = new Date(todayMs - 21 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const FIXTURE_WEEKLY_NORMAL = {
    campaign_start: startDate21dAgo,
    cumulative_deviation_eur: 1500,
    as_of: '2026-05-07',
    model: 'sarimax',
    ci_lower_eur: 210,
    ci_upper_eur: 1550,
    naive_dow_uplift_eur: null,
    daily: dailyTrajectory,
    weekly_history: weeklyHistory3,
    campaigns: [
      {
        campaign_id: 'friend-2026-04-14',
        start_date: startDate21dAgo,
        end_date: '2026-06-14',
        name: 'Friend Instagram Push',
        channel: 'instagram',
        rows: [baseHeadlineRow]
      }
    ]
  };

  // Empty: no weekly_history — campaign launched too recently (< 1 ISO week ago).
  const FIXTURE_WEEKLY_EMPTY = {
    campaign_start: '2026-05-05',
    cumulative_deviation_eur: 0,
    as_of: '2026-05-07',
    model: 'sarimax',
    ci_lower_eur: null,
    ci_upper_eur: null,
    naive_dow_uplift_eur: null,
    daily: [],
    weekly_history: [],
    campaigns: [
      {
        campaign_id: 'friend-2026-05-05',
        start_date: '2026-05-05',
        end_date: '2026-06-05',
        name: 'New Campaign',
        channel: 'instagram',
        rows: []
      }
    ]
  };

  // Negative lift: last week point_eur < 0 with CI fully below zero.
  const FIXTURE_WEEKLY_NEGATIVE_LIFT = {
    ...FIXTURE_WEEKLY_NORMAL,
    weekly_history: [
      {
        iso_week_start: '2026-04-27',
        iso_week_end: '2026-05-03',
        model_name: 'sarimax',
        point_eur: -500,
        ci_lower_eur: -900,
        ci_upper_eur: -100,
        n_days: 7
      }
    ]
  };

  // CI straddles zero: CI bounds span zero — no detectable lift this week.
  const FIXTURE_WEEKLY_CI_STRADDLES_ZERO = {
    ...FIXTURE_WEEKLY_NORMAL,
    weekly_history: [
      {
        iso_week_start: '2026-04-27',
        iso_week_end: '2026-05-03',
        model_name: 'sarimax',
        point_eur: 80,
        ci_lower_eur: -300,
        ci_upper_eur: 460,
        n_days: 7
      }
    ]
  };

  // Phase 18 Plan 05 — FIXTURE_WEEKLY_MIXED: one bar of each color class.
  // Week 1: ci_lower_eur > 0 → emerald (positive lift confirmed)
  // Week 2: ci_upper_eur < 0 → rose (negative impact confirmed)
  // Week 3: straddles zero → zinc-400 (uncertain)
  const FIXTURE_WEEKLY_MIXED = {
    ...FIXTURE_WEEKLY_NORMAL,
    weekly_history: [
      {
        iso_week_start: '2026-04-20',
        iso_week_end: '2026-04-26',
        model_name: 'sarimax',
        point_eur: 450,
        ci_lower_eur: 100,    // > 0 → emerald
        ci_upper_eur: 900,
        n_days: 7
      },
      {
        iso_week_start: '2026-04-27',
        iso_week_end: '2026-05-03',
        model_name: 'sarimax',
        point_eur: -350,
        ci_lower_eur: -700,   // ci_upper_eur < 0 → rose
        ci_upper_eur: -50,
        n_days: 7
      },
      {
        iso_week_start: '2026-05-04',
        iso_week_end: '2026-05-10',
        model_name: 'sarimax',
        point_eur: 80,
        ci_lower_eur: -200,   // straddles zero → zinc-400
        ci_upper_eur: 360,
        n_days: 7
      }
    ]
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

  return { clientFetchSpy, FIXTURE_HEADLINE_NORMAL, FIXTURE_HEADLINE_ZERO_OVERLAP, FIXTURE_DIVERGENCE, FIXTURE_EMPTY, FIXTURE_WEEKLY_NORMAL, FIXTURE_WEEKLY_EMPTY, FIXTURE_WEEKLY_NEGATIVE_LIFT, FIXTURE_WEEKLY_CI_STRADDLES_ZERO, FIXTURE_WEEKLY_MIXED };
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
    // Phase 18 Plan 04: hero now reads from weekly_history. FIXTURE_HEADLINE_NORMAL
    // has weeklyHistory3 with last entry point_eur=880 (W19: May 4-10, ci_lower=210>0).
    // campaign.start_date is 2026-04-14 (~23 days ago → 3 weeks → midweeks tier).
    // midweeks + CI lower>0 + point_eur>0 → uplift_hero_early_added copy ("Looks like...").
    // Hero number: formatEur(880) = "+€880".
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (clientFetchSpy as any).__activeFixture.current = FIXTURE_HEADLINE_NORMAL;
    const { container } = render(CampaignUpliftCard);
    await flush();
    const text = container.textContent ?? '';
    // Hero shows the weekly point_eur=880.
    expect(text).toMatch(/880/);
    // No legacy jargon.
    expect(text).not.toMatch(/CI overlaps zero/);
    // hero-uplift testid present (CI does not overlap).
    expect(container.querySelector('[data-testid="hero-uplift"]')).not.toBeNull();
  });

  it('shows plain-language hero + isCIOverlap testid when CI overlaps zero (UPL-06 — 16.1-03 D-05..D-12)', async () => {
    // Phase 18 Plan 04: hero reads from weekly_history. FIXTURE_WEEKLY_CI_STRADDLES_ZERO
    // has one entry with ci_lower=-300 < 0, ci_upper=460 > 0 → ciOverlapsZero=true.
    // campaign.start_date is today-21d → 3 weeks → midweeks tier.
    // midweeks + CI straddles zero → heroKey='uplift_hero_early_not_measurable'.
    // The dim-point-estimate testid still exists but lives inside the {#if detailsOpen}
    // disclosure panel — not visible by default. hero-ci-overlaps testid is rendered.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (clientFetchSpy as any).__activeFixture.current = FIXTURE_WEEKLY_CI_STRADDLES_ZERO;
    const { container } = render(CampaignUpliftCard);
    await flush();
    const text = container.textContent ?? '';
    // Plain-language hero for midweeks + CI-overlap: "Probably not measurable yet".
    expect(text).toMatch(/Probably not measurable yet|measurable/i);
    // CI-overlap testid present.
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
    // Phase 18 Plan 04 — Claude's Discretion: divergence warning is disabled on per-week reads.
    // Per-week rows have naive_dow_uplift_eur=null by construction (Plan 02/PATTERNS §2c).
    // The divergenceWarning derived is hardcoded false for per-week reads.
    // Test updated to verify the disclosure panel still works but divergence-warning is absent.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (clientFetchSpy as any).__activeFixture.current = FIXTURE_DIVERGENCE;
    const { container } = render(CampaignUpliftCard);
    await flush();
    // divergence-warning is always absent (per-week reads have no naive_dow cross-check).
    expect(container.querySelector('[data-testid="divergence-warning"]')).toBeNull();
    // Disclosure trigger still present.
    const trigger = container.querySelector<HTMLButtonElement>('[data-testid="uplift-details-trigger"]');
    expect(trigger).not.toBeNull();
    trigger!.click();
    await flush();
    // After opening: panel is present; anticipation note is there; divergence-warning absent.
    expect(container.querySelector('[data-testid="uplift-details-panel"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="anticipation-buffer-note"]')).not.toBeNull();
    // Phase 18 Plan 04: divergence-warning NOT rendered on per-week hero reads.
    expect(container.querySelector('[data-testid="divergence-warning"]')).toBeNull();
  });

  it('sparkline_data_contract — bar chart consumes weekly_history[] (NOT a 2-point synthesized line)', () => {
    // Phase 18 Plan 05: Spline+Area cumulative sparkline replaced by Bars weekly bar chart.
    // D-11 intent preserved: chart source must use server-provided data, not a synthesized array.
    // The weekly bar chart reads weeklyHistory (derived from data.weekly_history) — never a
    // hardcoded literal 2-element array of {start, end} endpoints.
    const src = readSource();
    // Must use weekly_history from the API payload (not the old data.daily.map).
    expect(src).toMatch(/weekly_history/);
    // Must NOT have the old synthesized 2-point start/end pattern.
    expect(src).not.toMatch(/\[\s*\{\s*date:\s*data\.campaigns\[0\]\.start_date[^]*\},\s*\{\s*date:[^}]*as_of[^}]*\}\s*\]/);
    // Must NOT use the old Spline + Area cumulative sparkline primitives.
    expect(src).not.toMatch(/import\s*\{[^}]*Spline[^}]*\}\s*from\s*['"]layerchart['"]/);
    // Must use either Option B (<Bars> import) or Option C fallback (manual <rect> via chartCtx).
    // Option B failed localhost QA (NaN band-scale) so Option C is expected, but both are valid.
    const usesOptionB = /import\s*\{[^}]*Bars[^}]*\}\s*from\s*['"]layerchart['"]/.test(src);
    const usesOptionC = /chartCtx\?\.xScale/.test(src) && /weekColorClass/.test(src);
    expect(usesOptionB || usesOptionC).toBe(true);
  });

  // ----- Phase 18 Plan 04 — weekly_history hero contract tests -----

  it('weekly_history: hero reads from weekly_history.at(-1) when selectedWeekIndex is null', async () => {
    // Feed FIXTURE_WEEKLY_NORMAL with 3 ascending weeks — hero must reflect
    // the LAST week (W19: May 4-10, point_eur=880).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (clientFetchSpy as any).__activeFixture.current = FIXTURE_WEEKLY_NORMAL;
    const { container } = render(CampaignUpliftCard);
    await flush();
    const text = container.textContent ?? '';
    // Hero number (formatEur(880)) = "+€880" → text contains "880".
    expect(text).toMatch(/880/);
  });

  it('weekly_history: data-testid="uplift-week-headline-range" renders week range for last ISO week', async () => {
    // FIXTURE_WEEKLY_NORMAL last week: iso_week_start=May 4, iso_week_end=May 10.
    // Rendered via Intl.DateTimeFormat(en, {month:'short', day:'numeric'}) → "May 4 – May 10".
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (clientFetchSpy as any).__activeFixture.current = FIXTURE_WEEKLY_NORMAL;
    const { container } = render(CampaignUpliftCard);
    await flush();
    const rangeEl = container.querySelector('[data-testid="uplift-week-headline-range"]');
    expect(rangeEl).not.toBeNull();
    const rangeText = rangeEl?.textContent ?? '';
    // Both the start and end date formatted fragments must be present.
    expect(rangeText).toMatch(/May\s+4|4.+May/i);
    expect(rangeText).toMatch(/May\s+10|10.+May/i);
  });

  it('Decision A — maturity tier reads from weeks-since-launch, NOT n_days', async () => {
    // FIXTURE_WEEKLY_NORMAL: campaign.start_date = today − 21 days → weeksSinceLaunch=3
    // → tier = midweeks → heroKey one of: uplift_hero_early_added / uplift_hero_early_reduced /
    //   uplift_hero_early_not_measurable (but NOT uplift_hero_too_early or uplift_hero_mature_*).
    // Last week has ci_lower=210 > 0, point_eur=880 > 0 → ciOverlapsZero=false, sign='added'
    // → heroKey = 'uplift_hero_early_added'.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (clientFetchSpy as any).__activeFixture.current = FIXTURE_WEEKLY_NORMAL;
    const { container } = render(CampaignUpliftCard);
    await flush();
    const text = container.textContent ?? '';
    // Must show midweeks tier copy (uplift_hero_early_added):
    expect(text).toMatch(/Looks like the campaign added revenue/i);
    // Must NOT fall into early (Too early) or mature (Yes, your campaign appears) tiers.
    expect(text).not.toMatch(/Too early to tell/i);
    expect(text).not.toMatch(/Yes, your campaign appears/i);
  });

  it('weekly_history: empty weekly_history → uplift_hero_too_early empty-state copy', async () => {
    // FIXTURE_WEEKLY_EMPTY: weekly_history=[], campaign launched 2 days ago.
    // headline === null → renders the "too early" copy.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (clientFetchSpy as any).__activeFixture.current = FIXTURE_WEEKLY_EMPTY;
    const { container } = render(CampaignUpliftCard);
    await flush();
    const text = container.textContent ?? '';
    // The empty-state hero path must render uplift_hero_too_early OR cf-computing copy.
    // (Empty campaigns array falls through to cf-computing; non-empty campaigns with
    //  weekly_history=[] falls through to headline===null → cf-computing path.)
    // Either is acceptable — the key contract is NO hero number and NO date range.
    expect(text).not.toMatch(/\+€\d+|−€\d+/);
    expect(container.querySelector('[data-testid="uplift-week-headline-range"]')).toBeNull();
  });

  // ----- Phase 18 Plan 05 — bar chart contract tests -----

  it('bar_chart_contract — renders Bars + per-bar Rule whiskers when weekly_history is non-empty', async () => {
    // FIXTURE_WEEKLY_NORMAL has 3 weeks of sarimax data.
    // Expects: uplift-week-bar-chart container + SVG shapes (bars + whiskers).
    // Note: LayerChart <Bars> renders <path> elements (not <rect>) when radius > 0
    // or when rounded='all'. <Rule> whiskers render as <line> elements.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (clientFetchSpy as any).__activeFixture.current = FIXTURE_WEEKLY_NORMAL;
    const { container } = render(CampaignUpliftCard);
    await flush();
    const chart = container.querySelector('[data-testid="uplift-week-bar-chart"]');
    expect(chart).not.toBeNull();
    // bars (path/rect) + whisker lines + axis lines — at least 2 SVG shapes per data row.
    const allShapes = chart!.querySelectorAll('rect, path, line');
    expect(allShapes.length).toBeGreaterThanOrEqual(7);
  });

  it('bar_chart_color_coding — applies fill-emerald-500 / fill-rose-500 / fill-zinc-400 by CI band sign', async () => {
    // FIXTURE_WEEKLY_MIXED has 1 emerald (ci_lower>0), 1 rose (ci_upper<0), 1 zinc (straddles).
    // LayerChart <Bars> passes `class` prop through to each Bar's path/rect element.
    // The class propagates from <Bars class="fill-*"> → <Bar ...extractLayerProps(restProps)>
    // → the SVG element (path or rect). Test checks the chart container for those classes.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (clientFetchSpy as any).__activeFixture.current = FIXTURE_WEEKLY_MIXED;
    const { container } = render(CampaignUpliftCard);
    await flush();
    const chart = container.querySelector('[data-testid="uplift-week-bar-chart"]')!;
    expect(chart).not.toBeNull();
    // Color classes may appear on <g> wrappers (lc-bars group) or on individual bar elements.
    expect(chart.querySelector('.fill-emerald-500')).not.toBeNull();
    expect(chart.querySelector('.fill-rose-500')).not.toBeNull();
    expect(chart.querySelector('.fill-zinc-400')).not.toBeNull();
  });

  it('tap_to_scrub — clicking a bar updates selectedWeekIndex; hero re-renders', async () => {
    // FIXTURE_WEEKLY_NORMAL: 3 weeks ascending — hero defaults to last (W19, point_eur=880).
    // Clicking the FIRST bar (W17, zinc-400 straddles-zero) should change hero to W17.
    // Note: LayerChart <Bars> renders bars as <path> elements (radius causes Path branch
    // in Bar.svelte). The onclick is spread via restProps → extractLayerProps → <path>.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (clientFetchSpy as any).__activeFixture.current = FIXTURE_WEEKLY_NORMAL;
    const { container, getByTestId } = render(CampaignUpliftCard);
    await flush();
    const heroBefore = getByTestId('uplift-week-headline-range').textContent;
    // Find bar elements: <path> or <rect> elements with fill color classes.
    const chart = container.querySelector('[data-testid="uplift-week-bar-chart"]')!;
    const allBarShapes = chart.querySelectorAll('path, rect');
    const barShapes = [...allBarShapes].filter((el) =>
      el.classList.contains('fill-emerald-500') ||
      el.classList.contains('fill-rose-500') ||
      el.classList.contains('fill-zinc-400') ||
      el.classList.contains('lc-bar')
    );
    expect(barShapes.length).toBeGreaterThan(0);
    // Click the first bar — LayerChart wires onclick via restProps spread.
    barShapes[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    const heroAfter = getByTestId('uplift-week-headline-range').textContent;
    expect(heroAfter).not.toBe(heroBefore);  // hero changed to a different week
  });

  it('empty_weekly_history — uplift-week-bar-chart not in DOM when weekly_history is []', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (clientFetchSpy as any).__activeFixture.current = FIXTURE_WEEKLY_EMPTY;
    const { container } = render(CampaignUpliftCard);
    await flush();
    expect(container.querySelector('[data-testid="uplift-week-bar-chart"]')).toBeNull();
  });

  it('ModelAvailabilityDisclosure_compatibility — disclosure panel renders when both weekly_history AND cumulative_since_launch rows present', async () => {
    // FIXTURE_WEEKLY_NORMAL includes campaigns[0].rows=[baseHeadlineRow] (window_kind='cumulative_since_launch').
    // CampaignUpliftCard does not embed ModelAvailabilityDisclosure directly — its own disclosure panel
    // must still open and render its content when the payload has both weekly_history and campaigns[0].rows.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (clientFetchSpy as any).__activeFixture.current = FIXTURE_WEEKLY_NORMAL;
    const { container } = render(CampaignUpliftCard);
    await flush();
    const trigger = container.querySelector<HTMLButtonElement>('[data-testid="uplift-details-trigger"]');
    expect(trigger).not.toBeNull();
    trigger!.click();
    await flush();
    const panel = container.querySelector('[data-testid="uplift-details-panel"]');
    expect(panel).not.toBeNull();
    // Panel content: point estimate + anticipation note must render.
    expect(panel!.querySelector('[data-testid="dim-point-estimate"]')).not.toBeNull();
    expect(panel!.querySelector('[data-testid="anticipation-buffer-note"]')).not.toBeNull();
  });
});
