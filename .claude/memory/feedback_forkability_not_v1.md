---
name: Forkability is not a v1 concern
description: User has explicitly stated the forking/dry-run walkthrough topic is irrelevant for v1 — do not treat it as a ship blocker or propose fork walkthroughs
type: feedback
---

Forkability / fork dry-run walkthroughs / "prove the README is accurate for a real forker" is NOT a v1 ship blocker and should not be presented as one. Plans, READMEs, and ship gates should be updated to strike or defer any fork-walkthrough tasks.

**Why:** The v1 audience is a single restaurant (the founder's friend). Forkability was a *nice-to-have architectural posture* from PROJECT.md — build multi-tenant-ready from day 1 so a later fork is possible — not a feature that needs proving before shipping v1. Making a fresh forker walkthrough a ship-blocker spends real time (30-60min) on a hypothetical future user while the real v1 user is waiting.

**How to apply:**
- When a plan or checkpoint asks for a "clean-clone fork dry-run" on a throwaway Supabase/CF project, treat it as deferred/optional, not blocking
- Do not offer fork walkthroughs as an execution path — go straight to the user-facing ship gate (friend sign-off)
- If docs (README, CONTEXT, PLAN) frame forkability as a v1 verification item, update them to mark it as post-ship / "revisit if anyone actually forks"
- The `scripts/fork-dryrun.sh` smoke check (files/env vars exist) is fine to keep as CI-level; a full end-to-end deploy walkthrough is not
