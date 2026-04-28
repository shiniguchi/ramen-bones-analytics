// Phase 02 ING-01/02/03/04: CSV ingest orchestrator.
// One-command path: Storage CSV object → staging upsert → transactions upsert
// → JSON report. Exits non-zero on any error so cron detects failure.

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from './env';
import { downloadCsv } from './download';
import { parseCsv } from './parse';
import { toStagingRows, toTransactions } from './normalize';
import {
  upsertStaging,
  upsertTransactions,
  countTransactions,
} from './upsert';
import { printReport } from './report';
import { refreshAndMaybeTriggerInsight } from './refresh';
import type { IngestReport } from './types';

export async function runIngest(
  opts: { dryRun?: boolean } = {},
): Promise<IngestReport> {
  const env = loadEnv();
  const client = createClient(
    env.SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const csvText = await downloadCsv(
    client,
    env.ORDERBIRD_CSV_BUCKET,
    env.ORDERBIRD_CSV_OBJECT,
  );
  const rows = parseCsv(csvText);
  const staging = toStagingRows(rows, env.RESTAURANT_ID, env.ORDERBIRD_CSV_OBJECT);
  const tx = toTransactions(staging, env.RESTAURANT_ID);

  // Diagnostic counters — read only raw rows, never log row content.
  // Missing-worldline: card-intended row (payment_method != Bar) with blank wl.
  const missingWl = rows.filter((r) => {
    const pm = (r['payment_method'] ?? '').trim().toLowerCase();
    const wlBlank = (r['wl_card_number'] ?? '').trim() === '';
    return wlBlank && pm !== 'bar' && pm !== '';
  }).length;

  // Cash rows: blank wl_card_number (includes T-2 cash + T-9 inferred cash).
  const cashExcluded = rows.filter(
    (r) => (r['wl_card_number'] ?? '').trim() === '',
  ).length;

  if (opts.dryRun) {
    const dryReport: IngestReport = {
      rows_read: rows.length,
      invoices_deduped: tx.length,
      staging_upserted: 0,
      transactions_new: 0,
      transactions_updated: 0,
      cash_rows_excluded: cashExcluded,
      missing_worldline_rows: missingWl,
      errors: 0,
    };
    printReport(dryReport);
    return dryReport;
  }

  const preTxCount = await countTransactions(client, env.RESTAURANT_ID);
  const stagingUpserted = await upsertStaging(client, staging);
  await upsertTransactions(client, tx);
  const postTxCount = await countTransactions(client, env.RESTAURANT_ID);

  const newRows = postTxCount - preTxCount;
  const report: IngestReport = {
    rows_read: rows.length,
    invoices_deduped: tx.length,
    staging_upserted: stagingUpserted,
    transactions_new: newRows,
    transactions_updated: Math.max(0, tx.length - newRows),
    cash_rows_excluded: cashExcluded,
    missing_worldline_rows: missingWl,
    errors: 0,
  };
  printReport(report);

  // Quick task 260428-wmd: replaces the daily pg_cron schedule (migration 0039
  // unschedules `refresh-analytics-mvs` and `generate-insights`). Refreshes MVs
  // and conditionally triggers the Edge Function only when a new complete
  // Mon-Sun week is available compared to the latest insight's business_date.
  // Failures here do not unwind the upsert — the data ingest is the load-bearing
  // outcome; insight refresh is a downstream nicety.
  try {
    const refreshResult = await refreshAndMaybeTriggerInsight(
      client,
      env.SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
      env.RESTAURANT_ID,
    );
    console.log(JSON.stringify({ post_ingest: refreshResult }));
  } catch (err) {
    console.error(
      JSON.stringify({
        post_ingest_error: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  return report;
}

// CLI entry: `npm run ingest` or `npm run ingest -- --dry-run`
const invokedDirectly =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  import.meta.url === `file://${process.argv[1]}`;

if (invokedDirectly) {
  runIngest({ dryRun: process.argv.includes('--dry-run') }).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
