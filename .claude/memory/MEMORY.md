# Project Memory

<!-- Index of memory files. Keep entries to one line each. Format: `- [Title](file.md) — one-line hook` -->

- [Dashboard redesign direction (post-v1.0)](project_dashboard_redesign.md) — chart-heavy redesign planned for v1.1 after Phase 5 ships
- [Route direction-change feedback to backlog](feedback_scope_preservation.md) — ship-first for 2-week MVP; capture new scope verbatim to `.planning/backlog/`
- [Forkability is not a v1 concern](feedback_forkability_not_v1.md) — do not treat fork dry-run walkthroughs as ship blockers; strike or defer
- [Per-card error isolation silently hid dashboard-breaking bug (2026-04-17)](project_silent_error_isolation.md) — `.catch(() => [])` pattern hides backend failures; verify real views with auth'd JWT, not E2E fixtures
- [LayerChart mobile horizontal scroll needs touchEvents override](feedback_layerchart_mobile_scroll.md) — always pass `tooltipContext={{ touchEvents: 'pan-x' }}` on scrollable charts or inner touch-action:pan-y blocks iOS swipe scroll
- [CF Pages stuck after Error 1102 — manual redeploy recovers](project_cf_pages_stuck_recovery.md) — deployed SSR routes return HTTP 404 "Not found" (9 bytes) while static assets still 200; fix = `gh workflow run deploy.yml --ref main`
