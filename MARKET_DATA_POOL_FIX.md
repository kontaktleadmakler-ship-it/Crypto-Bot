# Market-Data Worker Pool Fix

- Scanner concurrency defaults to 3.
- Market-data concurrency is independently capped at 3.
- Market-data queue wait defaults to 5s.
- Market-data bundle timeout defaults to 15s.
- Scan item timeout defaults to 30s.
- Queue timeouts are reported separately as `marketDataQueueTimeouts`.
- Exchange execution remains disabled; this change only affects market-data scheduling.

Recommended Render variables:
`SCAN_CONCURRENCY=3`
`MARKET_DATA_CONCURRENCY=3` (scan-level)
`FUTURES_API_CONCURRENCY=8` (exchange HTTP pool)
`MARKET_DATA_QUEUE_TIMEOUT_MS=5000`
`MARKET_DATA_BUNDLE_TIMEOUT_MS=15000`
`SCAN_ITEM_TIMEOUT_MS=30000`
