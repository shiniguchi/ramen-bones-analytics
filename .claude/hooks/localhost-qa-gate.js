#!/usr/bin/env node
/*
 * localhost-qa-gate.js — Stop hook
 *
 * Blocks Claude from ending the turn when a frontend file was edited this
 * session but NO Chrome MCP navigate to localhost happened AFTER the last
 * such edit. Enforces the project rule codified in
 * .claude/hooks/verify-targets.json:
 *    localhost-first for per-edit feedback; DEV is only for final QA
 *    after push.
 *
 * Why this exists: the PostToolUse visual-verify-nudge.js prints a
 * reminder after each frontend edit, but nudges are advisory — the
 * runtime can still stop the turn without the reminder being acted on,
 * ESPECIALLY when edits are dispatched to a subagent whose nudge dies
 * with it. A Stop hook is the only mechanism that physically blocks
 * turn-end until the verification appears in the transcript.
 *
 * Bypass: if stop_hook_active is true on the inbound payload (the
 * runtime has already blocked once and fed `reason` back to Claude),
 * pass through to avoid infinite loops. Claude gets exactly ONE reminder
 * per turn, then the stop proceeds whether or not localhost was hit —
 * matching Claude Code's documented Stop-hook loop-protection semantics.
 *
 * Failure mode: any error → exit 0 (never break the harness) + stderr
 * log so failures surface in `claude --debug` instead of vanishing.
 *
 * CommonJS is required: uses require(). The sibling
 * .claude/hooks/package.json scopes this directory as CommonJS
 * regardless of the repo-root package.json type — do not delete it.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const FRONTEND_EXTS = [
  '.svelte', '.tsx', '.jsx', '.vue', '.astro',
  '.html', '.css', '.scss', '.sass', '.less',
];

const EXCLUDE_SUBSTRINGS = [
  'node_modules/',
  '.svelte-kit/',
  '.planning/',
  'dist/',
  'build/',
  'test-results/',
  '.test.',
  '.spec.',
  '/tests/',
  'storybook',
];

function logErr(where, err) {
  try {
    const msg = err && (err.stack || err.message || String(err));
    process.stderr.write(`[localhost-qa-gate] ${where}: ${msg}\n`);
  } catch { /* never throw from the logger itself */ }
}

function isFrontendEdit(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  const lower = filePath.toLowerCase();
  for (const ex of EXCLUDE_SUBSTRINGS) {
    if (lower.includes(ex.toLowerCase())) return false;
  }
  return FRONTEND_EXTS.includes(path.extname(lower));
}

function isLocalhostUrl(u) {
  if (!u || typeof u !== 'string') return false;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$|\?|#)/i.test(u);
}

function readStdin() {
  return new Promise(resolve => {
    let data = '';
    if (process.stdin.isTTY) return resolve('');
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => { data += c; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(''));
  });
}

/** Yield every tool_use block inside a transcript line's parsed message. */
function* iterToolUses(msg) {
  const content = msg?.message?.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block?.type === 'tool_use') yield block;
    }
  }
  // Fallback: some transcript variants put tool_use at the top level.
  if (msg?.type === 'tool_use' && msg?.name) yield msg;
}

async function main() {
  const raw = await readStdin();
  if (!raw.trim()) process.exit(0);

  let payload;
  try { payload = JSON.parse(raw); } catch (err) { logErr('JSON.parse', err); process.exit(0); }

  // Already-blocked-once loop protection.
  if (payload.stop_hook_active === true) process.exit(0);

  const transcriptPath = payload.transcript_path;
  if (!transcriptPath || !fs.existsSync(transcriptPath)) process.exit(0);

  let lines;
  try {
    lines = fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean);
  } catch (err) { logErr('readTranscript', err); process.exit(0); }

  let lastEditIdx = -1;
  let lastEditFile = null;
  let lastNavIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    let msg;
    try { msg = JSON.parse(lines[i]); } catch { continue; }
    for (const block of iterToolUses(msg)) {
      const name = block.name || '';
      const input = block.input || {};
      if (name === 'Edit' || name === 'Write' || name === 'MultiEdit') {
        const filePath = input.file_path || input.path;
        if (isFrontendEdit(filePath)) {
          lastEditIdx = i;
          lastEditFile = filePath;
        }
      } else if (name === 'mcp__claude-in-chrome__navigate') {
        if (isLocalhostUrl(input.url)) {
          lastNavIdx = i;
        }
      }
    }
  }

  // No frontend edits → nothing to gate on.
  if (lastEditIdx === -1) process.exit(0);
  // Localhost verification AFTER the last frontend edit → pass.
  if (lastNavIdx > lastEditIdx) process.exit(0);

  const relFile = lastEditFile ? path.relative(process.cwd(), lastEditFile) : '(unknown)';
  const reason = [
    '🛑 Localhost QA gate — frontend edit not visually verified.',
    '',
    `File: \`${relFile}\``,
    '',
    'Before ending this turn, you MUST:',
    '  1. Ensure the Vite dev server is running (`npm run dev` → http://localhost:5173).',
    '  2. Load Chrome MCP tools: `ToolSearch select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__read_console_messages,mcp__claude-in-chrome__javascript_tool`',
    '  3. Navigate a MCP tab to http://localhost:5173 and reload after tool-tracking starts.',
    '  4. Interact with the feature you changed — click, hover, scroll. Inspect DOM / console.',
    '  5. State `Visual verification: PASS / FAIL / PARTIAL` in your final message with specific evidence.',
    '',
    'This gate enforces the project rule codified in `.claude/hooks/verify-targets.json`:',
    '  localhost-first for per-edit feedback; DEV is only for final QA after push.',
    '',
    'If verification is genuinely blocked (auth flow, dev server down, etc.), state that explicitly as PARTIAL — do not silently skip.',
  ].join('\n');

  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  process.exit(0);
}

main().catch(err => { logErr('main', err); process.exit(0); });
