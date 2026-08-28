# v25.0.13 – Market Data Root Cause Fix

## Root cause
The scanner's HTTP helper retried ordinary market-data failures/timeouts 3 times. A 5s Kline timeout therefore occupied a worker for roughly 20s. The scanner then wrapped the whole symbol task in a 30s asyncPool timeout. With multiple symbols, the bounded market-data pool and futures semaphore became congested, producing repeated `ASYNC-POOL item timed out` and `market-data queue timeout` messages.

A second contributor was background Kline preloading, which could continue independently of the scanner and consume the same exchange/rate-limit budget.

## Fix
- All exchange market-data requests are explicitly marked `marketDataNoRetry: true`.
- A timed-out market-data HTTP request now fails once instead of retrying for another ~15s.
- Background Kline preloading is opt-in (`ENABLE_PRELOADING=true`) instead of enabled by default.
- Market-data bundle timeout is capped at 10s by default.
- The existing fail-closed behavior and paper-only execution remain unchanged.
- `package.json` remains CommonJS-compatible; `type: module` was NOT added because the project still contains CommonJS modules.
