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
import { writeFileSync, unlinkSync, existsSync, mkdirSync, rmSync } from 'node:fs';
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
