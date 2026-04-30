CREATE TABLE public.weather_climatology (
    day_of_year    smallint NOT NULL CHECK (day_of_year BETWEEN 1 AND 366),
    temp_mean_c    double precision NOT NULL,
    precip_mm      double precision NOT NULL,
    wind_max_kmh   double precision NOT NULL,
    sample_years   integer NOT NULL,
    updated_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (day_of_year)
);
COMMENT ON TABLE public.weather_climatology IS 'Phase 14: 366-row per-DoY weather normals from 4-5 years of Berlin history. Used as Tier 3 fallback in exog cascade. sunshine_hours omitted — weather_daily has cloud_cover instead, conversion unreliable.';
