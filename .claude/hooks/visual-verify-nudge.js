#!/usr/bin/env node
/*
 * visual-verify-nudge.js
 *
 * PostToolUse hook (Edit | Write | MultiEdit). When Claude edits a frontend
 * file, this hook injects a system-reminder that mirrors the
 * Anthropic-internal verification-agent prompt — instructing Claude to
 * verify the change in a real browser via the claude-in-chrome MCP before
 * declaring the task complete.
 *
 * Detection rules + dev URLs come from `verify-targets.json` next to this
 * file (per-repo customisable). If the config is missing, the hook falls
 * back to extension-only detection and tells Claude to figure out the URL
 * from CLAUDE.md / repo context.
 *
 * Failure mode: any error → exit 0 (the hook never breaks Claude) PLUS a
 * one-line stderr log so the failure is visible in claude-code harness
 * output instead of vanishing. This was added after a silent ESM-mode
 * require() crash hid a broken hook for an unknown duration in a
 * downstream repo.
 *
 * CommonJS is required: this file uses require() so it works in repos
 * whose root package.json declares "type": "module" only when a sibling
 * .claude/hooks/package.json scopes this directory back to CommonJS.
 * That sibling file is part of the sync set — do not delete it.
 *
 * Universal across repos. Single source of truth lives in
 * AiLine/shared-docs and is propagated via .github/sync-config.yml (AiLine)
 * or bootstrap.sh (vibe-coding-starter / standalone repos).
 */

'use strict'

const fs = require('fs')
const path = require('path')

function logErr(where, err) {
  // Stderr does not break Claude (PostToolUse hook only treats non-zero exit
  // codes as blocking). Surfaces in `claude --debug` and harness logs.
  try {
    const msg = err && (err.stack || err.message || String(err))
    process.stderr.write(`[visual-verify-nudge] ${where}: ${msg}\n`)
  } catch { /* never throw from the logger itself */ }
}

const CONFIG_PATH = path.join(__dirname, 'verify-targets.json')

const DEFAULT_EXTENSIONS = [
  '.tsx', '.jsx', '.vue', '.svelte', '.astro',
  '.html', '.css', '.scss', '.sass', '.less',
]

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
    const cfg = JSON.parse(raw)
    return {
      extensions: Array.isArray(cfg.extensions) ? cfg.extensions : DEFAULT_EXTENSIONS,
      rules: Array.isArray(cfg.rules) ? cfg.rules : [],
      defaultUrl: typeof cfg.defaultUrl === 'string' ? cfg.defaultUrl : null,
      excludePaths: Array.isArray(cfg.excludePaths) ? cfg.excludePaths : [],
    }
  } catch (err) {
    logErr('loadConfig', err)
    return { extensions: DEFAULT_EXTENSIONS, rules: [], defaultUrl: null, excludePaths: [] }
  }
}

function isFrontendEdit(filePath, cfg) {
  if (!filePath) return false
  const lower = filePath.toLowerCase()

  for (const ex of cfg.excludePaths) {
    if (lower.includes(ex.toLowerCase())) return false
  }

  const ext = path.extname(lower)
  if (cfg.extensions.includes(ext)) return true

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
        url: rule.url || cfg.defaultUrl || '<unknown — infer from CLAUDE.md or ask the user>',
        name: rule.name || rule.pathContains,
      }
    }
  }
  return {
    url: cfg.defaultUrl || '<unknown — infer from CLAUDE.md or ask the user>',
    name: 'frontend',
  }
}

function buildReminder(filePath, target) {
  const rel = path.relative(process.cwd(), filePath) || filePath
  return [
    '🔍 VISUAL VERIFICATION REQUIRED',
    '',
    `You just modified a frontend file: \`${rel}\` (target: ${target.name})`,
    '',
    'Before reporting this task complete, you MUST verify the change in a real browser.',
    'Type-checks, unit tests, and lint do NOT verify feature correctness.',
    '',
    '## Protocol',
    '',
    '1. Load chrome tools: `ToolSearch select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__read_console_messages,mcp__claude-in-chrome__find,mcp__claude-in-chrome__form_input,mcp__claude-in-chrome__read_page`',
    '2. Call `mcp__claude-in-chrome__tabs_context_mcp` to inspect existing tabs',
    `3. Navigate to: ${target.url}`,
    '4. Interact with the SPECIFIC feature you changed (click, type, scroll — not just load the page)',
    '5. Read `mcp__claude-in-chrome__read_console_messages` for runtime errors. NOTE: console tracking starts when this tool is FIRST called — to capture page-load errors you must call it once, then `location.reload()`, then call it again.',
    '6. State in your final message: `Visual verification: <what you saw>` with verdict PASS / FAIL / PARTIAL',
    '',
    '## Recognise your own rationalisations',
    '',
    'You will feel the urge to skip this. Recognise these excuses and do the opposite:',
    '- "The code looks correct based on my reading" — reading is not verification. Run it.',
    '- "The implementer\'s tests already pass" — happy-path mocks prove nothing about the rendered UI.',
    '- "I don\'t have a browser" — yes you do. Chrome MCP is available. Load and use it.',
    '- "This would take too long" — not your call.',
    '',
    '## If verification is genuinely blocked',
    '',
    'State PARTIAL with the specific reason (e.g. "DEV deploy not finished", "auth flow needs user login"). Do not silently skip.',
  ].join('\n')
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
  if (!isFrontendEdit(filePath, cfg)) process.exit(0)

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
