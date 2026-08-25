# JARVIS Live Neural Dashboard

## Start

The dashboard is integrated into the existing institutional runtime.

```bash
npm install
npm start
```

Open:

`/dashboard`

Example on Render:

`https://<your-render-service>/dashboard`

## Live data

The dashboard does not generate mock market values. It reads through the existing `KuCoinFuturesAdapter` and uses:

- live KuCoin Futures ticker
- closed 15m candles
- L2 order-book snapshot / validated order-book engine when available
- funding/open-interest contract data
- existing Macro/Fear & Greed engine
- existing RiskEngine and active paper positions
- existing market phase

The browser refreshes the active symbol approximately every 2.5 seconds. Server-side caching limits repeated exchange requests.

## API security

The dashboard page itself is public so the browser can show the secure API-key prompt. `/api/dashboard/live` remains protected by the existing `X-API-Key` middleware.

Enter the bot's existing `API_KEY` in the dashboard. It is stored only in browser `localStorage` and sent as `X-API-Key` for the live-data request.

If `ALLOW_UNAUTHENTICATED_API=true` is intentionally enabled, the dashboard can also be used without a key.

## Decision path

The visual neural path is:

`COIN FEED → TECHNICAL AGENT → SENTIMENT AGENT → RISK ENGINE → DECISION CORE`

The dashboard shows the live values used for its visualization and the reason for the current veto/approval.

The dashboard is analysis/paper/shadow oriented. It does not add live order execution and does not bypass the bot's existing execution, reconciliation, risk, or safety gates.
