# Signal / Event-Loop / Market-Data Fix — 2026-09-02

## Production issues addressed

- TensorFlow inference in the scan path now has an async `predictAsync()` implementation using `Tensor.data()` instead of blocking `dataSync()`.
- Scanner yields to the Node.js event loop before ML inference so HTTP callbacks, timers, and semaphore waiters can progress.
- Futures API semaphore uses FIFO-with-priority scheduling, bounded queue timeouts, and safe direct slot transfer on release.
- Default scan concurrency remains conservative at 2; exchange HTTP concurrency is independent from scanner concurrency.
- Volatility surface now exposes the runtime-compatible `evaluateVolatilityMultiplier()` API, removing the `is not a function` runtime failure.
- Market-data bundles can use a recent 15m cached snapshot (up to 5 minutes) if a transient live Kline request fails. The returned bundle marks the source as `stale-cache`.
- These changes do not enable live execution; the runtime remains PaperOnly / Execution DISABLED.
