#!/usr/bin/env node
/*
 * data-cross-check-nudge.js
 *
 * PostToolUse hook (Edit | Write | MultiEdit). Sibling to
 * visual-verify-nudge.js. When Claude edits a chart-card component, this
 * hook injects a system-reminder that forces a SQL cross-check of the
 * chart's rendered values against the canonical source view — addressing
 * the bug class documented in
 * `.claude/memory/feedback_sql_cross_check_per_chart.md` (chart components
 * doing their own .filter() and silently dropping filter dimensions).
 *
 * Detection rules + chart→sourceView mapping come from
 * `cross-check-targets.json` next to this file. The hook ONLY fires for
 * paths that match a `pathContains` rule AND have a matching extension —
 * generic .svelte files (EmptyState, FreshnessLabel, etc.) are ignored.
 *
 * Failure mode: any error → exit 0 (the hook never breaks Claude) PLUS a
 * one-line stderr log so the failure is visible in claude-code harness
 * output instead of vanishing.
 *
 * CommonJS is required: this file uses require() so it works in repos
 * whose root package.json declares "type": "module" only when the sibling
 * .claude/hooks/package.json scopes this directory back to CommonJS.
 *
 * Per-repo. Lives in ramen-bones-analytics only — does NOT propagate to
 * AiLine/shared-docs (the chart→source mapping is project-specific).
 */

'use strict'

const fs = require('fs')
const path = require('path')

const CONFIG_PATH = path.join(__dirname, 'cross-check-targets.json')
const DEFAULT_EXTENSIONS = ['.svelte']

function logErr(where, err) {
  try {
    const msg = err && (err.stack || err.message || String(err))
    process.stderr.write(`[data-cross-check-nudge] ${where}: ${msg}\n`)
  } catch { /* never throw from the logger itself */ }
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
    const cfg = JSON.parse(raw)
    return {
      extensions: Array.isArray(cfg.extensions) ? cfg.extensions : DEFAULT_EXTENSIONS,
      rules: Array.isArray(cfg.rules) ? cfg.rules : [],
      excludePaths: Array.isArray(cfg.excludePaths) ? cfg.excludePaths : [],
    }
  } catch (err) {
    logErr('loadConfig', err)
    return { extensions: DEFAULT_EXTENSIONS, rules: [], excludePaths: [] }
  }
}

function isChartEdit(filePath, cfg) {
  if (!filePath) return false
  const lower = filePath.toLowerCase()

  for (const ex of cfg.excludePaths) {
    if (lower.includes(ex.toLowerCase())) return false
  }

  const ext = path.extname(lower)
  if (cfg.extensions.length && !cfg.extensions.includes(ext)) return false

  // Must match a rule — narrow scope. Unlike visual-verify-nudge, we do NOT
  // fall through on extension alone. Chart cards are the only target.
  for (const rule of cfg.rules) {
    if (rule.pathContains && lower.includes(String(rule.pathContains).toLowerCase())) {
      return true
    }
  }
  return false
}

function resolveTarget(filePath, cfg) {
  const lower = filePath.toLowerCase()
  for (const rule of cfg.rules) {
    if (rule.pathContains && lower.includes(String(rule.pathContains).toLowerCase())) {
      return {
        chart: rule.chart || rule.pathContains,
        sourceView: rule.sourceView || '<unknown — check src/routes/+page.server.ts and src/routes/api/*>',
        bucketingHint: rule.bucketingHint || '',
        notes: rule.notes || '',
      }
    }
  }
  return {
    chart: 'unknown chart',
    sourceView: '<unknown>',
    bucketingHint: '',
    notes: '',
  }
}

function buildReminder(filePath, target) {
  const rel = path.relative(process.cwd(), filePath) || filePath
  const lines = [
    '🔢 DATA CROSS-CHECK REQUIRED',
    '',
    `You just modified a chart component: \`${rel}\``,
    `Chart: ${target.chart}`,
    `Canonical source view: \`${target.sourceView}\``,
  ]
  if (target.bucketingHint) lines.push(`Bucketing: ${target.bucketingHint}`)
  if (target.notes) lines.push(`Notes: ${target.notes}`)
  lines.push('')
  lines.push(
    'Aggregated dashboard numbers regularly drift from the underlying SQL.',
    'Before reporting this task complete, you MUST compare the rendered values',
    'against a direct SQL aggregation of the canonical source — not just',
    'eyeball them. The bug from 2026-04-20 (CalendarItemsCard silently showing',
    'all-days data when Sat-Sun was selected) was invisible until SQL diff.',
    '',
    '## Protocol',
    '',
    '1. Load tools: `ToolSearch select:mcp__supabase-dev__query,mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__javascript_tool,mcp__claude-in-chrome__find`',
    '2. Open the dashboard in Chrome at `http://localhost:5173`. Apply ONE non-default filter combo (e.g., specific date range + non-default sales_type, or specific weekday subset). Default filter state often masks the bug.',
    '3. Use `javascript_tool` to extract the rendered values from the chart DOM. Find the chart container (data-testid or LayerChart wrapper), enumerate every visible bucket (bar, cell, segment), capture {label, value} into a structured array.',
    `4. Run the equivalent SQL via \`mcp__supabase-dev__query\` against \`${target.sourceView}\` with the SAME filter semantics in WHERE and the SAME bucketing in GROUP BY. Match the locale's date trunc semantics (week starts Monday for de/ja/es/fr per project rule).`,
    '5. Compare row-by-row, value-by-value. Acceptable delta = 0 (or strict cents-rounding tolerance for currency). Any non-zero delta on any bucket = FAIL.',
    '6. ALSO grep this component for any `.filter(` derivation on `data` or `rows`. For each one, verify it references EVERY active filter dimension declared in `src/lib/dashboardStore.svelte.ts` (range/grain/sales_type/is_cash/days/visit_count). A missing dimension = silent stale chart even if step 5 passes for the default filter.',
    '7. State `Data cross-check: <findings>` with verdict PASS / FAIL / PARTIAL. PASS requires zero deltas on the non-default filter combo AND every active filter dim referenced in any local filter().',
    '',
    '## Recognise your own rationalisations',
    '',
    'You will feel the urge to skip this. The bug class this catches is INVISIBLE on inspection — the chart looks fine, just shows wrong numbers.',
    '- "The numbers look reasonable" — they ALWAYS look reasonable. SQL or it didn\'t happen.',
    '- "I only changed styling" — verify anyway. Cheap once Chrome + MCP are loaded; the per-chart SQL takes ~2s.',
    '- "The store handles all filtering" — exactly the assumption that produced the 2026-04-20 bug. Components do their own filter() and silently drift.',
    '- "Default filter state matches the SQL" — apply a NON-default combo. The bug only surfaces under filter pressure.',
    '- "The visual-verify nudge already covers this" — no, that one only checks pixels render. This one checks the numbers are correct.',
    '',
    '## If verification is genuinely blocked',
    '',
    'State PARTIAL with the specific reason (e.g. "Vite dev server down — run `bun run dev`", "supabase-dev MCP not loaded", "view requires service-role JWT and current session lacks it"). Do not silently skip.',
  )
  return lines.join('\n')
}

function readStdin() {
  return new Promise(resolve => {
    let data = ''
    if (process.stdin.isTTY) return resolve('')
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => { data += chunk })
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', () => resolve(''))
  })
}

async function main() {
  const raw = await readStdin()
  if (!raw.trim()) process.exit(0)

  let payload
  try { payload = JSON.parse(raw) } catch (err) { logErr('JSON.parse', err); process.exit(0) }

  const filePath = payload?.tool_input?.file_path || payload?.tool_input?.path || ''
  if (!filePath) process.exit(0)

  const cfg = loadConfig()
  if (!isChartEdit(filePath, cfg)) process.exit(0)

  const target = resolveTarget(filePath, cfg)
  const reminder = buildReminder(filePath, target)

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: reminder,
    },
  }))
  process.exit(0)
}

main().catch(err => { logErr('main', err); process.exit(0) })
