# v22.3 – Phase B1-B4: Paper Execution Stack

This package extends v22.2.3 with a **paper-only execution layer**. It does not add
live order execution and does not call KuCoin order endpoints.

## B1 – PaperExecutionAdapter

`paper-execution-adapter.js`

Common execution interface for paper trading:
- market entry
- partial reduction
- full close
- persisted paper orders
- paper positions
- restart restore

## B2 – Idempotency

`execution-idempotency.js`

Every execution intent has an idempotency key. Retries return the original paper
order instead of creating a second position. Persistent MongoDB state protects
against process restarts.

Signal metadata now carries:
- signalId
- strategyVersion
- featureVersion
- modelVersion
- configHash
- paperOrderId

## B3 – Reconciliation

`reconciliation-engine.js`

Compares:
- Mongo/bot `activeTrades`
- paper execution positions

On mismatch the bot fails closed and pauses new signals.

Legacy active trades from before Phase B are explicitly bootstrapped into paper
state once, with `FILLED_LEGACY_BOOTSTRAP` status.

Partial TP1 closes update the paper position quantity, so reconciliation remains
valid.

Telegram:
`/paperstatus`

## B4 – Execution Simulator

`execution-simulator.js`

Models:
- taker/maker fees
- spread
- configurable slippage
- orderbook-based market impact when orderbook data is supplied
- latency metadata
- configurable partial-fill ratio

Default `PAPER_FILL_RATIO=1` keeps existing behavior. Set a value below 1 only for
controlled testing of partial fills.

## Environment variables

Optional:

```text
PAPER_EXECUTION_ENABLED=true
PAPER_EXECUTION_LATENCY_MS=150
PAPER_SPREAD_PERCENT=0
PAPER_SLIPPAGE_PERCENT=0.05
PAPER_IMPACT_BPS=5
PAPER_MAKER_FEE_PERCENT=0.08
PAPER_TAKER_FEE_PERCENT=0.10
PAPER_FILL_RATIO=1
```

## Files

Replace:
- `trading-bot-v21.1-tfjs.js`
- `data-validator.js`
- `rl-engine.js`
- `exchange-adapter.js`

Add:
- `execution-simulator.js`
- `execution-idempotency.js`
- `paper-execution-adapter.js`
- `reconciliation-engine.js`

Optional but recommended:
- `tests/phase-b.test.js`

## Safety

The real `exchange-adapter.js` still exposes no usable live order endpoint.
`placeOrder`, `cancelOrder`, and live account-order methods remain explicitly
disabled.

## Validation

All JS files pass `node --check`.
The Phase B smoke/integration test passes:
`Phase B1-B4 tests: OK`.

## Important

This is a paper-execution foundation, not a live-trading authorization.
Before any future live adapter is considered, execution parity, reconciliation,
risk gates, failure/chaos tests, shadow trading and an explicit production gate
must pass.
