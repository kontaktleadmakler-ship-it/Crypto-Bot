# Crypto Bot Optimized (v2.1 - Anti-Blockade Release)

Behebt hängende `asyncPool`-Warteschlangen und `RENDER-USDT` Market-Data-Timeouts.

## Wichtigste Features:
1. **Strikter Timeout im asyncPool:** Nutzt `AbortController`, um blockierte Requests nach einer einstellbaren Zeit (Standard: 10s statt 60s) hart abzubrechen.
2. **Automatischer Fallback:** Verhindert `LIVE_MARKET_DATA_UNAVAILABLE`-Kettenreaktionen durch Rückgriff auf gecachte/letzte gültige Daten.
3. **Keine Pool-Blockaden mehr:** Tasks verstopfen nicht mehr den Concurrency-Pool.

## Start
```bash
npm install
npm start
```
