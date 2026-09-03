# JARVIS 6.17 — Decision Intelligence & Audit

## Added
- Production decision trace: market → ML → DQN → agents → supervisor → risk → final action.
- Explicit HOLD/REJECT/veto diagnosis from production event payloads.
- Per-coin scanner health: live/stale/offline, age, latency, gate and errors.
- Multi-coin decision matrix with action, confidence, gate, risk, regime and DQN Q-values.
- Trading performance: win rate, profit factor, expectancy, average win/loss, net P&L and max drawdown.
- Regime and agent/direction performance tables.
- Event stream filtering by event type and free-text/symbol.
- RL feedback and ML/model/training event history.
- Historical decision replay view from the existing production event history.
- All dashboard additions are read-only and do not enable live orders.

## API
`GET /api/dashboard/decision-intelligence?symbol=BTC-USDT`

The endpoint combines production EventBus snapshots with paper closed-trade history. Missing data is shown as `—` rather than fabricated.
