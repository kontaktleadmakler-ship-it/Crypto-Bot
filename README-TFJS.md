# Trading Signal Bot v21.0 – TensorFlow.js

Diese Version ersetzt die bisherige Brain.js-Schicht durch eine eigenständige TensorFlow.js ML-Engine. Die übrige Bot-Architektur – KuCoin-Daten, MongoDB, Telegram, Risk Management, ATR/TP, Hurst, Multi-Timeframe, Orderbook, Correlation Limits und Tracker – bleibt erhalten.

## ML-Modell

- Framework: `@tensorflow/tfjs-node`
- Aufgabe: Wahrscheinlichkeit, dass ein Setup unter der bestehenden Strategie positiv endet
- Label: `pnlUSD > 0` = 1, sonst 0
- Training: chronologischer 80/20-Split
- Normalisierung: Mean/Std nur aus dem Trainingssplit
- Architektur: Dense 32 → Dropout → Dense 16 → Dense 8 → Sigmoid
- Early stopping auf Validation Loss
- Ein offensichtlich schlechteres Ersatzmodell wird standardmäßig nicht übernommen
- Modell und Scaler werden unter `ML_MODEL_DIR` gespeichert

## Features

1. ADX
2. RSI
3. Relative Volume
4. Signal Score
5. ATR %
6. Hurst
7. MACD Histogram %
8. POC Distance %
9. VWAP Distance %
10. Funding Rate
11. Orderbook Imbalance
12. 4h Trend
13. 1h Trend
14. 15m Trend
15. BTC Trend
16. LONG/SHORT
17. Market Phase

## Warum kein künstliches NO-TRADE-Label?

Die vorhandene MongoDB enthält abgeschlossene Trades, also Beispiele für tatsächlich ausgeführte Setups. Abgelehnte Signale haben keinen tatsächlichen späteren Trade-PnL. Deshalb erzeugt diese Version keine erfundenen NO-TRADE-Labels. Stattdessen wird die positive Erfolgswahrscheinlichkeit mit einem konfigurierbaren Mindestwert kombiniert. Das verhindert, dass das Modell aus künstlichen Labels lernt.

## Installation

```bash
npm install
npm run check
npm start
```

Danach `.env.example` nach `.env` kopieren und mindestens `MONGODB_URI`, `TELEGRAM_BOT_TOKEN` und `TELEGRAM_CHAT_ID` setzen.

## ML-Status

Der Bot stellt zusätzlich bereit:

- `GET /api/ml/status`

und zeigt im Telegram-Befehl `/status` den ML-Zustand, Sample-Anzahl und Validation Accuracy.

## Wichtig vor Live-Trading

Das Modell ist ein lernendes Filtersystem, keine Garantie für profitable Trades. Vor echtem Kapital sollte es mindestens im Paper-/Signalbetrieb und mit einem separaten Out-of-Sample-Backtest geprüft werden. Besonders wichtig ist, dass die Datenbasis ausreichend groß und repräsentativ ist.
