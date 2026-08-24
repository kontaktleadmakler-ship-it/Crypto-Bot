# v22.6 – Phase B10: Shadow Trading

B10 adds a shadow-trading layer that observes real market data and simulates
execution without submitting exchange orders.

## Added

- `shadow-trading-engine.js`
- `shadow-mode.js`
- `shadow-trade-journal.js`
- `shadow-config.js`
- `tests/b10.test.js`

## Safety

Shadow is OFF by default:

- `TRADING_MODE=PAPER`
- `SHADOW_TRADING_ENABLED=false`

Shadow execution uses the existing simulator and does not call exchange
order-placement APIs. A dedicated guard rejects live execution from SHADOW.

## Environment

`TRADING_MODE=PAPER|SHADOW`
`SHADOW_TRADING_ENABLED=false`
`SHADOW_HALT_ON_RISK_FAILURE=true`
`SHADOW_JOURNAL_FILE=./data/shadow/shadow-trades.jsonl`

## Scope

This phase deliberately does not replace the existing scan loop or switch the
whole bot to WebSocket automatically. It provides the isolated Shadow Engine,
mode guard, journal and tests so integration can be enabled conservatively.
