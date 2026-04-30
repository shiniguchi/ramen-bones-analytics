// @vitest-environment jsdom
// tests/unit/ForecastLegend.test.ts
// Phase 15 D-04 / FUI-02 — chip row, default visibleModels = {sarimax_bau, naive_dow}.
// Disabled state for models not present in availableModels (feature-flag off).
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import ForecastLegend from '../../src/lib/components/ForecastLegend.svelte';

// Vitest config has no `globals: true`, so @testing-library/svelte's auto
// afterEach cleanup is not registered. Call it explicitly so each test
// renders a fresh DOM (otherwise multiple renders pile up and getByRole
// finds duplicate matches).
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

const ALL_FIVE_BAU = ['sarimax_bau', 'prophet', 'ets', 'theta', 'naive_dow'];

describe('ForecastLegend', () => {
  it('renders one chip per FORECAST_MODEL_COLORS palette entry', () => {
    const { getAllByRole } = render(ForecastLegend, {
      availableModels: ALL_FIVE_BAU,
      visibleModels: new Set(['sarimax_bau', 'naive_dow']),
      ontoggle: () => {}
    });
    // 7 palette entries — 5 BAU + 2 feature-flagged
    expect(getAllByRole('button').length).toBe(7);
  });

  it('default visible chips render aria-pressed=true; hidden chips render aria-pressed=false', () => {
    const { getByRole } = render(ForecastLegend, {
      availableModels: ALL_FIVE_BAU,
      visibleModels: new Set(['sarimax_bau', 'naive_dow']),
      ontoggle: () => {}
    });
    expect(getByRole('button', { name: /SARIMAX/ })).toHaveAttribute('aria-pressed', 'true');
    expect(getByRole('button', { name: /Naive/ })).toHaveAttribute('aria-pressed', 'true');
    // /Prophet/ would also match "NeuralProphet" — anchor to distinguish.
    expect(getByRole('button', { name: /^Prophet$/ })).toHaveAttribute('aria-pressed', 'false');
    expect(getByRole('button', { name: /ETS/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('clicking a chip fires ontoggle(modelName)', async () => {
    const spy = vi.fn();
    const { getByRole } = render(ForecastLegend, {
      availableModels: ALL_FIVE_BAU,
      visibleModels: new Set(['sarimax_bau', 'naive_dow']),
      ontoggle: spy
    });
    // Anchor regex — /Prophet/ alone matches both Prophet and NeuralProphet.
    await fireEvent.click(getByRole('button', { name: /^Prophet$/ }));
    expect(spy).toHaveBeenCalledWith('prophet');
  });

  it('models NOT in availableModels render disabled (aria-disabled=true) and do not fire ontoggle', async () => {
    const spy = vi.fn();
    const { getByRole } = render(ForecastLegend, {
      availableModels: ALL_FIVE_BAU,    // chronos + neuralprophet absent
      visibleModels: new Set(['sarimax_bau', 'naive_dow']),
      ontoggle: spy
    });
    const chronosChip = getByRole('button', { name: /Chronos/ });
    expect(chronosChip).toHaveAttribute('aria-disabled', 'true');
    await fireEvent.click(chronosChip);
    expect(spy).not.toHaveBeenCalled();
  });

  it('disabled chips render at 40% opacity (className includes opacity-40)', () => {
    const { getByRole } = render(ForecastLegend, {
      availableModels: ALL_FIVE_BAU,
      visibleModels: new Set(['sarimax_bau', 'naive_dow']),
      ontoggle: () => {}
    });
    const chronosChip = getByRole('button', { name: /Chronos/ });
    expect(chronosChip.className).toMatch(/opacity-40/);
  });

  it('chip dot color matches FORECAST_MODEL_COLORS for that model', () => {
    const { container } = render(ForecastLegend, {
      availableModels: ALL_FIVE_BAU,
      visibleModels: new Set(['sarimax_bau']),
      ontoggle: () => {}
    });
    // SARIMAX dot uses inline style background-color = #4e79a7 (schemeTableau10[0]).
    // JSDOM normalises inline hex into rgb() form when it serialises style,
    // so accept either notation — the source-of-truth is the component's
    // string template; both representations are byte-equivalent CSS values.
    const sarimaxBtn = container.querySelector('[data-model="sarimax_bau"]');
    const dot = sarimaxBtn?.querySelector('[data-testid="legend-dot"]');
    const style = dot?.getAttribute('style') ?? '';
    expect(style).toMatch(/#4e79a7|rgb\(\s*78\s*,\s*121\s*,\s*167\s*\)/i);
  });

  it('container is a horizontal-scroll row (overflow-x-auto)', () => {
    const { container } = render(ForecastLegend, {
      availableModels: ALL_FIVE_BAU,
      visibleModels: new Set(['sarimax_bau']),
      ontoggle: () => {}
    });
    const row = container.querySelector('[data-testid="forecast-legend"]');
    expect(row?.className ?? '').toMatch(/overflow-x-auto/);
  });
});
