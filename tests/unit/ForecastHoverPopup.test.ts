// @vitest-environment jsdom
// tests/unit/ForecastHoverPopup.test.ts
// Phase 15 FUI-04 — popup body renders 6 fields. Falls back to empty-state copy
// for the accuracy fields when forecast_quality has no rows yet.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup } from '@testing-library/svelte';
import ForecastHoverPopup from '../../src/lib/components/ForecastHoverPopup.svelte';

// Vitest config has no `globals: true`, so @testing-library/svelte's auto
// afterEach cleanup is not registered. Call it explicitly so each test
// renders a fresh DOM.
afterEach(() => {
  cleanup();
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
});

const QUALITY = new Map<string, {
  rmse: number; mape: number; mean_bias: number; direction_hit_rate: number | null;
}>([
  ['sarimax_bau|7', { rmse: 142.31, mape: 0.084, mean_bias: 12.5, direction_hit_rate: 0.71 }]
]);

describe('ForecastHoverPopup', () => {
  it('renders forecast value + 95% CI for the hovered row', () => {
    const { getByTestId } = render(ForecastHoverPopup, {
      hoveredRow: {
        target_date: '2026-05-08',
        model_name: 'sarimax_bau',
        yhat_mean: 1234.56,
        yhat_lower: 1100,
        yhat_upper: 1380,
        horizon_days: 7
      },
      qualityByModelHorizon: QUALITY,
      cumulativeDeviationEur: -432.10,
      lastRun: '2026-05-01T01:34:22Z'
    });
    expect(getByTestId('popup-forecast-value').textContent).toMatch(/1\.234|1.235/); // de-DE rounding tolerance
    expect(getByTestId('popup-ci-low-high').textContent).toContain('1.100');
    expect(getByTestId('popup-ci-low-high').textContent).toContain('1.380');
  });

  it('renders horizon as "7 days from today"', () => {
    const { getByTestId } = render(ForecastHoverPopup, {
      hoveredRow: {
        target_date: '2026-05-08', model_name: 'sarimax_bau',
        yhat_mean: 1234.56, yhat_lower: 1100, yhat_upper: 1380, horizon_days: 7
      },
      qualityByModelHorizon: QUALITY,
      cumulativeDeviationEur: 0,
      lastRun: '2026-05-01T01:34:22Z'
    });
    expect(getByTestId('popup-horizon').textContent).toMatch(/7 days from today/);
  });

  it('renders horizon as "1 day from today" (singular) for horizon_days=1', () => {
    const { getByTestId } = render(ForecastHoverPopup, {
      hoveredRow: {
        target_date: '2026-05-02', model_name: 'sarimax_bau',
        yhat_mean: 1234, yhat_lower: 1100, yhat_upper: 1380, horizon_days: 1
      },
      qualityByModelHorizon: QUALITY,
      cumulativeDeviationEur: 0,
      lastRun: '2026-05-01T01:34:22Z'
    });
    expect(getByTestId('popup-horizon').textContent).toMatch(/1 day from today/);
  });

  it('renders 4 quality metrics when forecast_quality row exists for (model, horizon)', () => {
    const { getByTestId } = render(ForecastHoverPopup, {
      hoveredRow: {
        target_date: '2026-05-08', model_name: 'sarimax_bau',
        yhat_mean: 1234.56, yhat_lower: 1100, yhat_upper: 1380, horizon_days: 7
      },
      qualityByModelHorizon: QUALITY,
      cumulativeDeviationEur: -432.10,
      lastRun: '2026-05-01T01:34:22Z'
    });
    expect(getByTestId('popup-rmse').textContent).toMatch(/142|142,31/);
    expect(getByTestId('popup-mape').textContent).toMatch(/8\.4|8,4/);
    expect(getByTestId('popup-bias').textContent).toMatch(/12|12,5/);
    expect(getByTestId('popup-direction-hit').textContent).toMatch(/71/);
  });

  it('renders the "Accuracy data builds after first nightly run" empty state when no quality row exists', () => {
    const { getByTestId } = render(ForecastHoverPopup, {
      hoveredRow: {
        target_date: '2026-05-08', model_name: 'prophet',
        yhat_mean: 1100, yhat_lower: 980, yhat_upper: 1220, horizon_days: 7
      },
      qualityByModelHorizon: QUALITY,   // only sarimax_bau|7 — prophet missing
      cumulativeDeviationEur: 0,
      lastRun: '2026-05-01T01:34:22Z'
    });
    const empty = getByTestId('popup-quality-empty');
    // Copy is the empty_forecast_quality_empty_body key shipped in Phase 15-01
    // (commit 9fc6e68). Test asserts the exact i18n value.
    expect(empty.textContent).toMatch(/Forecast accuracy metrics need at least one completed nightly evaluation cycle/);
  });

  it('renders cumulative deviation since campaign with EUR formatting', () => {
    const { getByTestId } = render(ForecastHoverPopup, {
      hoveredRow: {
        target_date: '2026-05-08', model_name: 'sarimax_bau',
        yhat_mean: 1234, yhat_lower: 1100, yhat_upper: 1380, horizon_days: 7
      },
      qualityByModelHorizon: QUALITY,
      cumulativeDeviationEur: -432.10,
      lastRun: '2026-05-01T01:34:22Z'
    });
    expect(getByTestId('popup-uplift').textContent).toMatch(/-432|-43.210|−432/); // sign + EUR
  });

  it('renders "Last refit {ago} ago" when lastRun present', () => {
    const { getByTestId } = render(ForecastHoverPopup, {
      hoveredRow: {
        target_date: '2026-05-08', model_name: 'sarimax_bau',
        yhat_mean: 1234, yhat_lower: 1100, yhat_upper: 1380, horizon_days: 7
      },
      qualityByModelHorizon: QUALITY,
      cumulativeDeviationEur: 0,
      lastRun: '2026-05-01T01:34:22Z'
    });
    expect(getByTestId('popup-last-refit').textContent).toMatch(/Last refit/);
    expect(getByTestId('popup-last-refit').textContent).toMatch(/ago/);
  });

  it('omits the last-refit field when lastRun is null', () => {
    const { queryByTestId } = render(ForecastHoverPopup, {
      hoveredRow: {
        target_date: '2026-05-08', model_name: 'sarimax_bau',
        yhat_mean: 1234, yhat_lower: 1380, yhat_upper: 1380, horizon_days: 7
      },
      qualityByModelHorizon: QUALITY,
      cumulativeDeviationEur: 0,
      lastRun: null
    });
    expect(queryByTestId('popup-last-refit')).toBeNull();
  });

  it('omits cumulative deviation field when cumulativeDeviationEur is null (endpoint failed)', () => {
    const { queryByTestId } = render(ForecastHoverPopup, {
      hoveredRow: {
        target_date: '2026-05-08', model_name: 'sarimax_bau',
        yhat_mean: 1234, yhat_lower: 1100, yhat_upper: 1380, horizon_days: 7
      },
      qualityByModelHorizon: QUALITY,
      cumulativeDeviationEur: null,
      lastRun: '2026-05-01T01:34:22Z'
    });
    expect(queryByTestId('popup-uplift')).toBeNull();
  });
});
