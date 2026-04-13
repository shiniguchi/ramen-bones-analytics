import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// Plan 03 will create scripts/ingest/parse.ts and scripts/ingest/normalize.ts.
// Until then, these imports fail with "Cannot find module" — the RED signal.
import { parseCsv } from '../../scripts/ingest/parse';
import { toStagingRows, toTransactions } from '../../scripts/ingest/normalize';

const RID = '00000000-0000-0000-0000-000000000001';
const SOURCE = 'sample.csv';

const fixtureText = readFileSync(
  resolve(__dirname, 'fixtures/sample.csv'),
  'utf-8'
);

describe('toStagingRows + toTransactions (ING-01, ING-03)', () => {
  it('parses every CSV data row into a staging row (1:1)', () => {
    const rows = parseCsv(fixtureText);
    const staging = toStagingRows(rows, RID, SOURCE);
    expect(staging.length).toBe(rows.length);
    expect(staging.length).toBe(24);
  });

  it('T-3 split-bill: 3 staging rows with row_index 1,2,3 (no PK collision)', () => {
    const rows = parseCsv(fixtureText);
    const staging = toStagingRows(rows, RID, SOURCE);
    const t3 = staging.filter((r: any) => r.invoice_number === 'T-3');
    expect(t3.length).toBe(3);
    const indexes = t3.map((r: any) => r.row_index).sort();
    expect(indexes).toEqual([1, 2, 3]);
  });

  it('T-4 correction pair nets to 0 → exactly 1 transaction row, gross_cents=0', () => {
    const rows = parseCsv(fixtureText);
    const staging = toStagingRows(rows, RID, SOURCE);
    const tx = toTransactions(staging, RID);
    const t4 = tx.filter((t: any) => t.invoice_number === 'T-4');
    expect(t4.length).toBe(1);
    expect(t4[0].gross_cents).toBe(0);
  });

  it('T-5 negative-total invoice produces 0 transaction rows (D-11)', () => {
    const rows = parseCsv(fixtureText);
    const staging = toStagingRows(rows, RID, SOURCE);
    const tx = toTransactions(staging, RID);
    const t5 = tx.filter((t: any) => t.invoice_number === 'T-5');
    expect(t5.length).toBe(0);
  });

  it('T-11 tip 5.00 repeated on 3 rows → tx.tip_cents=500, NOT 1500 (D-12)', () => {
    const rows = parseCsv(fixtureText);
    const staging = toStagingRows(rows, RID, SOURCE);
    const tx = toTransactions(staging, RID);
    const t11 = tx.find((t: any) => t.invoice_number === 'T-11');
    expect(t11).toBeDefined();
    expect(t11!.tip_cents).toBe(500);
  });

  it('T-8 MASTERCARD normalizes to MasterCard in transactions (D-10)', () => {
    const rows = parseCsv(fixtureText);
    const staging = toStagingRows(rows, RID, SOURCE);
    const tx = toTransactions(staging, RID);
    const t8 = tx.find((t: any) => t.invoice_number === 'T-8');
    expect(t8).toBeDefined();
    expect(t8!.payment_method).toBe('MasterCard');
  });

  it('T-7 DST fall-back row 2025-10-26 02:30 Berlin → valid UTC ISO timestamp', () => {
    const rows = parseCsv(fixtureText);
    const staging = toStagingRows(rows, RID, SOURCE);
    const tx = toTransactions(staging, RID);
    const t7 = tx.find((t: any) => t.invoice_number === 'T-7');
    expect(t7).toBeDefined();
    const d = new Date(t7!.occurred_at);
    expect(Number.isNaN(d.getTime())).toBe(false);
  });

  it('T-6 missing wl_card_number → staging row exists but tx.card_hash is NULL', () => {
    const rows = parseCsv(fixtureText);
    const staging = toStagingRows(rows, RID, SOURCE);
    const t6Stg = staging.filter((r: any) => r.invoice_number === 'T-6');
    expect(t6Stg.length).toBe(1);
    const tx = toTransactions(staging, RID);
    const t6 = tx.find((t: any) => t.invoice_number === 'T-6');
    expect(t6).toBeDefined();
    expect(t6!.card_hash).toBeNull();
  });
});
