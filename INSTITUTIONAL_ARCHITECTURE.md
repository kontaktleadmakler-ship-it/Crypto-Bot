# Institutional Architecture Contract

## Decision hierarchy

1. **Data validity** — forming, stale, malformed or future data is rejected.
2. **Strategy** — produces a signal intent, not an exchange order.
3. **ML/RL/AI** — advisory/model layers; none can bypass hard risk.
4. **Risk Engine** — authoritative portfolio limits, drawdown and loss controls.
5. **Execution Model** — shared fees/slippage/impact/latency assumptions.
6. **Execution Adapter** — paper/shadow by default; real execution requires the live gate.
7. **Portfolio Ledger** — idempotent accounting events are the source for realized PnL primitives.
8. **Reconciliation** — mismatches halt new trading.
9. **Audit Trail** — append-only operational/model lifecycle evidence.
10. **Readiness Gate** — production eligibility is explicit and fail-closed.

## Non-negotiable invariants

- No live order solely because `DRY_RUN=false`.
- No model promotion without an explicit registry promotion event.
- No ambiguous OHLC bar may assume a profitable target before a touched stop.
- No partial-fill fee may be calculated from requested quantity.
- No placeholder OOS, drift or exposure values may feed a hard decision layer.
- No unauthenticated operational API by default.
- No production claim is made from backtest performance alone.
