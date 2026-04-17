---
name: Per-card .catch(() => []) silently hid a dashboard-breaking bug
description: On 2026-04-17 a view-permission bug made the dashboard show 0 € for every date range since 2026-04-17 00:00 UTC — masked for hours by Phase 4 D-22 error isolation. New verification + telemetry guardrails needed.
type: project
---

On 2026-04-17 we shipped Phase 10 and discovered the dashboard had been silently showing 0 € / 0 tx for every date range since migration 0022 landed on main at 2026-04-17 00:00 UTC. Root cause was a Postgres permission error on `transactions_filterable_v` — each SSR query raised "permission denied for materialized view visit_attribution_mv", and the per-card `.catch(() => [])` isolation pattern in `src/routes/+page.server.ts` swallowed it into an empty array. UAT looked healthy because the E2E fixture bypass returns static data and never exercises the real view. Fixed via migration 0026 + PR #5.

**Why:** The per-card error-isolation pattern (Phase 4 D-22) is load-bearing — one slow chart should not 500 the whole page — but without observability it turns every backend failure into a silent empty-state. Error isolation without logging = invisible outages.

**How to apply:**
- Treat every new `.catch(() => [])` / empty-fallback as a telemetry hole. At minimum `console.error` with the query name so CF Pages Functions logs capture it; ideally ship to a structured sink.
- For each phase that adds a new SSR query, verify the real view on DEV with an authenticated JWT — do not rely on E2E fixtures alone. The canonical smoke test: `supabase db query --linked` with `SET LOCAL role = authenticated; SELECT set_config('request.jwt.claims', '{"restaurant_id":"..."}', true); SELECT count(*) FROM the_view;`
- When adding a view that joins a materialized view, default to no `security_invoker` (match `customer_ltv_v` / `item_counts_daily_v`). Only keep `security_invoker=true` if every joined table/MV grants SELECT to authenticated — else the view breaks silently under the caller's permissions.
- Consider adding a visible "N of M charts failed to load" banner so the next silent outage is impossible to miss.
