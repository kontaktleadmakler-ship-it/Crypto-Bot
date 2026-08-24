# Crypto Trading Bot v22.2.1 — Pro Implementation

## Ziel
Diese Version erweitert die bestehende Paper-Trading-Codebasis um eine gemeinsame Advanced-Feature-Schicht, echte Trade-Level-CVD-Anbindung als optionale Datenquelle, ML/RL-Hardening, Reporting-/Attribution-Bausteine und eine fail-closed Execution-Abstraktion.

## Neue Module
- `feature-engine.js` — CVD, Volume-Weighted MACD, Ichimoku, Fibonacci, MTF-Confluence.
- `orderflow-stream.js` — KuCoin Futures Public WebSocket für Trade-Level-Ausführungen.
- `execution-interface.js` — Exchange-agnostische Execution-Schnittstelle + KuCoin Futures Adapter.
- `risk-controls.js` — globaler Kill-Switch.
- `attribution.js` — Filter-/Signal-Performance-Attribution.
- `ml-ensemble.js` — gewichtetes Ensemble.
- `explainability.js` — perturbationsbasierte Feature-Importance-Approximation.
- `prioritized-replay.js` — Prioritized Experience Replay.
- `drift-monitor.js` — Concept-Drift Monitoring.
- `execution-algos.js` — TWAP/VWAP Schedule und Slippage-Berechnung.
- `report-engine.js` — KPI-/JSON-Reporting.

## Live-/Backtest-Parität
`backtest-engine.js` nutzt jetzt dieselbe Advanced-Feature-Berechnung wie die Live-Schicht für die vorhandenen Timeframes. Für 1m/5m bleiben Daten bewusst `NEUTRAL`, solange keine Low-TF-Historie geladen wird; dadurch wird keine synthetische Information erzeugt.

## CVD
Ohne Trade-Stream wird weiterhin eine ausdrücklich als Approximation gekennzeichnete OHLCV-Druckmessung verwendet. Mit `ENABLE_ADVANCED_MTF=true` und verfügbarer Node-WebSocket-API kann die KuCoin Futures Execution-Topic-Verbindung für Trade-Level-Daten aktiviert werden. Die CVD-Daten sind nicht rückwirkend rekonstruierbar und werden daher im Backtest nicht erfunden.

## Execution-Sicherheit
Standardwerte:
- `EXECUTION_ENABLED=false`
- `DRY_RUN=true`
- `KILL_SWITCH_ENABLED=true`

Echte Orders erfordern daher explizite Konfigurationsänderungen und werden zusätzlich durch den Kill-Switch geschützt. Das Projekt bleibt standardmäßig Paper-/Dry-Run-sicher.

## Scoring
Die bestehende Signalbewertung bleibt erhalten und wird mit einem 30%-Advanced-Block ergänzt:
- MTF Confluence
- Ichimoku Alignment
- Volume-Weighted MACD Alignment
- CVD Alignment

Backtest und Live verwenden dieselben Berechnungsfunktionen.

## KuCoin-Verifikation
Aktuelle Dokumentation (Stand 20.08.2026) wurde zur Implementierung geprüft. Die verwendeten Futures-Endpunkte umfassen insbesondere `/api/v1/bullet-public`, `/api/v1/orders`, `/api/v1/orders/test`, `/api/v1/orders/{orderId}` und `/api/v3/orders` sowie den Public Trade-WebSocket `/contractMarket/execution:{symbol}`.

## Tests
`npm test` enthält die bestehenden Hardening-Tests und zusätzliche Pro-Feature-Tests. `npm run check` prüft die Syntax aller neuen und zentralen Module.

## Validation + Execution Engine
Validation gates model promotion using Profit Factor, Sharpe, Drawdown, OOS pass rate and robustness thresholds. Execution is fail-closed: DRY_RUN=true, EXECUTION_ENABLED=false and kill switch active by default. Orders require idempotent clientOrderId. Exchange adapters remain isolated behind the existing execution interface.
