// @vitest-environment jsdom
// tests/unit/InvoiceCountForecastCard.test.ts
// Phase 15-15 — composition test for the invoice_count sibling card.
// Mirrors RevenueForecastCard.test.ts (15-14): the card self-fetches forecast
// data on grain change via clientFetch. We stub clientFetch so the $effect
// resolves a fixture payload synchronously inside the render call. Visual
// fidelity (axis ticks, band opacity) is verified at the localhost / DEV gate.
import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup } from '@testing-library/svelte';

// Stub clientFetch BEFORE importing the component — Vite hoists vi.mock()
// calls to the top so the mock is in place at module load. Use vi.hoisted()
// so the spy ref is available inside the hoisted factory. We assert on the
// URL inside the spy so we know the card hits ?kpi=invoice_count specifically.
const { clientFetchSpy } = vi.hoisted(() => ({
  clientFetchSpy: vi.fn(async (url: string) => {
    if (!url.includes('kpi=invoice_count')) {
      throw new Error(`Expected kpi=invoice_count in URL, got: ${url}`);
    }
    return FORECAST_PAYLOAD_HOISTED;
  })
}));
const { FORECAST_PAYLOAD_HOISTED } = vi.hoisted(() => ({
  FORECAST_PAYLOAD_HOISTED: {
    rows: [
      { target_date: '2026-05-01', model_name: 'sarimax',   yhat_mean: 87, yhat_lower: 78, yhat_upper: 96, horizon_days: 1 },
      { target_date: '2026-05-02', model_name: 'sarimax',   yhat_mean: 92, yhat_lower: 83, yhat_upper: 101, horizon_days: 2 },
      { target_date: '2026-05-01', model_name: 'naive_dow', yhat_mean: 84, yhat_lower: 84, yhat_upper: 84, horizon_days: 1 },
      { target_date: '2026-05-02', model_name: 'naive_dow', yhat_mean: 89, yhat_lower: 89, yhat_upper: 89, horizon_days: 2 }
    ],
    actuals: [
      { date: '2026-04-29', value: 81 },
      { date: '2026-04-30', value: 86 }
    ],
    events: [],
    last_run: '2026-04-30T01:34:22Z',
    kpi: 'invoice_count',
    granularity: 'day'
  }
}));
vi.mock('$lib/clientFetch', () => ({
  clientFetch: clientFetchSpy
}));

// Stub the dashboard store so getFilters().grain returns a stable value.
// Importing dashboardStore.svelte from a unit test requires the runes runtime;
// the mock keeps the test boundary clean.
vi.mock('$lib/dashboardStore.svelte', () => ({
  getFilters: () => ({ grain: 'day' })
}));

import InvoiceCountForecastCard from '../../src/lib/components/InvoiceCountForecastCard.svelte';

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

// Microtask flush helper — gives the $effect's clientFetch promise a tick
// to resolve so the fixture lands in forecastData and the chart renders.
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('InvoiceCountForecastCard (15-15 sibling)', () => {
  it('renders the card shell with invoice count title + description', () => {
    const { container } = render(InvoiceCountForecastCard);
    expect(container.querySelector('[data-testid="invoice-forecast-card"]')).toBeInTheDocument();
    expect(container.textContent).toMatch(/Invoice count forecast/);
  });

  it('renders the EmptyState before forecast data resolves', () => {
    const { container } = render(InvoiceCountForecastCard);
    // First paint, before the awaited clientFetch microtask flush.
    expect(container.textContent).toMatch(/Forecast generating|Check back tomorrow/);
  });

  it('renders ForecastLegend after fixture payload resolves', async () => {
    const { container } = render(InvoiceCountForecastCard);
    await flush();
    expect(container.querySelector('[data-testid="forecast-legend"]')).toBeInTheDocument();
  });

  it('renders Spline / Area elements for each visible model (invoice count)', async () => {
    const { container } = render(InvoiceCountForecastCard);
    await flush();
    // LayerChart Spline + Area both emit <path> elements; CI band uses
    // Area (closed path), forecast lines use Spline (open path). With both
    // sarimax + naive_dow visible by default we expect ≥ 4 paths
    // (2 areas + 2 lines), plus the actuals overlay path = ≥ 5.
    const paths = container.querySelectorAll('svg path');
    expect(paths.length).toBeGreaterThanOrEqual(4);
  });

  it('does NOT render a HorizonToggle (15-15 mirrors 15-14 — dropped)', async () => {
    const { container } = render(InvoiceCountForecastCard);
    await flush();
    const groups = container.querySelectorAll('[role="group"]');
    const horizonGroup = Array.from(groups).find(g =>
      (g.getAttribute('aria-label') ?? '').toLowerCase().includes('horizon')
    );
    expect(horizonGroup).toBeUndefined();
  });

  it('fetches /api/forecast with kpi=invoice_count', async () => {
    render(InvoiceCountForecastCard);
    await flush();
    // The clientFetch spy throws if the URL is wrong; this assertion
    // confirms it was called at least once.
    expect(clientFetchSpy).toHaveBeenCalled();
    const calledWith = clientFetchSpy.mock.calls.map(c => c[0] as string);
    expect(calledWith.some(u => u.includes('kpi=invoice_count'))).toBe(true);
  });
});
