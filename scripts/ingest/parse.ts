// Phase 02 ING-01 / D-06: strict CSV parser.
// Validates 29 columns exactly. Any header or row shape drift throws loudly
// with the first offending column named. Text-only mirror — no type coercion.

import { parse } from 'csv-parse/sync';

export const ORDERBIRD_COLUMNS = [
  'date',
  'time',
  'item_name',
  'quantity',
  'item_price_eur',
  'category_name',
  'category_kind',
  'table_name',
  'tab_name',
  'party_name',
  'invoice_number',
  'tax_rate_pct',
  'sales_type',
  'item_gross_amount_eur',
  'invoice_total_eur',
  'payment_method',
  'processor',
  'tip_eur',
  'given_eur',
  'change_eur',
  'card_type',
  'card_last4',
  'card_txn_id',
  'is_cash',
  'wl_card_number',
  'wl_card_type',
  'wl_payment_type',
  'wl_issuing_country',
  'order_id',
] as const;

export function parseCsv(text: string): Record<string, string>[] {
  const rows = parse(text, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: false,
    relax_quotes: false,
    trim: false,
  }) as Record<string, string>[];

  if (rows.length === 0) return rows;

  // Header shape validation — first-offending-column message (D-06).
  const headers = Object.keys(rows[0]);
  if (headers.length !== ORDERBIRD_COLUMNS.length) {
    throw new Error(
      `CSV column count mismatch: expected ${ORDERBIRD_COLUMNS.length}, got ${headers.length}`,
    );
  }
  for (let i = 0; i < ORDERBIRD_COLUMNS.length; i++) {
    if (headers[i] !== ORDERBIRD_COLUMNS[i]) {
      throw new Error(
        `CSV column mismatch at position ${i}: expected "${ORDERBIRD_COLUMNS[i]}", got "${headers[i]}"`,
      );
    }
  }
  return rows;
}
