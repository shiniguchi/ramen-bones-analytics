---
description: Refine any plan - upgrade from 60% to 100% quality using conversation context
---

Your current plan is only 60% good. Revamp it to 100% professional quality using ONLY the context already in this conversation. Do NOT read codebases or query databases.

## Critique against 4 pillars

- **Minimal** — remove anything not strictly required. Less code, fewer steps, no gold-plating
- **Scalable** — will this approach hold up as the system grows? Avoid patterns that break at scale
- **Dynamic** — no hardcoding. Use config, env vars, or data-driven logic
- **Universal** — recycle existing functions and patterns. Don't reinvent what already exists

## Make It Specific

**60% Example:** "Add user authentication"
**100% Example:** "Add MFA to NextAuth.js, update `/auth/mfa` endpoint in the backend, add frontend MFA modal, test with 2 pilot users first"

## Output

Rewrite the plan at 100% quality. Be specific — replace vague steps with exact file paths, function names, and implementation details. Output the full revised plan, not just a diff.
