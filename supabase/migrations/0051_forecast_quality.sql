CREATE TABLE public.forecast_quality (
    restaurant_id     uuid NOT NULL REFERENCES public.restaurants(id),
    kpi_name          text NOT NULL,
    model_name        text NOT NULL,
    horizon_days      integer NOT NULL DEFAULT 1,
    evaluation_window text NOT NULL DEFAULT 'last_7_days',
    evaluated_at      timestamptz NOT NULL DEFAULT now(),
    n_days            integer NOT NULL,
    rmse              double precision NOT NULL,
    mape              double precision NOT NULL,
    mean_bias         double precision NOT NULL,
    direction_hit_rate double precision,
    horizon_reliability_cutoff integer,
    PRIMARY KEY (restaurant_id, kpi_name, model_name, horizon_days, evaluation_window, evaluated_at)
);
COMMENT ON TABLE public.forecast_quality IS 'Phase 14: per-model forecast accuracy. direction_hit_rate computed on open days only. horizon_reliability_cutoff marks the max reliable horizon given training data length.';
ALTER TABLE public.forecast_quality ENABLE ROW LEVEL SECURITY;
CREATE POLICY forecast_quality_select ON public.forecast_quality
    FOR SELECT USING (restaurant_id = (auth.jwt()->>'restaurant_id')::uuid);
REVOKE INSERT, UPDATE, DELETE ON public.forecast_quality FROM authenticated, anon;
