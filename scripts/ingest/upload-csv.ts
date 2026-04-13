// One-off uploader: local CSV → Supabase Storage via service-role client.
// Used for Phase 02-04 real-run to stage the Orderbird export into DEV.
// Usage: npx tsx scripts/ingest/upload-csv.ts <localPath> <bucket> <objectPath>

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const [, , localPath, bucket, objectPath] = process.argv;
  if (!localPath || !bucket || !objectPath) {
    console.error('usage: tsx upload-csv.ts <localPath> <bucket> <objectPath>');
    process.exit(1);
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
    process.exit(1);
  }
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const body = readFileSync(localPath);
  const { error } = await client.storage
    .from(bucket)
    .upload(objectPath, body, {
      contentType: 'text/csv',
      upsert: true,
    });
  if (error) {
    console.error('upload failed:', error.message);
    process.exit(1);
  }
  console.log(
    JSON.stringify({
      uploaded: true,
      bucket,
      object: objectPath,
      bytes: body.byteLength,
    }),
  );
}

main();
