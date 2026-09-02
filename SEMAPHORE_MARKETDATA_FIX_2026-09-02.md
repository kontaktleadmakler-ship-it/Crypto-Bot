# Market Data / Semaphore Fix — 2026-09-02

## Root cause

The production runtime used `MARKET_DATA_CONCURRENCY` as the capacity of the shared `futuresApiSemaphore`. With the default/Render value of `2`, the scanner, dashboard intelligence, agents, portfolio learning and order-book requests all competed for the same two exchange HTTP slots.

A single dashboard request can fan out into klines, ticker, futures-contract and order-book calls. The result was queue starvation and repeated `Semaphore acquire timeout`, followed by `LIVE_MARKET_DATA_UNAVAILABLE` in dashboard endpoints. This was resource starvation rather than a circular agent/risk deadlock.

## Changes

- `MARKET_DATA_CONCURRENCY` is now scan-level and defaults to `3`.
- Added independent `FUTURES_API_CONCURRENCY`, defaulting to at least `8` (configurable via Render).
- Added `FUTURES_API_QUEUE_TIMEOUT_MS`, default `8000`.
- Hardened semaphore waiter removal so timed-out requests cannot remain queued.
- Semaphore release is bounded and transfers ownership exactly once.
- Dashboard data requests for the same symbol are coalesced through `dashboardDataInflight`.
- Dashboard cache increased from `1200ms` to `3000ms` to prevent request bursts from the UI.
- Existing paper-only execution remains unchanged; live order execution is still disabled.

## Recommended Render variables

```text
SCAN_CONCURRENCY=3
MARKET_DATA_CONCURRENCY=3
FUTURES_API_CONCURRENCY=8
FUTURES_API_QUEUE_TIMEOUT_MS=8000
```

Do not set `FUTURES_API_CONCURRENCY` to `2` on the production scanner unless there is a specific API-rate-limit reason.
