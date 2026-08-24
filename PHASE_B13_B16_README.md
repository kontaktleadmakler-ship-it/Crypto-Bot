# Trading Bot v24 — Institutional Edition

## v24.1 B13 — Execution Replay Suite

Implemented in this release:
- append-only event journal with sequence + SHA-256 hash chain
- snapshot versioning and checksum verification
- deterministic replay for candles, positions, orders, fills, TP/SL and closes
- duplicate-fill and missing-event detection
- replay hash parity
- 32 crash/restart scenarios
- paper/shadow only; no live order execution

Run `npm test` or `node tests/b13.test.js`.

### Roadmap status
- **v24.1 B13:** implemented
- v24.2 B14: not yet implemented in this release
- v24.3 B14 Monte Carlo/WFO/OOS: not yet implemented
- v24.4 B15 ML evaluation: not yet implemented
- v24.5 B16 observability: not yet implemented
- v24.6 institutional paper/shadow + testnet/reporting: not yet implemented

The archive intentionally does not claim placeholder files as completed features.
