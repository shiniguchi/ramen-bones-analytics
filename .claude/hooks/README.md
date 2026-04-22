# Claude Code hooks

Scripts that run on Claude Code lifecycle events. Wired up in `.claude/settings.local.json`.

## visual-verify-nudge.js

**Event:** `PostToolUse` (matchers: `Edit`, `Write`, `MultiEdit`)

**Purpose:** When Claude edits a frontend file (`.svelte`, `.tsx`, etc.),
inject a system-reminder forcing Claude to verify the change in a real
browser via the `claude-in-chrome` MCP before declaring the task complete.

The reminder mirrors the Anthropic-internal verification-agent prompt
(`src/tools/AgentTool/built-in/verificationAgent.ts:30` in the Claude Code
source).

### Detection logic

A file qualifies if its extension is in `extensions` OR its path matches a
`pathContains` rule in `verify-targets.json`, AND it doesn't match any
`excludePaths` substring.

### URL resolution

First matching `rules` entry wins. Falls back to `defaultUrl`
(`http://localhost:5173` for this repo's Vite dev server).

### Per-repo customisation

Edit `verify-targets.json`. Source of truth for the script lives in
`AiLine/shared-docs/.claude/hooks/`.

### Test the hook locally

```bash
echo '{"tool_input":{"file_path":"src/routes/+page.svelte"}}' \
  | node .claude/hooks/visual-verify-nudge.js
```

### Failure mode

Any error → exit 0, no output. The hook never breaks Claude.
