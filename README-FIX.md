# Market-Data Gateway Fix v25.0.9

Replace `trading-bot-v24.6-runtime.mjs` in the repository with the included file.

Changes:
- Central market-data bundle for scanner data.
- In-flight request coalescing per symbol.
- Circuit breaker checked before scan fan-out.
- 15m candles reused to derive 1h/4h when configured.
- Futures + orderbook fetched concurrently.
- Per-symbol market-data bundle bounded to 20s by default (`MARKET_DATA_BUNDLE_TIMEOUT_MS`).
- New diagnostics: marketDataTimeouts, marketDataFailures, circuitBreakerSkips.
- Dashboard uses the same market-data gateway instead of independently requesting klines/orderbook/futures.
- No order execution functionality changed.

Optional env:
`MARKET_DATA_BUNDLE_TIMEOUT_MS=20000`

Validation:
`node --check trading-bot-v24.6-runtime.mjs`
