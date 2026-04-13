// Phase 02 D-02/D-13: Storage → CSV text download.
// Uses service-role client (caller's responsibility to construct it so we can
// share a single client across download + upsert).

import type { SupabaseClient } from '@supabase/supabase-js';

export async function downloadCsv(
  client: SupabaseClient,
  bucket: string,
  object: string,
): Promise<string> {
  const { data, error } = await client.storage.from(bucket).download(object);
  if (error || !data) {
    throw new Error(
      `Failed to download ${bucket}/${object}: ${error?.message ?? 'no data'}`,
    );
  }
  return await data.text();
}
