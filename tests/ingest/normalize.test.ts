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
    expect(staging.length).toBe(30);
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

  it('T-8 payment_method passes through verbatim (trim only, no case mapping)', () => {
    // Revised 02-04: upstream CSV is now normalized at source; loader is
    // pass-through. T-8 fixture uses the raw uppercased "MASTERCARD" value
    // and must survive verbatim through to transactions.payment_method.
    const rows = parseCsv(fixtureText);
    const staging = toStagingRows(rows, RID, SOURCE);
    const tx = toTransactions(staging, RID);
    const t8 = tx.find((t: any) => t.invoice_number === 'T-8');
    expect(t8).toBeDefined();
    expect(t8!.payment_method).toBe('MASTERCARD');
  });

  it('pass-through preserves proper-cased payment methods verbatim', async () => {
    // Smoke test: the real CSV uses proper-cased values like "MasterCard"
    // and "Visa Electron". Confirm the normalize function does not mangle
    // them (no lowercase, no title-case re-casing).
    const { normalizePaymentMethod } = await import(
      '../../scripts/ingest/normalize'
    );
    expect(normalizePaymentMethod('MasterCard')).toBe('MasterCard');
    expect(normalizePaymentMethod('Visa Electron')).toBe('Visa Electron');
    expect(normalizePaymentMethod('  Bar  ')).toBe('Bar');
    expect(normalizePaymentMethod('')).toBe('');
    expect(normalizePaymentMethod(null)).toBe('');
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

  it('single-rate invoice (T-1, two items @ 7%) → net matches naive per-invoice formula', () => {
    // T-1: item_gross 15.00 + 10.00 = 25.00 (note: invoice_total_eur is 28.00,
    // which includes a 3.00 tip line conceptually, but our net is derived from
    // per-line item_gross_amount_eur, not invoice_total). Per-line math:
    //   round(1500 / 1.07) + round(1000 / 1.07) = 1402 + 935 = 2337
    const rows = parseCsv(fixtureText);
    const staging = toStagingRows(rows, RID, SOURCE);
    const tx = toTransactions(staging, RID);
    const t1 = tx.find((t: any) => t.invoice_number === 'T-1');
    expect(t1).toBeDefined();
    expect(t1!.net_cents).toBe(1402 + 935);
  });

  it('mixed-rate invoice (T-11: 15€ @7% + 10€ @7% + 20€ @19%) → per-line net', () => {
    // Per-line: round(1500/1.07) + round(1000/1.07) + round(2000/1.19)
    //         = 1402 + 935 + 1681 = 4018
    // The naive invoice-level formula using first row's 7% would give
    // round(5000 / 1.07) = 4673, which is wrong.
    const rows = parseCsv(fixtureText);
    const staging = toStagingRows(rows, RID, SOURCE);
    const tx = toTransactions(staging, RID);
    const t11 = tx.find((t: any) => t.invoice_number === 'T-11');
    expect(t11).toBeDefined();
    expect(t11!.net_cents).toBe(1402 + 935 + 1681);
  });

  describe('canonicalizeCardType (Wave 2 — DM-03, D-04)', () => {
    it('maps Worldline card types + POS fallback to canonical buckets', async () => {
      const { canonicalizeCardType } = await import(
        '../../scripts/ingest/normalize'
      );
      // Canonical network mappings (single-arg raw form)
      expect(canonicalizeCardType('Visa')).toBe('visa');
      expect(canonicalizeCardType('VISA')).toBe('visa');
      expect(canonicalizeCardType('MasterCard')).toBe('mastercard');
      expect(canonicalizeCardType('mc')).toBe('mastercard');
      expect(canonicalizeCardType('Master Card')).toBe('mastercard');
      expect(canonicalizeCardType('girocard')).toBe('girocard');
      expect(canonicalizeCardType('EC')).toBe('girocard');
      expect(canonicalizeCardType('american express')).toBe('amex');
      expect(canonicalizeCardType('Maestro')).toBe('maestro');
      // Empty / null → unknown
      expect(canonicalizeCardType('')).toBe('unknown');
      expect(canonicalizeCardType(null)).toBe('unknown');
      // Bare Debit/Credit funding flags → unknown (they are not networks)
      expect(canonicalizeCardType('Debit')).toBe('unknown');
      expect(canonicalizeCardType('Credit')).toBe('unknown');
      // Long-tail → other
      expect(canonicalizeCardType('Diners')).toBe('other');
    });

    it('matches every entry in canonical-card-types.json (TS↔SQL identity)', async () => {
      const { canonicalizeCardType } = await import(
        '../../scripts/ingest/normalize'
      );
      const fixturePath = resolve(
        __dirname,
        'fixtures/canonical-card-types.json',
      );
      const entries = JSON.parse(readFileSync(fixturePath, 'utf-8')) as Array<{
        input: string | null;
        expected: string;
      }>;
      for (const { input, expected } of entries) {
        expect(canonicalizeCardType(input)).toBe(expected);
      }
    });

    it('T-FALLBACK invoice: wl_* empty + POS card_type=Visa → card_type=visa', () => {
      // Reducer path proof: the T-FALLBACK fixture row has wl_payment_type='',
      // wl_card_type='', card_type='Visa'. The loader must fall through to the
      // POS entry and produce canonical 'visa'.
      const rows = parseCsv(fixtureText);
      const staging = toStagingRows(rows, RID, SOURCE);
      const tx = toTransactions(staging, RID);
      const tFallback = tx.find(
        (t: any) => t.invoice_number === 'T-FALLBACK',
      );
      expect(tFallback).toBeDefined();
      expect((tFallback as any).card_type).toBe('visa');
    });

    it('T-UNK cash invoice: wl_* + POS empty → card_type=unknown, country=null', () => {
      const rows = parseCsv(fixtureText);
      const staging = toStagingRows(rows, RID, SOURCE);
      const tx = toTransactions(staging, RID);
      const tUnk = tx.find((t: any) => t.invoice_number === 'T-UNK');
      expect(tUnk).toBeDefined();
      expect((tUnk as any).card_type).toBe('unknown');
      expect((tUnk as any).wl_issuing_country).toBeNull();
    });

    it('T-MC invoice: wl_payment_type=MasterCard + country AT → card_type=mastercard, country=AT', () => {
      const rows = parseCsv(fixtureText);
      const staging = toStagingRows(rows, RID, SOURCE);
      const tx = toTransactions(staging, RID);
      const tMc = tx.find((t: any) => t.invoice_number === 'T-MC');
      expect(tMc).toBeDefined();
      expect((tMc as any).card_type).toBe('mastercard');
      expect((tMc as any).wl_issuing_country).toBe('AT');
    });
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
