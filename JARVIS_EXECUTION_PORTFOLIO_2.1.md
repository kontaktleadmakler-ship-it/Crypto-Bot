# JARVIS Execution & Portfolio Intelligence 2.1

## Added
- `/api/dashboard/execution` read-only execution lifecycle telemetry.
- Trade lifecycle: scan → neural analysis → consensus → risk gate → execution gate → order → position → exit.
- Active position mark prices and unrealized PnL from the existing market-data boundary.
- Portfolio exposure, gross/net directional exposure, concentration and risk snapshot.
- Reconciliation / kill-switch / circuit-breaker visibility.
- Dashboard Execution Intelligence and Portfolio Intelligence panels.

## Safety
- No live-order endpoint was added.
- `liveOrders` remains controlled by the existing runtime readiness gates.
- Dashboard is telemetry-only and does not submit orders.
- Liquidation/whale metrics remain derived where the current adapter does not expose a native tape.
