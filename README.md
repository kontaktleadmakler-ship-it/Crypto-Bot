# Crypto Trading Bot v21.1 — TensorFlow.js + Backtesting

This is the v21.1 evolution of the existing v21.0 TensorFlow.js trading bot.

## Included

- `trading-bot-v21.1-tfjs.js` — main live/signal bot
- `ml-engine.js` — TensorFlow.js ML engine
- `backtest-engine.js` — historical strategy simulator + walk-forward ML
- `backtest.js` — command-line backtest runner
- `trading-bot-v21.0-tfjs.js` — v21.0 reference version
- `trading-bot-v20.8-brainjs-backup.js` — Brain.js backup
- `.env.example` — safe configuration template
- `.gitignore` — prevents secrets, dependencies and trained models from being committed

## Security

Keep the repository **Private**.

Never commit `.env`, KuCoin credentials, MongoDB URLs, Telegram tokens or other secrets.
Use environment variables / Codespaces secrets for credentials.

If a token was ever exposed, rotate it before live trading.

## Install

```bash
npm install
npm run check
```

## Backtest

Default: 30 days of 15-minute KuCoin Futures OHLCV data with walk-forward TensorFlow.js filtering.

```bash
npm run backtest -- --symbol BTC-USDT --days 30
```

Without ML, to compare the underlying strategy:

```bash
npm run backtest:no-ml -- --symbol BTC-USDT --days 30
```

Longer test:

```bash
npm run backtest -- --symbol BTC-USDT --days 90 --capital 10000
```

The command prints performance metrics and writes a JSON trade report. Use `--out result.json` to choose the output filename.

## What the backtest does

- Uses 15m historical OHLCV candles.
- Derives 1h and 4h candles from the same historical series.
- Applies the core v21.0 direction gates: multi-timeframe trend, BTC trend, ADX, Hurst, choppiness, BOS, RSI, POC/VWAP, MACD and relative volume.
- Uses the v21.0 ATR stop, TP1, TP2, trailing stop, fees and slippage assumptions.
- Enters on the next candle open after a signal to avoid look-ahead bias.
- Uses conservative stop-first ordering when SL and TP are both touched inside one candle.
- Includes a walk-forward ML layer: only completed simulated trades from the past are eligible for ML training before a future signal is evaluated.
- Produces win rate, net profit, return, profit factor, maximum drawdown, expectancy and an approximate Sharpe ratio.

## Backtest limitations

Historical exchange OHLCV does **not** contain the same information as the live bot's orderbook and funding endpoints. Therefore v21.1 backtest explicitly assumes:

- funding rate = 0 unless a historical funding dataset is added;
- orderbook imbalance = neutral;
- no historical spread/orderbook execution data;
- intrabar SL/TP ordering is conservative (stop first when both are touched).

Therefore the backtest is a research/simulation tool, not proof of future profitability.

## Live bot

The live bot continues to use the existing MongoDB, Telegram, KuCoin and TensorFlow.js architecture. Before enabling real trading, run both ML and non-ML backtests, then paper/signal-test the system out of sample.
