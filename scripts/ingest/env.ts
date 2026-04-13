// Phase 02 D-19/D-20: fail-fast env loader for the CSV ingest job.
// Loads .env at module top, validates required keys, throws with a full
// missing-list so ops can fix all secrets in one pass.

import 'dotenv/config';

export interface IngestEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ORDERBIRD_CSV_BUCKET: string;
  ORDERBIRD_CSV_OBJECT: string;
  RESTAURANT_ID: string;
}

const REQUIRED: (keyof IngestEnv)[] = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ORDERBIRD_CSV_BUCKET',
  'ORDERBIRD_CSV_OBJECT',
  'RESTAURANT_ID',
];

export function loadEnv(): IngestEnv {
  const missing: string[] = [];
  const out = {} as IngestEnv;
  for (const k of REQUIRED) {
    const v = process.env[k];
    if (!v || v.trim() === '') missing.push(k);
    else (out as any)[k] = v;
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`,
    );
  }
  return out;
}
