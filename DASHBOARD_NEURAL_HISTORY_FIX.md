# JARVIS Dashboard – Neural/Decision History Fix

## What changed
- `dashboardScanHistory` is now persisted in MongoDB for every production `SCAN:COIN`.
- `/api/dashboard/scan-history` reads durable MongoDB history first and only falls back to local replay files before MongoDB is ready.
- Dashboard now displays:
  - final decision
  - confidence
  - ML probability
  - DQN action / epsilon / model
  - DQN Q-values
  - agent count
  - risk state
  - decision reason
  - RSI / ADX / ATR / order-flow features
  - persisted scan history
- The live SSE stream immediately updates the history view.
- No live order execution is added or enabled.

## Important
The scanner still records a full `SCAN:COIN` snapshot only after validated market data and indicator calculation. Symbols that fail before that point remain `MARKET DATA UNAVAILABLE`; they are not fabricated as AI decisions.
