// @vitest-environment jsdom
// tests/unit/RevenueForecastCard.test.ts
// Phase 15-14 — composition test. The card now self-fetches forecast data
// on grain change via clientFetch (no horizon prop, no granularity prop).
// We stub clientFetch so the $effect resolves a fixture payload synchronously
// inside the render call. Visual fidelity (axis ticks, band opacity) is
// verified at the localhost gate, not here.
import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup } from '@testing-library/svelte';

// Stub clientFetch BEFORE importing the component — Vite hoists vi.mock()
// calls to the top so the mock is in place at module load.
vi.mock('$lib/clientFetch', () => ({
  clientFetch: vi.fn(async () => FORECAST_PAYLOAD)
}));

// Stub the dashboard store so getFilters().grain returns a stable value.
// Importing dashboardStore.svelte from a unit test requires the runes runtime;
// the mock keeps the test boundary clean.
vi.mock('$lib/dashboardStore.svelte', () => ({
  getFilters: () => ({ grain: 'day' }),
  computeChartWidth: () => undefined
}));

import RevenueForecastCard from '../../src/lib/components/RevenueForecastCard.svelte';

// vite.config.ts does not set globals: true, so testing-library's auto-cleanup
// hook does not register. Without this afterEach, subsequent render() calls
// pile up on the same JSDOM body and getByRole returns "Found multiple elements"
// errors.
afterEach(() => cleanup());

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

const FORECAST_PAYLOAD = {
  rows: [
    { target_date: '2026-05-01', model_name: 'sarimax',   yhat_mean: 1234.56, yhat_lower: 1100, yhat_upper: 1380, horizon_days: 1 },
    { target_date: '2026-05-02', model_name: 'sarimax',   yhat_mean: 1300,    yhat_lower: 1170, yhat_upper: 1430, horizon_days: 2 },
    { target_date: '2026-05-01', model_name: 'naive_dow', yhat_mean: 1200,    yhat_lower: 1200, yhat_upper: 1200, horizon_days: 1 },
    { target_date: '2026-05-02', model_name: 'naive_dow', yhat_mean: 1250,    yhat_lower: 1250, yhat_upper: 1250, horizon_days: 2 }
  ],
  actuals: [
    { date: '2026-04-29', value: 1180 },
    { date: '2026-04-30', value: 1220 }
  ],
  events: [],
  last_run: '2026-04-30T01:34:22Z',
  kpi: 'revenue_eur',
  granularity: 'day'
};

// Microtask flush helper — gives the $effect's clientFetch promise a tick
// to resolve so the fixture lands in forecastData and the chart renders.
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('RevenueForecastCard (15-14 rewrite)', () => {
  it('renders the card shell with title + description', () => {
    const { container } = render(RevenueForecastCard);
    expect(container.querySelector('[data-testid="revenue-forecast-card"]')).toBeInTheDocument();
    expect(container.textContent).toMatch(/Revenue forecast/);
  });

  it('renders the EmptyState before forecast data resolves', () => {
    const { container } = render(RevenueForecastCard);
    // First paint, before the awaited clientFetch microtask flush.
    expect(container.textContent).toMatch(/Forecast generating|Check back tomorrow/);
  });

  it('renders ForecastLegend after fixture payload resolves', async () => {
    const { container } = render(RevenueForecastCard);
    await flush();
    expect(container.querySelector('[data-testid="forecast-legend"]')).toBeInTheDocument();
  });

  it('renders Spline / Area elements for each visible model', async () => {
    const { container } = render(RevenueForecastCard);
    await flush();
    // LayerChart Spline + Area both emit <path> elements; CI band uses
    // Area (closed path), forecast lines use Spline (open path). With both
    // sarimax + naive_dow visible by default we expect ≥ 4 paths
    // (2 areas + 2 lines), plus the actuals overlay path = ≥ 5.
    const paths = container.querySelectorAll('svg path');
    expect(paths.length).toBeGreaterThanOrEqual(4);
  });

  it('does NOT render a HorizonToggle (15-14 dropped it)', async () => {
    const { container } = render(RevenueForecastCard);
    await flush();
    const groups = container.querySelectorAll('[role="group"]');
    const horizonGroup = Array.from(groups).find(g =>
      (g.getAttribute('aria-label') ?? '').toLowerCase().includes('horizon')
    );
    expect(horizonGroup).toBeUndefined();
  });
});
