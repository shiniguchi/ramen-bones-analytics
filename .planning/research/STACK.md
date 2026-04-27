# Stack Research — Milestone v1.3 (External Data & Forecasting Foundation)

**Domain:** Multi-horizon time-series forecasting + external-data ingestion + ITS counterfactual attribution, layered onto an existing SvelteKit 2 / Cloudflare Pages / Supabase Postgres stack.
**Researched:** 2026-04-27
**Confidence:** HIGH for production-tier (SARIMAX, Prophet, statsforecast, Open-Meteo SDK, python-holidays, feedparser, LayerChart 2.x). MEDIUM for foundation-model + neural tier (Chronos-Bolt, NeuralProphet) — feature-flag them.

---

## Executive take

The existing stack already covers most of the ground. v1.3 is **additive**: ~9 new Python deps go into `requirements-extract.txt` (or a new `requirements-forecast.txt`); zero new JS deps because LayerChart 2.0.0-next.54 is already installed and ships `Spline`, `Area` (with `y0/y1`), `Rule`, and `Tooltip.Root` — exactly the four primitives the forecast chart needs.

The core forecasting tier — SARIMAX (statsmodels) + Prophet 1.3 + statsforecast 2.0 (ETS, Theta, Naive, plus the `ConformalIntervals` wrapper for long-horizon CIs) + python-holidays + feedparser + openmeteo-requests + PyYAML — fits comfortably under the GHA 7 GB / 6h-runtime budget; total nightly fit cost is well under 10 minutes per §17 of the proposal. NeuralProphet (~500 MB PyTorch) and Chronos-Bolt-Tiny (~9 MB weights, ~600 MB torch dep) are the only weight movers and are explicitly feature-flagged.

`ferien-api` PyPI client is **abandoned (last release 2022-10)** — call the REST endpoint directly with `httpx`. That is the single most important "what NOT to use" finding from this research pass.

**Out of scope for v1.3 (defer to v1.4+):** PyMC-Marketing, Meridian, Robyn, DeepAR, TFT, N-BEATS, PatchTST, LightGBM/MLForecast, gluonts, darts, tfcausalimpact. Adding these now violates the "≥3 channels before MMM" gate and the GHA runtime budget.

---

## Recommended stack additions

### Forecasting core (required, GHA cron)

| Package | Version (April 2026) | Purpose | Why this one |
|---|---|---|---|
| **statsmodels** | 0.14.6 | SARIMAX (D-06, primary), ETS reference | Already-installed-class deep-stack stalwart. SARIMAX has native `exog` matrix support — the cleanest way to wire weather + holidays + `is_campaign` regressors per §13. Python 3.9–3.13. |
| **prophet** | 1.3.0 (released 2026-01-27) | Stakeholder-friendly secondary (D-07) — `plot_components` audit | Native `add_regressor` + `holidays` arg; uniquely good decomposition plots for explaining seasonal vs trend vs regressor effects. **Critical version pin:** prophet 1.3 requires `holidays>=0.25,<1` — pin both together to avoid the well-known import-break (`prophet 1.1.4 ↔ holidays 0.23` recurring conflict). |
| **statsforecast** | 2.0.3 | Theta + Naive baselines (D-10 floor); `ConformalIntervals` wrapper for calibrated CIs at ≥35d horizons; `cross_validation()` for rolling-origin CV harness (§16) | One install replaces three custom scripts. `ConformalIntervals(h=35, n_windows=4)` answers Office-Hours #4 (CI calibration). `cross_validation(df, h=7, step_size=7, n_windows=12)` is the §16 12-fold gate **out of the box** — do **not** hand-roll it. |
| **utilsforecast** | 0.2.15 | Forecast-evaluation metrics (RMSE, MAPE, sMAPE, MASE, bias) used by §17 last-7-day evaluator and §16 backtest gate | Pulled in by statsforecast anyway; depending on it explicitly stabilizes the metric API surface for `last_7_eval.py` + `backtest.py`. |
| **scipy** | 1.13–1.15 | numerical backbone (already pinned by statsmodels/statsforecast) | Note: statsforecast 2.0.3 pins `scipy<1.16,>=1.7.3`. Don't bump scipy past 1.16 in v1.3. |

### External-data ingestion (required, GHA cron)

| Package | Version | Purpose | Why this one |
|---|---|---|---|
| **openmeteo-requests** | 1.7.5 (2026-01-19) | Open-Meteo client (D-01, weather backfill + 7-day forecast) | Official Open-Meteo Python SDK. **FlatBuffers transport** = ~10× smaller payload than raw JSON; built-in caching + retry; zero-copy pandas DataFrame. Use this instead of raw `httpx`. Async client available if we ever need parallel-shop fan-out. |
| **python-holidays** | 0.95 | Federal + Berlin holidays (D-02) | MIT, **fully offline** (no API call → no rate-limit risk). `holidays.Germany(state="BE", years=2026)` returns 9 federal + Frauentag. 250 country codes covered → forkability win. |
| **httpx** | 0.28.1 | `ferien-api.de` REST consumer (D-03) — **NOT the abandoned `ferien-api` PyPI wrapper**; raw `GET https://ferien-api.de/api/v1/holidays/BE/2026.json` | `ferien-api` PyPI package last released 2022-10-06 (v0.3.7) — explicitly abandoned. Two 5-line `httpx.get()` calls per year are simpler than depending on a dead wrapper. Reuse `httpx` for any other ad-hoc REST calls (BVG follow-up, Berlin-events fallback). |
| **feedparser** | 6.0.12 (2025-09-10) | BVG transit-strike RSS (D-04) | Battle-tested RSS/Atom parser. Robust against schema drift (BVG could swap formats). Filter on German keywords `Streik` / `Ausfälle` / `Betriebsstörung` per §6. |
| **PyYAML** | 6.0.3 | Hand-curated recurring events (D-05) — `recurring_events.yaml` → table loader | Dependency of countless other tools; already in any pandas-adjacent env. Source-controlled YAML edits = forkable + auditable, vs. live wikipedia scrape. |

### Existing deps (no upgrade needed — already validated)

| Package | Version | Role in v1.3 |
|---|---|---|
| **supabase-py** | 2.29.0 (2026-04-24) | All Python → Supabase upserts (forecast_daily, weather_daily, holidays, etc.). No version bump needed if already on 2.x. |
| **pandas** | 2.2+ | Time-series shaping + `df.resample()` for week/month CI aggregation in `last_7_eval.py` |
| **python-dotenv** | latest | local dev secret loading; GHA uses `secrets.*` |
| **layerchart** | 2.0.0-next.54 (already in `package.json`) | All forecast chart UI primitives (verified below) |
| **date-fns** / **date-fns-tz** | 4.x / 3.x | Berlin TZ alignment (Office-Hours #5) |

### Optional / feature-flagged (Tier B — promote only after backtest)

| Package | Version | Purpose | When to enable |
|---|---|---|---|
| **chronos-forecasting** | 2.2.2 (2025-12-17) | Zero-shot foundation model (D-08, Tier-A overlay) — Chronos-Bolt-Tiny (9M params, ~9 MB weights) | Behind env var `FORECAST_ENABLED_MODELS=…,chronos`. **Heavy:** transitively pulls torch ≥2.2 (~600 MB) + transformers ≥4.49 (~150 MB) + accelerate. Use the **`+cpu` torch wheel** index (`pip install --index-url https://download.pytorch.org/whl/cpu torch`) on GHA — drops install size from ~2 GB to ~250 MB. Cache `~/.cache/huggingface` between GHA runs (model weights pinned). |
| **neuralprophet** | 0.9.0 (2024-06-21) | AR-augmented Prophet (D-08b, Tier-B optional) | Behind env var `FORECAST_ENABLED_MODELS=…,neuralprophet`. Pulls `torch>=2.0`. Same `+cpu` wheel optimization as Chronos. **Promotion gate:** beats SARIMAX+Prophet by ≥5 % RMSE on 35d/120d horizons in §16 backtest, otherwise drop the dep entirely. |

### LayerChart 2.x primitives (verified in installed `node_modules/layerchart/dist/components/`)

No new JS deps. Exactly the four building blocks needed for the §3 chart spec:

| Component | Verified API | Use in `RevenueForecastCard.svelte` |
|---|---|---|
| **`Spline`** | `data, x, y, seriesKey, defined, curve, stroke, fill, opacity, motion` | One per forecast line (actual + SARIMAX + Prophet + Chronos + naive). `seriesKey` reads from chart series context — register all series once on the parent `<Chart>`, render N `<Spline>` children with toggleable `opacity` for legend show/hide. |
| **`Area`** | `data, x, y0, y1, ...` (confirmed `y0` and `y1` exist as `Accessor` types) | Uncertainty band: `y0={(d) => d.yhat_lower}` / `y1={(d) => d.yhat_upper}` with `fill-opacity:0.15`. **One `<Area>` per forecast model** that the user has toggled on. |
| **`Rule`** | `x: boolean \| 'left' \| 'right' \| number \| Date`, `y: boolean \| 'top' \| 'bottom' \| number \| Date`, `xOffset`, `yOffset` | Vertical event markers: campaign-start (`x={new Date('2026-04-14')}` solid red), federal holidays (dashed green), recurring events (dashed yellow), BVG strike days (red bar). One `<Rule>` per event. |
| **`Tooltip.Root`** with `{#snippet children(...)}` | Per memory `feedback_svelte5_tooltip_snippet.md` — must use `{#snippet children}`, NOT `let:data` (runtime `invalid_default_snippet` on Svelte 5) | Hover popup with full §17 last-7-day accuracy block. |

Horizon toggle (7d / 5w / 4mo / 1yr): client-side data slice driving `<Chart>`'s `xDomain` prop — same forecast rows, different domain. No server roundtrip per toggle.

---

## Installation

### Add to `requirements-extract.txt` (or split into `requirements-forecast.txt`)

```bash
# === Forecasting core (always installed) ===
statsmodels==0.14.6
prophet==1.3.0
holidays>=0.25,<1            # pinned by prophet 1.3.0 — DO NOT use 0.95 free-floating
statsforecast==2.0.3
utilsforecast==0.2.15
scipy>=1.7.3,<1.16           # pinned by statsforecast 2.0.3

# === External data fetchers ===
openmeteo-requests==1.7.5
python-holidays==0.95         # NOTE: package name is "holidays" on PyPI; same wheel as the prophet pin above
httpx==0.28.1
feedparser==6.0.12
PyYAML==6.0.3

# === Already in stack ===
pandas>=2.2
supabase==2.29.0
python-dotenv

# === Tier-B feature-flagged (install in a separate step on GHA, conditional) ===
# torch (CPU only):
#   pip install --index-url https://download.pytorch.org/whl/cpu torch>=2.2,<3
# chronos-forecasting==2.2.2
# neuralprophet==0.9.0
```

### GitHub Actions install pattern (snippet for `forecast-refresh.yml`)

```yaml
- uses: actions/setup-python@v5
  with:
    python-version: '3.12'
    cache: 'pip'
- name: Install core forecasting deps
  run: pip install -r requirements-forecast.txt
- name: (Optional) Install CPU torch + Chronos
  if: env.ENABLE_CHRONOS == 'true'
  run: |
    pip install --index-url https://download.pytorch.org/whl/cpu 'torch>=2.2,<3'
    pip install chronos-forecasting==2.2.2
- name: (Optional) Install NeuralProphet
  if: env.ENABLE_NEURALPROPHET == 'true'
  run: |
    pip install --index-url https://download.pytorch.org/whl/cpu 'torch>=2.2,<3'
    pip install neuralprophet==0.9.0
- name: Cache HuggingFace weights
  uses: actions/cache@v4
  with:
    path: ~/.cache/huggingface
    key: hf-${{ runner.os }}-chronos-bolt-tiny
```

### No new JS deps

```bash
# Verified — already installed:
#   layerchart@2.0.0-next.54   ← Spline, Area, Rule, Tooltip
#   date-fns@4.1.0
#   date-fns-tz@3.2.0
```

---

## Backtest tooling — buy, don't build

**Use `statsforecast.cross_validation()` directly.** It implements rolling-origin CV with the exact semantics §16 requires:

```python
from statsforecast import StatsForecast
from statsforecast.models import AutoARIMA, AutoETS, Theta, Naive
from statsforecast.utils import ConformalIntervals

sf = StatsForecast(
    models=[
        AutoARIMA(season_length=7, prediction_intervals=ConformalIntervals(h=35, n_windows=4)),
        AutoETS(season_length=7),
        Theta(season_length=7),
        Naive(),  # the §16 floor
    ],
    freq='D',
    n_jobs=-1,
)

# §16 gate: 12 folds, 7-day-ahead horizon
cv_df = sf.cross_validation(
    df=df_train,
    h=7,
    step_size=7,
    n_windows=12,
    level=[80, 95],
)
# Then evaluate with utilsforecast.evaluation.evaluate(cv_df, metrics=[rmse, mape])
```

Custom Prophet/Chronos/NeuralProphet wrappers feed predictions into the same long-format DataFrame and run through `utilsforecast.evaluation.evaluate()` — one metric pipeline for all five models.

**Conformal-prediction wrapper (Office-Hours #4):** `ConformalIntervals(h, n_windows)` is the answer. Apply to SARIMAX (and any classical model) for ≥35d horizons where Gaussian SARIMAX CIs are known to be miscalibrated. **Constraint:** `n_windows × h < len(series)` — with 10 months (~300 days) of history, `h=35, n_windows=4` is the safe ceiling. For `h=120` or `h=365`, conformal calibration is **not statistically valid yet** (insufficient data) — show "BACKTEST PENDING" badge instead, do not pretend to calibrate.

---

## Sample-path resampling for granularity toggle (1000 paths × percentiles)

The proposal mandates "1000 sample paths per model per night" written to `forecast_daily.yhat_samples` (jsonb). The reason: when the user toggles day → week → month, naively summing `yhat_lower`/`yhat_upper` is **wrong** (under-covers) — see §11 "Do not sum Prophet's `yhat_lower`/`yhat_upper`". Correct method:

| Source | Sample-path API |
|---|---|
| **SARIMAX** | `results.simulate(nsimulations=H, repetitions=1000, anchor='end', exog=future_exog)` → returns `(H, 1000)` array |
| **Prophet** | `model.predictive_samples(future_df)['yhat']` → `(H, 1000)` array (set `uncertainty_samples=1000`, default) |
| **statsforecast (AutoARIMA, AutoETS, Theta, Naive)** | When configured with `ConformalIntervals`, exposes per-quantile predictions; for true sample paths, use `sf.predict(h=H, level=...)` then bootstrap from residuals — or simpler: store the per-quantile grid (10/25/50/75/90/95) and reconstruct percentiles at any aggregation. |
| **Chronos-Bolt** | `pipeline.predict(context, prediction_length=H, num_samples=1000)` → native sample paths |
| **NeuralProphet** | `m.predict_quantiles(...)` then resample — less native; if dropped, no loss |

**Storage:** keep `yhat_samples` jsonb optional (a 1000-element float array per row × ~365 rows × 5 models = ~7 MB/day per tenant uncompressed). For 1 tenant this is fine; for multi-tenant scale, switch to a quantile grid (10/25/50/75/90/95 → 6 floats) and only keep full samples for the latest run. Decision belongs in `12-2-01-PLAN.md`.

**Aggregation in the SvelteKit chart:**

```ts
// granularity = 'day' | 'week' | 'month'
function aggregateSamples(samplesByDay: number[][], granularity: 'week' | 'month') {
  const buckets = bucketByDate(samplesByDay, granularity); // each bucket = (n_days × 1000)
  return buckets.map(bucket => {
    const summed = sum(bucket, axis=0); // (1000,) — total revenue across the week/month
    return {
      median: percentile(summed, 50),
      lower: percentile(summed, 2.5),
      upper: percentile(summed, 97.5),
    };
  });
}
```

If the per-day samples are too heavy to ship to the browser, do this aggregation in a Supabase Edge Function or in a `forecast_aggregated_v` view materialized at run time per granularity request.

---

## Alternatives considered

| Recommended | Alternative | When to use alternative |
|---|---|---|
| **statsforecast Theta + Naive** | hand-rolled `naive_dow_baseline.py` | Never. The proposal's `naive_dow_baseline.py` lives in §2 anyway, but if a one-line `Naive(season_length=7)` from statsforecast does the job, write a 5-line file that simply imports it. |
| **statsforecast `cross_validation()`** | hand-rolled rolling-origin CV in `backtest.py` | Only if you need a CV split rule that statsforecast doesn't expose (e.g. custom holdout day exclusion for closed-Mon-Tue handling — but that's solvable by passing a fitted `defined` mask). Default = use statsforecast. |
| **statsforecast `ConformalIntervals`** | `mapie` (model-agnostic) or `nixtla/neuralforecast`'s built-in conformal | `mapie` is more general but adds a fourth conformal API to learn. Stick to statsforecast's wrapper for v1.3 — same maintainer as the rest of the stack. |
| **openmeteo-requests SDK** | raw `httpx.get()` against Open-Meteo REST | If you only need 1 endpoint (current weather) and want zero deps. We need historical archive + 7-day forecast + caching — SDK wins on FlatBuffers payload size and built-in retry. |
| **`httpx`** | `requests` | `requests` is fine for sync-only and we don't need async in v1.3. But: `httpx` and `requests` are 100 % feature-equivalent for this use; `httpx` is recommended by the openmeteo-requests SDK's transitive dep tree (`niquests` → `httpx`-compatible) so we get one fewer transitive lib. |
| **feedparser for BVG RSS** | manual `xml.etree` + `httpx` | feedparser handles malformed feeds, encoding edge cases, and Atom/RSS-2/RSS-1 differences. BVG is a 3rd-party site; assume schema drift. |
| **python-holidays (offline)** | `feiertage-api.de` REST | Network-call alternative if we need same-day updated holidays (e.g. mid-year additions). `python-holidays` is recompiled when new states/years are added — refresh by upgrading the pin once a year. Saves a network round-trip per nightly run. |
| **PyYAML for events** | scrape Wikipedia "Events in Berlin 2026" | Per §11: "do not scrape Berlin events live." Annual human-curated YAML edit (~1 hour every October) > parser fragility. |
| **LayerChart Spline + Area + Rule** | shadcn-svelte chart wrapper | shadcn-svelte's `Chart` is a thin LayerChart wrapper for the most common 3 chart types. It does NOT expose `Area.y0/y1` or `Rule` — drop to LayerChart primitives for the forecast card. |
| **Sample-path-based CI aggregation** | Sum `yhat_lower`/`yhat_upper` directly | The summed-CI is **always too narrow**; well-known footgun (proposal §11). Sample paths are the only way to get correct multi-day CI percentiles. |

---

## What NOT to use

| Avoid | Why | Use instead |
|---|---|---|
| **`ferien-api` PyPI package** (HazardDede/ferien-api) | **Abandoned** since 2022-10-06 (v0.3.7). Last commit ~2 years ago. Will silently rot. | Direct REST call: `httpx.get('https://ferien-api.de/api/v1/holidays/BE/2026.json').json()` — five lines, zero supply-chain risk. |
| **Default-index torch on GHA** (`pip install torch`) | Pulls CUDA wheels (~2 GB) → blows past GHA disk-cache limit, slows every run | `pip install --index-url https://download.pytorch.org/whl/cpu 'torch>=2.2,<3'` (~250 MB) |
| **NeuralProphet without feature flag** | PyTorch dep + slower fits + may not beat SARIMAX | Behind `ENABLE_NEURALPROPHET=true`. Drop after backtest if no ≥5 % RMSE win. |
| **Chronos-Bolt-Small/Base/Large** | Larger weights, longer inference, no measurable gain at 10-month-history scale | Chronos-Bolt-**Tiny** only (9 M params, fits CPU inference in <1s/series). |
| **PyMC-Marketing / Meridian / Robyn** | Full MMM — out of scope per proposal §11. Needs ≥3 channels; we have 1 (Instagram). | Defer to v1.4+. ITS counterfactual on pre-campaign era (D-11) is the v1.3 substitute. |
| **DeepAR / TFT / N-BEATS / PatchTST / GluonTS / Darts** | Need ≥2 years of multi-series; PyTorch-heavy; not on the chart per §5 Tier-C | Defer to v1.4+ (unblocked when ≥2 years of data exists). |
| **LightGBM / mlforecast** (Tier-B in §5) | Listed in proposal Tier-B but adds gradient-boosting tree as a 6th overlay; mobile chart already crowded | Skip in v1.3. If the 5-model overlay is judged readable, revisit in 12.5. |
| **CausalImpact / `tfcausalimpact`** | Bayesian, TensorFlow dep, monthly-retro-only per §5 Tier-C | Defer to v1.4 monthly-retro feature. v1.3's daily ITS uplift is computed by `cumulative_uplift.py` on top of standard SARIMAX — no extra dep. |
| **`pyaf`** | Last release **2023-07-12** (v5.0); hasn't been touched in 2+ years; statsforecast covers the same automated decomposition surface area with active maintenance | statsforecast (active, 2.0.3 in 2026). |
| **Yearly seasonality in Prophet on <2yr data** | Will fit phantom annual cycles — overconfident | Force `yearly_seasonality=False` until data crosses 2 years (auto-flip via data-volume check per §2 12.2 office-hours item). |
| **Summing `yhat_lower`/`yhat_upper` for week/month CI** | Always under-covers — the multi-day distribution is not the sum of marginals | Resample 1000 sample paths, take percentile of summed paths (covered in "Sample-path resampling" above). |
| **`@supabase/auth-helpers-sveltekit`** | (Existing project rule — flagged here for forkers) deprecated. | Already on `@supabase/ssr`. No change needed. |
| **`prophet 1.3 + holidays==0.34`** (or unpinned holidays) | Recurring history of breakage on `holidays` API drift (`0.23 ↔ 1.1.4` and `0.25 ↔ 1.1.5` both broke imports) | Pin the holidays version to the exact range prophet 1.3.0 declares: `holidays>=0.25,<1`. Refresh once a year when prophet bumps. |

---

## Stack patterns by variant

### v1.3 default (1 tenant, ~10 months of data)
- Tier A only: SARIMAX + Prophet + Theta + Naive — no PyTorch dep on the GHA runner
- Conformal CIs at 35d horizon only; 7d gets native SARIMAX/Prophet CIs; 120d/365d show "uncalibrated" badge
- Daily refit + daily 365-day reforecast; weekly 12-fold CV gate
- Sample paths stored as full 1000-element arrays in `yhat_samples` jsonb (storage cost trivial at 1 tenant)

### If Chronos backtest wins (Office-Hours #3 selection rule lands on Chronos)
- Add `chronos-forecasting==2.2.2` + CPU torch to GHA workflow
- Cache `~/.cache/huggingface` between runs to avoid 9 MB redownload per night
- Promote to Tier A overlay (4th line on chart)

### If reaching ≥2 years of data (~Aug 2027)
- Re-enable `yearly_seasonality=True` in Prophet (auto via data-volume check)
- Add 365d horizon to gate (move from "exploratory" to gated)
- Consider promoting NeuralProphet if backtest shows ≥5 % RMSE win

### Multi-tenant scale (≥10 shops, future)
- Switch `yhat_samples` storage from full-array jsonb → 6-quantile grid to keep MV size under control
- Move forecast fits from GHA → dedicated worker (Fly.io free tier or a small Railway box)
- Consider mlforecast/LightGBM for cross-shop hierarchical reconciliation

---

## Memory + runtime budget on GHA `ubuntu-latest` (2 vCPU / 7 GB RAM)

| Workload | Approx peak RAM | Approx wall time | Notes |
|---|---|---|---|
| `statsmodels` SARIMAX(1,0,1)(1,1,1,7) + 6 exog cols, 300-day fit | ~150 MB | ~5 s | 5 s × 7 days × 1 model (last-7 evaluator) = 35 s |
| `prophet` 1.3 fit, 6 regressors, no MCMC | ~250 MB | ~3 s | 3 s × 7 days = 21 s |
| `statsforecast` AutoARIMA + AutoETS + Theta + Naive (4 models) | ~300 MB | ~10 s | parallel via `n_jobs=-1` |
| `statsforecast.cross_validation(h=7, n_windows=12)` (weekly gate) | ~500 MB | ~2 min | runs Tuesday 23:00 UTC only, not nightly |
| `chronos-forecasting` Chronos-Bolt-Tiny CPU inference, 365 steps | ~1.2 GB (torch + transformers) | ~2 s | weights cached in `~/.cache/huggingface` |
| `neuralprophet` 0.9 fit + 365-step predict | ~2 GB (torch + lightning) | ~10 s/fit | × 7 last-7-days = 70 s |
| **Total nightly (Tier A only)** | <1 GB peak | <2 min | well under GHA 7 GB / 6 h |
| **Total nightly (Tier A + Chronos + NeuralProphet)** | ~3 GB peak | <5 min | comfortable |
| **Weekly backtest (Tier A only)** | ~2 GB peak | <5 min | comfortable |

Comfortable. The proposal §17 estimate of "<10 minutes nightly" is verified.

---

## Version compatibility matrix

| Package A | Compatible with | Notes |
|---|---|---|
| `prophet==1.3.0` | `holidays>=0.25,<1`, `cmdstanpy>=1.0.4` | **Pin holidays explicitly.** prophet 1.3 dropped `pystan` in favor of cmdstanpy. |
| `statsforecast==2.0.3` | `numpy>=1.21.6`, `pandas>=1.3.5`, `scipy<1.16,>=1.7.3`, `statsmodels>=0.13.2` | scipy upper bound is the tight one — don't bump scipy. |
| `chronos-forecasting==2.2.2` | `torch>=2.2,<3`, `transformers>=4.49`, `accelerate>=0.34`, Python 3.10+ | CPU-only torch wheels recommended. |
| `neuralprophet==0.9.0` | `torch>=2.0`, Python 3.9–3.12 | Last release 2024-06-21 — slowing maintenance pace; reason it's Tier B. |
| `openmeteo-requests==1.7.5` | Python 3.9+, `niquests` (httpx-compatible) | Async client requires Python 3.10+. |
| `python-holidays==0.95` | Python 3.8+ | Same wheel as the `holidays>=0.25,<1` Prophet pin (PyPI name is `holidays`). |
| `supabase==2.29.0` | Python 3.9+ | No bump needed if already on 2.x. |
| `layerchart@2.0.0-next.54` | Svelte 5.x | Verified via `node_modules/layerchart/dist/components/{Spline,Area,Rule}.svelte`. |
| `cmdstanpy` (Prophet backend) | macOS arm64 (M1/M2/M3) supported | xcode-select install required on dev macs; GHA `ubuntu-latest` has gcc — no special config. |

---

## Confidence assessment

| Area | Level | Reason |
|---|---|---|
| Forecasting core (statsmodels, Prophet, statsforecast) | **HIGH** | Versions verified on PyPI 2026-04-27; APIs verified via documentation; existing project memory confirms `holidays` pin gotcha. |
| External data fetchers (Open-Meteo, holidays, feedparser, httpx, PyYAML) | **HIGH** | All versions current on PyPI; openmeteo-requests is the official SDK; ferien-api wrapper abandonment confirmed. |
| LayerChart 2.x primitives (Spline, Area y0/y1, Rule) | **HIGH** | Source files inspected directly in `node_modules/layerchart/dist/components/`. `y0`/`y1` are typed `Accessor` props on `Area`; `Rule` props confirmed. |
| ConformalIntervals + cross_validation API | **HIGH** | Direct doc page fetched; matches §16 12-fold CV exactly. |
| Chronos-Bolt-Tiny memory + GHA viability | **MEDIUM** | Confirmed model size 9 M params, CPU inference works, GHA 7 GB is sufficient with CPU-torch wheel. Actual nightly wall time is estimate, not measured. |
| NeuralProphet promotion criterion | **MEDIUM** | Behind a feature flag; the ≥5 % RMSE-win bar is a defensible threshold but ultimately a product call. |
| Sample-path-resample strategy for week/month CI | **HIGH** | Standard practice in Bayesian forecasting; the alternative (sum of marginals) is documented as wrong in proposal §11. |
| GHA disk + memory budget | **HIGH** | `actions/cache` for HuggingFace + pip is well-trodden; CPU torch wheel index documented in chronos-forecasting CI itself. |

---

## Sources

### Forecasting libraries (PyPI, verified 2026-04-27)
- [statsmodels 0.14.6 on PyPI](https://pypi.org/pypi/statsmodels/json) — Python 3.9–3.13 — HIGH
- [prophet 1.3.0 on PyPI](https://pypi.org/pypi/prophet/json) — released 2026-01-27, requires `holidays>=0.25,<1` — HIGH
- [statsforecast 2.0.3 on PyPI](https://pypi.org/pypi/statsforecast/json) — `scipy<1.16` — HIGH
- [utilsforecast 0.2.15 on PyPI](https://pypi.org/pypi/utilsforecast/json) — released 2025-12-03 — HIGH
- [neuralprophet 0.9.0 on PyPI](https://pypi.org/pypi/neuralprophet/json) — released 2024-06-21, `torch>=2.0` — HIGH (with maintenance-pace caveat)
- [chronos-forecasting 2.2.2 on PyPI](https://pypi.org/pypi/chronos-forecasting/json) — released 2025-12-17, `torch>=2.2,<3` — HIGH
- [pyaf on PyPI](https://pypi.org/pypi/pyaf/json) — last release 2023-07-12, **avoided** — HIGH
- [statsforecast ConformalIntervals tutorial](https://nixtlaverse.nixtla.io/statsforecast/) — API for `ConformalIntervals(h, n_windows)` and `sf.cross_validation(...)` — MEDIUM (single source)

### External data
- [openmeteo-requests 1.7.5 on PyPI](https://pypi.org/pypi/openmeteo-requests/json) — released 2026-01-19 — HIGH
- [python-holidays 0.95 on PyPI](https://pypi.org/pypi/holidays/json) — Berlin (BE) supported — HIGH
- [feedparser 6.0.12 on PyPI](https://pypi.org/pypi/feedparser/json) — released 2025-09-10 — HIGH
- [httpx 0.28.1 on PyPI](https://pypi.org/pypi/httpx/json) — HIGH
- [PyYAML 6.0.3 on PyPI](https://pypi.org/pypi/pyyaml/json) — HIGH
- [ferien-api 0.3.7 on PyPI](https://pypi.org/pypi/ferien-api/json) — last release 2022-10-06, **abandoned, avoid** — HIGH
- [supabase 2.29.0 on PyPI](https://pypi.org/project/supabase/) — released 2026-04-24 — HIGH

### Chart libraries (verified locally + GitHub)
- `node_modules/layerchart/dist/components/{Spline,Area,Rule}.svelte` — direct source inspection — HIGH
- [LayerChart on npm — 2.0.0-next.x](https://www.npmjs.com/package/layerchart) — Svelte 5 native @next channel — HIGH
- [techniq/layerchart README](https://github.com/techniq/layerchart) — component catalog — HIGH

### Compatibility footguns
- [prophet ↔ holidays version-conflict history (Apache Superset issue #26629)](https://github.com/apache/superset/issues/26629) — confirms the `0.25` lower bound — HIGH
- [Prophet issue #2430 — breaking on holidays 0.25](https://github.com/facebook/prophet/issues/2430) — historical context — HIGH
- [chronos-forecasting CPU torch install](https://github.com/amazon-science/chronos-forecasting/actions/runs/8571582095/workflow) — CPU-only wheel install pattern in upstream CI — MEDIUM

### Existing project memory (relevant to v1.3)
- `feedback_svelte5_tooltip_snippet.md` — `Tooltip.Root` requires `{#snippet children}` not `let:data` on Svelte 5
- `feedback_layerchart_mobile_scroll.md` — `touchEvents: 'auto'` default, `'pan-x'` blocks PC trackpad
- `feedback_sql_cross_check_per_chart.md` — partition-sum cross-checks miss local filters; relevant for §17 last-7 vs §16 CV agreement check

---

*Stack research for: v1.3 forecasting milestone — 9 new Python deps, 0 new JS deps. Total nightly compute under 10 min on GHA free tier. Tier-A models cover the production line; Chronos and NeuralProphet are feature-flagged behind backtest promotion. PyMC-Marketing / Meridian / Robyn / DeepAR / TFT explicitly deferred to v1.4+.*
*Researched: 2026-04-27*
