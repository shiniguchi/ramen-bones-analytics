CREATE TABLE public.forecast_daily (
    restaurant_id uuid NOT NULL REFERENCES public.restaurants(id),
    kpi_name      text NOT NULL CHECK (kpi_name IN ('revenue_eur', 'invoice_count')),
    target_date   date NOT NULL,
    model_name    text NOT NULL,
    run_date      date NOT NULL,
    forecast_track text NOT NULL DEFAULT 'bau',
    yhat          double precision NOT NULL,
    yhat_lower    double precision NOT NULL,
    yhat_upper    double precision NOT NULL,
    yhat_samples  jsonb,
    exog_signature jsonb,
    horizon_days  integer GENERATED ALWAYS AS (target_date - run_date) STORED,
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (restaurant_id, kpi_name, target_date, model_name, run_date, forecast_track)
);
COMMENT ON TABLE public.forecast_daily IS 'Phase 14: 365-day forward forecasts per model per KPI. yhat_samples holds 200 sample paths (jsonb array of floats) for CI aggregation.';
ALTER TABLE public.forecast_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY forecast_daily_select ON public.forecast_daily
    FOR SELECT USING (restaurant_id = (auth.jwt()->>'restaurant_id')::uuid);
REVOKE INSERT, UPDATE, DELETE ON public.forecast_daily FROM authenticated, anon;
