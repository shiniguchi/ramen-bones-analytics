#!/usr/bin/env bash
# Usage: ./bootstrap.sh <target-dir>
# Copies .claude/, docs/, AGENTS.md, and .mcp.json.template into a target project.

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <target-dir>" >&2
  exit 1
fi

TARGET="$1"
SRC="$(cd "$(dirname "$0")" && pwd)"

if [[ ! -d "$TARGET" ]]; then
  echo "Creating target directory: $TARGET"
  mkdir -p "$TARGET"
fi

# Warn on overwrite
for item in .claude docs AGENTS.md .mcp.json.template; do
  if [[ -e "$TARGET/$item" ]]; then
    echo "⚠️  $TARGET/$item already exists — skipping (delete it first to overwrite)"
  else
    cp -R "$SRC/$item" "$TARGET/$item"
    echo "✅ copied $item"
  fi
done

cat <<EOF

Bootstrap complete → $TARGET

Next steps:
  1. cd $TARGET
  2. Edit .claude/CLAUDE.md — fill in TODO blocks
  3. Edit docs/project-context.md — describe the project
  4. cp .mcp.json.template .mcp.json — adjust for your stack
  5. Start coding with Claude Code
EOF
