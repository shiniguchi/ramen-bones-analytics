// @vitest-environment node
// TDD RED — Task 1: loader kpi shape + sumKpi helper.
// Flips to GREEN after +page.server.ts is extended in Task 1 GREEN.
import { describe, it, expect } from 'vitest';

// sumKpi is a pure helper extracted from the loader.
// It takes an array of kpi_daily_v rows and returns aggregated totals.
import { sumKpi } from '../../src/lib/kpiAgg';

describe('sumKpi helper', () => {
  it('returns zero-value object for empty array', () => {
    const result = sumKpi([]);
    expect(result.revenue_cents).toBe(0);
    expect(result.tx_count).toBe(0);
    expect(result.avg_ticket_cents).toBe(0);
  });

  it('sums revenue_cents and tx_count across rows', () => {
    const rows = [
      { revenue_cents: 10000, tx_count: 5, avg_ticket_cents: 2000 },
      { revenue_cents: 20000, tx_count: 10, avg_ticket_cents: 2000 }
    ];
    const result = sumKpi(rows);
    expect(result.revenue_cents).toBe(30000);
    expect(result.tx_count).toBe(15);
  });

  it('recomputes avg_ticket_cents as revenue/tx (not averaged avg)', () => {
    // Revenue=30000, tx=15 → avg = 2000 exactly
    const rows = [
      { revenue_cents: 10000, tx_count: 5, avg_ticket_cents: 2000 },
      { revenue_cents: 20000, tx_count: 10, avg_ticket_cents: 2000 }
    ];
    const result = sumKpi(rows);
    expect(result.avg_ticket_cents).toBe(2000);
  });

  it('avg_ticket_cents is 0 when tx_count is 0 (zero-safe)', () => {
    const result = sumKpi([]);
    expect(result.avg_ticket_cents).toBe(0);
  });

  it('handles null/undefined rows gracefully (null from failed query)', () => {
    // When a kpi query errors the loader passes null; sumKpi treats it as empty
    const result = sumKpi(null);
    expect(result.revenue_cents).toBe(0);
    expect(result.tx_count).toBe(0);
    expect(result.avg_ticket_cents).toBe(0);
  });
});
