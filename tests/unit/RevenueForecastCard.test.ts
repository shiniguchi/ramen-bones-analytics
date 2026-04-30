// @vitest-environment jsdom
// tests/unit/RevenueForecastCard.test.ts
// Phase 15-08 — composition test. Verifies default-state markup + empty-state +
// stale/uncalibrated badge logic. Visual fidelity (axis ticks, band opacity)
// is verified at the localhost gate, not here.
import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup } from '@testing-library/svelte';
import RevenueForecastCard from '../../src/lib/components/RevenueForecastCard.svelte';

// vite.config.ts does not set globals: true, so testing-library's auto-cleanup
// hook does not register. Without this afterEach, subsequent render() calls
// pile up on the same JSDOM body and getByRole returns "Found multiple elements"
// errors. Same scaffold used in HorizonToggle / ForecastLegend / EventMarker /
// ForecastHoverPopup test files.
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
    { target_date: '2026-05-01', model_name: 'sarimax_bau', yhat_mean: 1234.56, yhat_lower: 1100, yhat_upper: 1380, horizon_days: 1 },
    { target_date: '2026-05-02', model_name: 'sarimax_bau', yhat_mean: 1300,    yhat_lower: 1170, yhat_upper: 1430, horizon_days: 2 },
    { target_date: '2026-05-01', model_name: 'naive_dow',   yhat_mean: 1200,    yhat_lower: 1200, yhat_upper: 1200, horizon_days: 1 },
    { target_date: '2026-05-02', model_name: 'naive_dow',   yhat_mean: 1250,    yhat_lower: 1250, yhat_upper: 1250, horizon_days: 2 }
  ],
  actuals: [],
  events: [],
  last_run: '2026-04-30T01:34:22Z'
};

describe('RevenueForecastCard', () => {
  it('renders the card shell with title + description', () => {
    const { container } = render(RevenueForecastCard, {
      forecastData: FORECAST_PAYLOAD,
      qualityData: [],
      campaignUpliftData: { campaign_start: '2026-04-14', cumulative_deviation_eur: 0, as_of: '2026-05-01' },
      stalenessHours: 4
    });
    expect(container.querySelector('[data-testid="revenue-forecast-card"]')).toBeInTheDocument();
    expect(container.textContent).toMatch(/Revenue forecast/);
  });

  it('renders empty state when forecastData.rows is empty', () => {
    const { container } = render(RevenueForecastCard, {
      forecastData: { rows: [], actuals: [], events: [], last_run: null },
      qualityData: [],
      campaignUpliftData: null,
      stalenessHours: 0
    });
    expect(container.textContent).toMatch(/Forecast generating|Check back tomorrow/);
  });

  it('mounts HorizonToggle and ForecastLegend when data present', () => {
    const { container } = render(RevenueForecastCard, {
      forecastData: FORECAST_PAYLOAD,
      qualityData: [],
      campaignUpliftData: null,
      stalenessHours: 0
    });
    expect(container.querySelector('[data-testid="forecast-legend"]')).toBeInTheDocument();
    // HorizonToggle exposes role="group" with aria-label containing "horizon".
    const groups = container.querySelectorAll('[role="group"]');
    const horizonGroup = Array.from(groups).find(g =>
      (g.getAttribute('aria-label') ?? '').toLowerCase().includes('horizon')
    );
    expect(horizonGroup).toBeDefined();
  });

  it('renders the stale-data badge when stalenessHours > 24', () => {
    const { container } = render(RevenueForecastCard, {
      forecastData: FORECAST_PAYLOAD,
      qualityData: [],
      campaignUpliftData: null,
      stalenessHours: 36
    });
    expect(container.querySelector('[data-testid="forecast-stale-badge"]')).toBeInTheDocument();
  });

  it('hides the stale-data badge when stalenessHours <= 24', () => {
    const { container } = render(RevenueForecastCard, {
      forecastData: FORECAST_PAYLOAD,
      qualityData: [],
      campaignUpliftData: null,
      stalenessHours: 4
    });
    expect(container.querySelector('[data-testid="forecast-stale-badge"]')).not.toBeInTheDocument();
  });

  it('does not render the uncalibrated-CI badge in default state (horizon=7d)', () => {
    const { container } = render(RevenueForecastCard, {
      forecastData: FORECAST_PAYLOAD,
      qualityData: [],
      campaignUpliftData: null,
      stalenessHours: 0
    });
    expect(container.querySelector('[data-testid="forecast-uncalibrated-badge"]')).not.toBeInTheDocument();
  });
});
