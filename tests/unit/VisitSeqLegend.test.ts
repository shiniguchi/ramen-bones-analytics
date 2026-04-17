// @vitest-environment jsdom
// Phase 10 Plan 05 — RED test for VisitSeqLegend (D-08).
// Flips GREEN when src/lib/components/VisitSeqLegend.svelte ships the
// 8-swatch horizontal gradient + optional Cash swatch.
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
import VisitSeqLegend from '../../src/lib/components/VisitSeqLegend.svelte';
import { VISIT_SEQ_COLORS, CASH_COLOR } from '../../src/lib/chartPalettes';

describe('VisitSeqLegend (D-08)', () => {
  it('renders 8 colored swatches matching VISIT_SEQ_COLORS', () => {
    const { container } = render(VisitSeqLegend, { showCash: true });
    const gradient = container.querySelector('[data-testid="visit-seq-gradient"]');
    expect(gradient).toBeTruthy();
    const swatches = gradient!.querySelectorAll('div');
    expect(swatches.length).toBe(VISIT_SEQ_COLORS.length);
  });

  it('renders "1st" and "8x+" labels at gradient ends', () => {
    const { container } = render(VisitSeqLegend, { showCash: true });
    expect(container.textContent).toContain('1st');
    expect(container.textContent).toContain('8x+');
  });

  it('renders cash swatch + "Cash" label when showCash=true', () => {
    const { container } = render(VisitSeqLegend, { showCash: true });
    const cashSwatch = container.querySelector('[data-testid="cash-swatch"]');
    expect(cashSwatch).toBeTruthy();
    expect(container.textContent).toContain('Cash');
    // JSDOM normalizes hex to rgb; compare computed style instead of raw attr.
    expect((cashSwatch as HTMLElement).style.backgroundColor).toBe('rgb(161, 161, 170)');
    // Source of truth reference (palette constant still load-bearing).
    expect(CASH_COLOR).toBe('#a1a1aa');
  });

  it('hides cash swatch + "Cash" label when showCash=false', () => {
    const { container } = render(VisitSeqLegend, { showCash: false });
    const cashSwatch = container.querySelector('[data-testid="cash-swatch"]');
    expect(cashSwatch).toBeFalsy();
    expect(container.textContent).not.toContain('Cash');
  });
});
