# Pinned framework versions

> Re-pin after every `/gsd-update`, `/gstack-upgrade`, or `claude plugin update superpowers`.
> See `docs/workflow.md` for the canonical update procedure.

| Framework | Version | Source | Pinned |
|---|---|---|---|
| **GSD** | (per-user; pinned in `~/.claude/get-shit-done/VERSION`) | global plugin | n/a — global per-user install |
| **GStack** | 0.18.3.0 | `~/development/AiLine/shared-docs/.claude/skills/gstack/` | SHA `36b99e50f19b90dc78fe6e1d67ca3df5537fae66` (see `.claude/GSTACK_SHA`) |
| **Superpowers** | latest | `superpowers@claude-plugins-official` | global plugin |

## Re-pin commands

```bash
# Update gstack
git -C ~/development/AiLine/shared-docs pull
(cd .claude/skills/gstack && git rev-parse HEAD) > .claude/GSTACK_SHA

# Update superpowers
claude plugin update superpowers
claude plugin list  # copy the new version into this file's table

# Update GSD
/gsd-update
```
