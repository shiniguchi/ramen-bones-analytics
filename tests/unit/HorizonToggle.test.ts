// @vitest-environment jsdom
// tests/unit/HorizonToggle.test.ts
// Phase 15 FUI-03 — 4-chip selector. Default 7d. Click emits both
// onhorizonchange(horizon) and ongranularitychange(default-grain-for-horizon).
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import HorizonToggle from '../../src/lib/components/HorizonToggle.svelte';

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

describe('HorizonToggle', () => {
  it('renders 4 chips: 7d / 5w / 4mo / 1yr', () => {
    const { getByRole } = render(HorizonToggle, {
      horizon: 7,
      onhorizonchange: () => {},
      ongranularitychange: () => {}
    });
    expect(getByRole('radio', { name: /7d/ })).toBeInTheDocument();
    expect(getByRole('radio', { name: /5w/ })).toBeInTheDocument();
    expect(getByRole('radio', { name: /4mo/ })).toBeInTheDocument();
    expect(getByRole('radio', { name: /1yr/ })).toBeInTheDocument();
  });

  it('marks the active chip with aria-checked=true matching prop', () => {
    const { getByRole } = render(HorizonToggle, {
      horizon: 35,
      onhorizonchange: () => {},
      ongranularitychange: () => {}
    });
    const active = getByRole('radio', { name: /5w/ });
    expect(active).toHaveAttribute('aria-checked', 'true');
    const inactive = getByRole('radio', { name: /7d/ });
    expect(inactive).toHaveAttribute('aria-checked', 'false');
  });

  it('clicking 1yr fires onhorizonchange(365) AND ongranularitychange("month") via D-11 default', async () => {
    const horizonSpy = vi.fn();
    const granSpy = vi.fn();
    const { getByRole } = render(HorizonToggle, {
      horizon: 7,
      onhorizonchange: horizonSpy,
      ongranularitychange: granSpy
    });
    await fireEvent.click(getByRole('radio', { name: /1yr/ }));
    expect(horizonSpy).toHaveBeenCalledWith(365);
    expect(granSpy).toHaveBeenCalledWith('month');
  });

  it('clicking 5w fires onhorizonchange(35) + ongranularitychange("day") (smallest valid grain)', async () => {
    const horizonSpy = vi.fn();
    const granSpy = vi.fn();
    const { getByRole } = render(HorizonToggle, {
      horizon: 7,
      onhorizonchange: horizonSpy,
      ongranularitychange: granSpy
    });
    await fireEvent.click(getByRole('radio', { name: /5w/ }));
    expect(horizonSpy).toHaveBeenCalledWith(35);
    expect(granSpy).toHaveBeenCalledWith('day');
  });

  it('clicking 4mo fires onhorizonchange(120) + ongranularitychange("week")', async () => {
    const horizonSpy = vi.fn();
    const granSpy = vi.fn();
    const { getByRole } = render(HorizonToggle, {
      horizon: 7,
      onhorizonchange: horizonSpy,
      ongranularitychange: granSpy
    });
    await fireEvent.click(getByRole('radio', { name: /4mo/ }));
    expect(horizonSpy).toHaveBeenCalledWith(120);
    expect(granSpy).toHaveBeenCalledWith('week');
  });

  it('chip buttons each have min-h-11 class for touch-target spec', () => {
    const { getAllByRole } = render(HorizonToggle, {
      horizon: 7,
      onhorizonchange: () => {},
      ongranularitychange: () => {}
    });
    const chips = getAllByRole('radio');
    for (const c of chips) {
      expect(c.className).toMatch(/min-h-11/);
    }
  });
});
