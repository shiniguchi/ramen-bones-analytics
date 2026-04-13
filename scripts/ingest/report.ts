// Phase 02 D-18: single-line JSON summary of an ingest run.
// Printed to stdout so GitHub Actions / cron logs can grep a deterministic
// line to detect regressions across nightly runs.

import type { IngestReport } from './types';

export function printReport(r: IngestReport): void {
  console.log(JSON.stringify(r));
}

export function emptyReport(): IngestReport {
  return {
    rows_read: 0,
    invoices_deduped: 0,
    staging_upserted: 0,
    transactions_new: 0,
    transactions_updated: 0,
    cash_rows_excluded: 0,
    missing_worldline_rows: 0,
    errors: 0,
  };
}
