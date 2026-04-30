#!/usr/bin/env node
/*
 * next-step-hint.js
 *
 * Stop hook. Detects current phase + completed step from .planning/ artifacts
 * and emits a "→ Next:" hint so the user (and the next conversational turn)
 * always knows the next workflow command.
 *
 * Trigger condition: only fires when the current branch is
 * `feature/phase-<NN>-<slug>`. On any other branch (main, docs/, fix/) the
 * hook stays silent so general chat sessions are not polluted.
 *
 * Step detection from `.planning/phases/<NN>-<slug>/`:
 *   no CONTEXT.md                     → step 1: discuss
 *   CONTEXT.md, no *-PLAN.md          → step 2: plan
 *   *-PLAN.md present, no *-SUMMARY.md→ step 3: execute
 *   plans summarised, no UAT.md       → step 4: epic-end QA
 *   UAT.md present                    → step 5: ship
 *
 * Reach-for suggestions are loaded from .claude/reach-for.json (data, not
 * markdown) and filtered by `after_step` matching the step the user just
 * finished — so the right add-on options surface at the right moment.
 *
 * Failure mode: any error → exit 0, stderr log. Mirrors visual-verify-nudge.js
 * pattern — the hook never breaks Claude.
 *
 * CommonJS: scoped by sibling .claude/hooks/package.json so this works in
 * repos whose root package.json declares "type": "module".
 */

'use strict'

const fs = require('fs')
const path = require('path')
const { execSync, spawnSync } = require('child_process')

function logErr(where, err) {
  try {
    const msg = err && (err.stack || err.message || String(err))
    process.stderr.write(`[next-step-hint] ${where}: ${msg}\n`)
  } catch { /* never throw from logger */ }
}

const REPO_ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd()
const PHASES_DIR = path.join(REPO_ROOT, '.planning', 'phases')
const REACH_FOR_PATH = path.join(REPO_ROOT, '.claude', 'reach-for.json')
const VALIDATOR_PATH = path.join(REPO_ROOT, '.claude', 'scripts', 'validate-planning-docs.sh')

const STEP = {
  DISCUSS: 1,
  PLAN: 2,
  EXECUTE: 3,
  QA: 4,
  SHIP: 5,
}

const NEXT_BY_STEP = {
  [STEP.DISCUSS]: '/gsd-discuss-phase "<name>"',
  [STEP.PLAN]: '/gsd-plan-phase <NN>   (or: superpowers:using-git-worktrees + writing-plans, if TDD pays off)',
  [STEP.EXECUTE]: '/gsd-execute-phase <NN>   (or: superpowers:subagent-driven-development, if step 2 used Superpowers)',
  [STEP.QA]: 'Epic-end QA: gh workflow run deploy_dev.yml --ref <branch> → /check-logs <services> → /qa-gate → /gsd-verify-work',
  [STEP.SHIP]: '/gsd-ship   (then: superpowers:finishing-a-development-branch)',
}

function getCurrentBranch() {
  try {
    return execSync('git -C ' + JSON.stringify(REPO_ROOT) + ' branch --show-current', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 2000,
    }).trim()
  } catch (err) {
    logErr('getCurrentBranch', err)
    return ''
  }
}

function parsePhaseFromBranch(branch) {
  const m = branch.match(/^feature\/phase-([0-9.]+)-(.+)$/)
  if (!m) return null
  return { number: m[1], slug: m[2] }
}

function findPhaseDir(phaseNumber) {
  if (!fs.existsSync(PHASES_DIR)) return null
  try {
    const entries = fs.readdirSync(PHASES_DIR)
    const match = entries.find(d => d.startsWith(phaseNumber + '-') || d === phaseNumber)
    return match ? path.join(PHASES_DIR, match) : null
  } catch (err) {
    logErr('findPhaseDir', err)
    return null
  }
}

function detectStep(phaseDir) {
  if (!phaseDir || !fs.existsSync(phaseDir)) return STEP.DISCUSS
  let files
  try { files = fs.readdirSync(phaseDir) } catch { return STEP.DISCUSS }

  const has = (re) => files.some(f => re.test(f))
  const hasContext = has(/CONTEXT\.md$/i)
  const planFiles = files.filter(f => /-PLAN\.md$/i.test(f))
  const summaryFiles = files.filter(f => /-SUMMARY\.md$/i.test(f))
  const hasUAT = has(/^UAT\.md$/i) || has(/-UAT\.md$/i)

  if (!hasContext) return STEP.DISCUSS
  if (planFiles.length === 0) return STEP.PLAN
  // Execute is "ongoing" until every plan has a matching summary.
  if (summaryFiles.length < planFiles.length) return STEP.EXECUTE
  if (!hasUAT) return STEP.QA
  return STEP.SHIP
}

function loadReachFor() {
  try {
    const raw = fs.readFileSync(REACH_FOR_PATH, 'utf8')
    const cfg = JSON.parse(raw)
    return Array.isArray(cfg.rows) ? cfg.rows : []
  } catch (err) {
    logErr('loadReachFor', err)
    return []
  }
}

function pickReachFor(rows, step) {
  // Prefer rows whose after_step matches the just-completed step;
  // also include rows with after_step === null (always-applicable).
  const exact = rows.filter(r => r.after_step === step)
  const anytime = rows.filter(r => r.after_step === null)
  return [...exact, ...anytime].slice(0, 2)
}

function runValidator() {
  // Returns { drift: bool, output: string } or null on error/missing.
  // Uses --warn so the script exits 0 even with drift, and --quiet so we
  // only see output when drift exists.
  if (!fs.existsSync(VALIDATOR_PATH)) return null
  try {
    const r = spawnSync('bash', [VALIDATOR_PATH, '--warn', '--quiet'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 4000,
    })
    const output = (r.stdout || '') + (r.stderr || '')
    const drift = output.includes('drift detected')
    return { drift, output: output.trim() }
  } catch (err) {
    logErr('runValidator', err)
    return null
  }
}

function formatHint(step, picks, validation) {
  const next = NEXT_BY_STEP[step] || '(unknown — see docs/workflow.md)'
  const reach = picks.length
    ? picks.map(r => `${r.command}  (${r.signal})`).join('  |  ')
    : '(none flagged for this step — proceed to default Next)'

  const lines = [
    '',
    '─── workflow hint ───',
    '→ Next: ' + next,
    '  Reach-for: ' + reach,
    '  Lookup: docs/workflow.md  •  table: .claude/reach-for.json',
  ]

  // Only inject planning-doc validation block at QA + SHIP steps. Earlier
  // steps haven't produced summaries yet, so drift checks are noise.
  if (validation && validation.drift && (step === STEP.QA || step === STEP.SHIP)) {
    lines.push('')
    lines.push('⚠️  Planning docs drift — must fix before /gsd-ship:')
    for (const ln of validation.output.split('\n')) {
      if (ln.trim()) lines.push('   ' + ln)
    }
  }

  lines.push('─────────────────────')
  return lines.join('\n')
}

function main() {
  const branch = getCurrentBranch()
  if (!branch) return process.exit(0)

  const phase = parsePhaseFromBranch(branch)
  if (!phase) return process.exit(0)  // Not on a phase branch — silent.

  const phaseDir = findPhaseDir(phase.number)
  const step = detectStep(phaseDir)
  const picks = pickReachFor(loadReachFor(), step)

  // Only run the (relatively expensive) validator at QA + SHIP steps.
  const validation = (step === STEP.QA || step === STEP.SHIP) ? runValidator() : null
  const hint = formatHint(step, picks, validation)

  // Plain stdout — Claude Code surfaces Stop-hook stdout to the user.
  // Non-zero exit is reserved for blocking; we always exit 0.
  process.stdout.write(hint + '\n')
  process.exit(0)
}

try { main() } catch (err) { logErr('main', err); process.exit(0) }
