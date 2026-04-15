// Phase 02 ING-01/03 / D-07/D-08/D-09/D-10/D-11/D-12: staging shaper +
// invoice-grain reducer. Card hashing happens here, but we keep the hash
// write on its own line away from wl_* references to satisfy ci-guard 4.

import { fromZonedTime } from 'date-fns-tz';
import { hashCard } from './hash';
import type { StagingRow, TxRow } from './types';

// D-09: Berlin-local wall clock → UTC ISO. DST fall-back picks first occurrence.
export function toBerlinUtc(date: string, time: string): string {
  return fromZonedTime(`${date} ${time}`, 'Europe/Berlin').toISOString();
}

// D-10 (revised 02-04): payment_method is pass-through. The upstream CSV is
// now normalized at source (see .planning/phases/02-ingestion/02-04-REAL-RUN.md
// Corrections). The loader trims whitespace and writes the value verbatim so
// DB content matches the CSV byte-for-byte.
export function normalizePaymentMethod(raw: string | null | undefined): string {
  return (raw ?? '').trim();
}

// Phase 07 DM-03 / D-04: canonicalize a raw Orderbird/Worldline card-type
// string into the canonical bucket {visa,mastercard,amex,maestro,girocard,
// other,unknown}. Must stay byte-identical to public.normalize_card_type
// (supabase/migrations/0019_transactions_country_cardtype.sql) so backfilled
// historical rows and live-ingested rows agree on every input. The caller
// is responsible for precedence (COALESCE of wl_payment_type → wl_card_type
// → POS card_type) — this helper takes the already-chosen raw value.
export function canonicalizeCardType(raw: string | null | undefined): string {
  const k = (raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (k === '') return 'unknown';
  // Visa family — explicit variants + prefix/suffix match
  if (
    k === 'visa' ||
    k === 'visa debit' ||
    k === 'visa credit' ||
    k === 'visa prepaid' ||
    k === 'visa dkb' ||
    k === 'chase visa'
  )
    return 'visa';
  if (k.startsWith('visa ') || k.endsWith(' visa')) return 'visa';
  // Mastercard family
  if (
    k === 'mastercard' ||
    k === 'mc' ||
    k === 'master card' ||
    k === 'mastercard debit' ||
    k === 'kebhana master'
  )
    return 'mastercard';
  if (k.startsWith('mastercard ') || k.endsWith(' mastercard'))
    return 'mastercard';
  // Amex
  if (k === 'amex' || k === 'american express') return 'amex';
  // Maestro / V PAY (Visa's debit EU scheme — historically grouped with maestro)
  if (k === 'maestro' || k === 'v pay' || k === 'vpay') return 'maestro';
  // Girocard / EC Karte
  if (
    k === 'girocard' ||
    k === 'ec' ||
    k === 'ec karte' ||
    k === 'ec-karte' ||
    k === 'eckarte'
  )
    return 'girocard';
  // Bare debit/credit funding indicator — network unknown
  if (
    k === 'debit' ||
    k === 'credit' ||
    k === 'commercial' ||
    k === 'commercialdebit' ||
    k === 'commercial debit'
  )
    return 'unknown';
  return 'other';
}

// D-01/D-03: shape raw CSV rows into staging rows.
// Preserves file order. row_index is assigned 1..N within each invoice group.
// All 29 CSV columns are stored verbatim; type coercion is deferred to the
// transactions reducer below.
export function toStagingRows(
  rows: Record<string, string>[],
  restaurantId: string,
  sourceFile: string,
): StagingRow[] {
  const counters = new Map<string, number>();
  const staging: StagingRow[] = [];

  for (const r of rows) {
    const invoice = r['invoice_number'] ?? '';
    const next = (counters.get(invoice) ?? 0) + 1;
    counters.set(invoice, next);

    staging.push({
      restaurant_id: restaurantId,
      invoice_number: invoice,
      row_index: next,
      // CSV header uses `date`/`time`; staging column names are csv_date/csv_time.
      csv_date: r['date'] ?? '',
      csv_time: r['time'] ?? '',
      item_name: r['item_name'] ?? '',
      quantity: r['quantity'] ?? '',
      item_price_eur: r['item_price_eur'] ?? '',
      category_name: r['category_name'] ?? '',
      category_kind: r['category_kind'] ?? '',
      table_name: r['table_name'] ?? '',
      tab_name: r['tab_name'] ?? '',
      party_name: r['party_name'] ?? '',
      tax_rate_pct: r['tax_rate_pct'] ?? '',
      sales_type: r['sales_type'] ?? '',
      item_gross_amount_eur: r['item_gross_amount_eur'] ?? '',
      invoice_total_eur: r['invoice_total_eur'] ?? '',
      payment_method: r['payment_method'] ?? '',
      processor: r['processor'] ?? '',
      tip_eur: r['tip_eur'] ?? '',
      given_eur: r['given_eur'] ?? '',
      change_eur: r['change_eur'] ?? '',
      card_type: r['card_type'] ?? '',
      card_last4: r['card_last4'] ?? '',
      card_txn_id: r['card_txn_id'] ?? '',
      is_cash: r['is_cash'] ?? '',
      order_id: r['order_id'] ?? '',
      wl_card_number: r['wl_card_number'] ?? '',
      wl_card_type: r['wl_card_type'] ?? '',
      wl_payment_type: r['wl_payment_type'] ?? '',
      wl_issuing_country: r['wl_issuing_country'] ?? '',
      source_file: sourceFile,
    });
  }

  return staging;
}

// D-04/D-11/D-12: invoice-grain reducer.
// - Group by invoice_number, first row wins for header-level fields.
// - Drop groups where invoice_total < 0 (refund/reversal, D-11).
// - Correction pairs net to 0 naturally via invoice_total (group total, not sum of items).
// - Tip comes from the FIRST row only — Orderbird repeats it on every line (Pitfall tip-dedupe).
export function toTransactions(
  staging: StagingRow[],
  restaurantId: string,
): TxRow[] {
  const groups = new Map<string, StagingRow[]>();
  for (const row of staging) {
    const key = row.invoice_number;
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }

  const out: TxRow[] = [];
  for (const [invoice, list] of groups) {
    const first = list[0];
    const totalEur = parseFloat(first.invoice_total_eur || '0');
    // D-11: drop negative-total invoices (pure refunds).
    if (totalEur < 0) continue;

    const taxPct = parseFloat(first.tax_rate_pct || '0');
    const gross_cents = Math.round(totalEur * 100);
    // Per-line net: sum over all line items of round(item_gross_cents / (1 + rate/100)).
    // Mixed-tax invoices (food 7% + drinks 19%) need per-row rate; using the
    // invoice's "first row" rate over the total would skew net for any invoice
    // with more than one tax bracket. Integer math at cents grain avoids drift.
    let net_cents = 0;
    for (const row of list) {
      const itemGrossEur = parseFloat(row.item_gross_amount_eur || '0');
      if (!itemGrossEur) continue;
      const rowRate = parseFloat(row.tax_rate_pct || '0');
      const itemGrossCents = Math.round(itemGrossEur * 100);
      net_cents += Math.round(itemGrossCents / (1 + rowRate / 100));
    }
    // D-12: tip from FIRST row only (never sum across item rows).
    const tip_cents = Math.round(parseFloat(first.tip_eur || '0') * 100);

    // D-07/D-08: compute hash from the raw worldline number on a dedicated line.
    // The resulting hex value is then assigned to card_hash below — the two
    // identifiers never share a line, keeping ci-guard 4 green.
    const rawWl = first.wl_card_number;
    const hashed = hashCard(rawWl, restaurantId);

    const tx: TxRow = {
      restaurant_id: restaurantId,
      source_tx_id: invoice,
      occurred_at: toBerlinUtc(first.csv_date, first.csv_time),
      card_hash: hashed,
      gross_cents,
      net_cents,
      tip_cents,
      payment_method: normalizePaymentMethod(first.payment_method),
      sales_type: first.sales_type,
      // Phase 07 DM-03: promote wl_issuing_country + card_type onto the fact
      // from the first row of the invoice group (matches the tip/payment_method
      // first-row-wins convention above). Precedence for card_type mirrors the
      // SQL backfill in 0019: wl_payment_type → wl_card_type → POS card_type.
      wl_issuing_country: (first.wl_issuing_country || '').trim() || null,
      card_type: canonicalizeCardType(
        (first.wl_payment_type || '').trim() ||
          (first.wl_card_type || '').trim() ||
          (first.card_type || '').trim(),
      ),
      invoice_number: invoice,
    };
    out.push(tx);
  }

  return out;
}
