# Reproducible OHLCV-Daten

Der Bot bleibt Signal/Paper-only. Der Downloader verwendet ausschließlich den öffentlichen KuCoin-Futures-Kline-Endpunkt und enthält keine Order-Execution.

## Download

```bash
npm run data:download -- --symbol BTC-USDT --timeframe 15m --from 2025-01-01 --to 2026-01-01
```

Optionaler Speicherort:

```bash
npm run data:download -- --symbol BTC-USDT --timeframe 15m --from 2025-01-01 --output ./data/ohlcv
```

Die Datei wird unter `data/ohlcv/BTC-USDT/15m.json` gespeichert. Das Dataset enthält Metadaten und ein `bars`-Array.

## Qualität prüfen

```bash
npm run data:validate -- data/ohlcv/BTC-USDT/15m.json
```

Geprüft werden u. a. Duplikate, Reihenfolge, ungültige OHLCV-Werte und zeitliche Lücken.

## Offline-Backtest

```bash
node backtest.js --symbol BTC-USDT --dataDir ./data/ohlcv --noMl
```

Für ein Nicht-BTC-Symbol erwartet der Backtest zusätzlich `data/ohlcv/BTC-USDT/15m.json`, damit der BTC-Countertrend-Filter dieselbe historische Zeitachse verwenden kann.

Beispiel:

```bash
npm run data:download -- --symbol BTC-USDT --timeframe 15m --from 2025-01-01 --to 2026-01-01
npm run data:download -- --symbol ETH-USDT --timeframe 15m --from 2025-01-01 --to 2026-01-01
node backtest.js --symbol ETH-USDT --dataDir ./data/ohlcv --noMl --walkForward false
```
