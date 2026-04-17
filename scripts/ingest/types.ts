// Phase 02 ING-01/02/03/04: shared types for the CSV ingest loader.
// StagingRow mirrors stg_orderbird_order_items (migration 0007): 29 CSV columns
// plus restaurant_id, invoice_number, row_index, source_file. ingested_at is
// defaulted server-side.

export interface StagingRow {
  restaurant_id: string;
  invoice_number: string;
  row_index: number;
  // 29 CSV columns (text mirror, strict parsing deferred to loader)
  csv_date: string;
  csv_time: string;
  item_name: string;
  quantity: string;
  item_price_eur: string;
  category_name: string;
  category_kind: string;
  table_name: string;
  tab_name: string;
  party_name: string;
  tax_rate_pct: string;
  sales_type: string;
  item_gross_amount_eur: string;
  invoice_total_eur: string;
  payment_method: string;
  processor: string;
  tip_eur: string;
  given_eur: string;
  change_eur: string;
  card_type: string;
  card_last4: string;
  card_txn_id: string;
  is_cash: string;
  order_id: string;
  wl_card_number: string;
  wl_card_type: string;
  wl_payment_type: string;
  wl_issuing_country: string;
  // loader audit
  source_file: string;
}

// TxRow: invoice-grain transaction written to public.transactions.
// Note: card_hash is computed BEFORE this object is built (D-07) — the hash
// never co-exists with wl_card_number in any single statement or literal.
export interface TxRow {
  restaurant_id: string;
  source_tx_id: string;
  occurred_at: string;
  card_hash: string | null;
  gross_cents: number;
  net_cents: number;
  tip_cents: number;
  payment_method: string;
  sales_type: string;
  // Phase 07 DM-01/DM-03: promoted from stg_orderbird_order_items.
  // wl_issuing_country is ISO-3166-1 alpha-2 (char(2)) or NULL for cash/blackout.
  // card_type is canonical {visa,mastercard,amex,maestro,girocard,other,unknown};
  // never NULL — loader writes 'unknown' as the floor value.
  wl_issuing_country: string | null;
  card_type: string;
  // Not a DB column; kept on the row for test assertions and log grouping.
  invoice_number: string;
}

export interface IngestReport {
  rows_read: number;
  invoices_deduped: number;
  staging_upserted: number;
  transactions_new: number;
  transactions_updated: number;
  cash_rows_excluded: number;
  missing_worldline_rows: number;
  errors: number;
}
