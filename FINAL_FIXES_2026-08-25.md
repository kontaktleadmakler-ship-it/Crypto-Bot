# Final hardening / ML / TimesFM fixes

## Implemented

- UptimeRobot `/health` is a public liveness endpoint and always returns HTTP 200 while the Node process is alive. API-key authentication remains active for all other endpoints.
- Added `/ready` for authenticated dependency readiness (MongoDB, ML, TimesFM when enabled, runtime state).
- Dynamic Time-Stop no longer exits when 15m market data is missing; it defers and retries. The absolute hold limit remains authoritative.
- Dynamic Time-Stop now has a cumulative extension budget. Default: 4h normal hold + max 2h dynamic extension, with a separate 24h absolute safety limit.
- TimesFM request/response correlation uses unique request IDs, preventing FIFO mis-association after timeouts.
- TimesFM 2.5 now forecasts log-price directly and exposes mean/P10/P50/P90 return estimates. The Dynamic Time-Stop uses median and downside quantiles instead of only a single point forecast.
- Added TimesFM readiness/latency/error/timeout metrics and a shadow journal for decisions and outcomes.
- TensorFlow training now uses the newest completed trades, not the oldest records.
- TensorFlow hyperparameter selection now considers balanced accuracy and calibration (Brier/ECE), rather than raw accuracy alone.
- Existing legacy trades without `signalPriceAtEntry` continue to use a controlled `entry` fallback so the historical dataset is not discarded.
- Absolute time limit now applies consistently to positions before and after TP1.
- `package.json` starts the compatible v25 entrypoint, which delegates to the fully patched v24.6 runtime.

## TimesFM activation

Set `TIMESFM_ENABLED=true` and install `requirements-timesfm.txt` before enabling it in production. The first startup downloads the model checkpoint if it is not already cached.

TimesFM is advisory only. It cannot override hard risk exits or the absolute time limit.
