# v25.0.17 Production Hardening Patch

- Production scanner ML inference now uses `predictSignalSuccessAsync()`.
- Futures API concurrency is configurable and has bounded queue waits.
- KuCoin circuit-breaker accounting is limited to transient/network/server failures; per-symbol 4xx errors do not trip the global breaker.
- Market-data queue timeout is configurable.
- Test runner recursively executes `tests/**/*.test.js`.
- Obsolete duplicate root tests were removed.
- Runtime test mode (`BOT_TEST_MODE=true`) allows a side-effect-free import smoke test without starting the server, timers, DB startup or scan loop.
- No full runtime replacement from v24.6 was performed.
