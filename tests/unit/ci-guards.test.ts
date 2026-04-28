// tests/unit/ci-guards.test.ts
//
// Contract test for scripts/ci-guards.sh — Phase 3 D-24 raw table guard.
//
// This file is RED until Plan 03-05 extends the ci-guards.sh Guard 1 regex
// to also match `.from('transactions')`-style raw table references from src/.
// Today Guard 1 only catches `*_mv` identifiers, so:
//
//   - "FAILS when src/ references cohort_mv"             → passes now (existing guard)
//   - "FAILS when src/ references .from('transactions')" → RED until Plan 05 extends guard
//   - "PASSES when src/ has no raw refs"                 → passes now
//
// The middle case is the Nyquist signal that the guard has been properly
// upgraded. Do NOT weaken the assertion to make it green — Plan 05 fixes it.

import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync, existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

const EVIL = join(process.cwd(), 'src/lib/evil.ts');
const SRC_LIB = dirname(EVIL);
const SRC_ROOT = join(process.cwd(), 'src');
// Track whether src/ existed before the test — if we created it, clean it up.
const srcExistedBefore = existsSync(SRC_ROOT);

describe('ci-guards.sh — Phase 3 D-24 raw table guard', () => {
  afterEach(() => {
    if (existsSync(EVIL)) unlinkSync(EVIL);
    // Only remove src/ if this test created it (Phase 1-3 has no src/ yet).
    if (!srcExistedBefore && existsSync(SRC_ROOT)) {
      rmSync(SRC_ROOT, { recursive: true, force: true });
    }
  });

  it('FAILS when src/ references cohort_mv', () => {
    mkdirSync(SRC_LIB, { recursive: true });
    writeFileSync(EVIL, "export const x = 'select * from cohort_mv';\n");
    expect(() => execSync('bash scripts/ci-guards.sh', { stdio: 'pipe' })).toThrow();
  });

  it("FAILS when src/ references .from('transactions')", () => {
    mkdirSync(SRC_LIB, { recursive: true });
    writeFileSync(EVIL, "supabase.from('transactions').select('*');\n");
    // RED until Plan 03-05 extends Guard 1 regex to match .from('transactions').
    expect(() => execSync('bash scripts/ci-guards.sh', { stdio: 'pipe' })).toThrow();
  });

  it('PASSES when src/ has no raw refs', () => {
    // Ensure no leftover evil file from a parallel/prior case.
    if (existsSync(EVIL)) unlinkSync(EVIL);
    expect(() => execSync('bash scripts/ci-guards.sh', { stdio: 'pipe' })).not.toThrow();
  });
});

// Phase 12 FND-10 / D-09..D-11: Guard 7 — JWT claim is `restaurant_id`,
// not `tenant_id`. The fixture at tests/ci-guards/red-team-tenant-id.sql
// is checked into the repo. This test copies it into supabase/migrations/
// as a temp file so Guard 7's grep scans it, runs the guard script, and
// asserts the guard fires (throw / exit 1). Then it cleans up the temp
// file so subsequent runs of ci-guards.sh stay green.
describe('ci-guards.sh — Phase 12 FND-10 Guard 7 (tenant_id regression)', () => {
  const FIXTURE_PATH = join(process.cwd(), 'tests/ci-guards/red-team-tenant-id.sql');
  const TEMP_MIGRATION = join(process.cwd(), 'supabase/migrations/9999_red_team_tenant_id_test.sql');

  afterEach(() => {
    if (existsSync(TEMP_MIGRATION)) unlinkSync(TEMP_MIGRATION);
  });

  it('FAILS when supabase/migrations/ contains auth.jwt()->>\'tenant_id\'', () => {
    // Sanity: the fixture must exist (Task 2 of Plan 12-03 created it).
    expect(existsSync(FIXTURE_PATH)).toBe(true);
    const fixture = readFileSync(FIXTURE_PATH, 'utf8');

    // Copy the fixture into supabase/migrations/ so Guard 7 sees it.
    writeFileSync(TEMP_MIGRATION, fixture);

    // Guard 7 must throw — script exits 1 with ::error::Guard 7 FAILED.
    expect(() => execSync('bash scripts/ci-guards.sh', { stdio: 'pipe' })).toThrow();
  });

  it('PASSES when supabase/migrations/ has no tenant_id JWT references', () => {
    // No temp file written this case — supabase/migrations/ is in its
    // committed-state-only form, which is verified clean (all migrations
    // use auth.jwt()->>'restaurant_id').
    expect(() => execSync('bash scripts/ci-guards.sh', { stdio: 'pipe' })).not.toThrow();
  });
});
