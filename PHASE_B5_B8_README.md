# v22.4 – Phase B5–B8

## B5 – Backtest/Paper Execution Parity
- `execution-parity.js` centralisiert Gebühren-/PnL-Logik.
- Backtest unterstützt denselben Spread/Slippage/Fee-Parameterpfad.
- Entry/Exit-PnL, Gebühren und Funding werden getrennt ausgewiesen.

## B6 – Central Risk Engine
- zentraler fail-closed Risk-Gate vor Paper-Execution
- Drawdown, Daily Loss, Portfolio Exposure und Kill-Switch
- ungültige Equity-Daten blockieren neue Trades

## B7 – Walk-Forward / OOS
- `walk-forward-validator.js` mit chronologischen Splits
- Purge und Embargo
- Backtest-Training endet vor dem Purge-Fenster
- ML-Fehler blockieren im Backtest statt still auf Baseline zurückzufallen

## B8 – ML/DQN Evaluation
- Log Loss, Brier Score und Calibration-Bins
- DQN Reward/Reward-Volatilität/Reward-Sharpe/Positive-Rate
- keine Änderung auf Online-Live-Learning; DQN bleibt Paper/Offline

## Zusätzlich
- `backtest-engine.js` ist jetzt im Paket enthalten, da der Hauptbot es benötigt.
- `/api/quant/status` zeigt B5–B8 Status.
- Live Order Execution bleibt deaktiviert.

## Deployment
Ersetzen/hinzufügen gemäß Dateiliste in der ZIP. Danach Render neu deployen und `/status`, `/api/quant/status` sowie den Backtest prüfen.
