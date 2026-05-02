-- 0063_pipeline_runs_fit_train_end.sql
-- Phase 16 D-05 / UPL-02: pipeline_runs.fit_train_end audit column.
-- Records the cutoff date used for each cf_<model> Track-B fit:
--   fit_train_end = min(campaign_calendar.start_date) - 7 days   (per C-04)
-- BAU rows leave NULL (back-compat — 0046's column set is preserved).
--
-- Why this column matters:
--   The counterfactual fit MUST stop training before the campaign era,
--   otherwise the post-campaign lift contaminates the "what would have
--   happened" forecast and uplift attribution collapses to ~0. The CI test
--   tests/forecast/test_counterfactual_fit.py::test_no_campaign_era_leak
--   asserts that for every forecast_daily row with forecast_track='cf', the
--   joined pipeline_runs row has fit_train_end < min(campaign_calendar.start_date)
--   for that restaurant. Without this audit column the leak is undetectable.
--
-- Pattern: ADD COLUMN IF NOT EXISTS keeps this idempotent so re-running
-- after partial pushes is safe. Mirrors 0046_pipeline_runs_extend.sql.

ALTER TABLE public.pipeline_runs
  ADD COLUMN IF NOT EXISTS fit_train_end date;

COMMENT ON COLUMN public.pipeline_runs.fit_train_end IS
  'Phase 16 D-05: TRAIN_END cutoff for cf_<model> Track-B fits (NULL for BAU).';
