# Trading Bot v21.7 – Refactor / Hardening

## Sicherheitsgrenze

Der Bot bleibt **ausschließlich Signal- und Paper-Trading**. Es wurde **keine** Logik zum Platzieren, Ändern oder Stornieren realer Orders ergänzt. Das neue KuCoin-Modul stellt absichtlich nur GET-/Marktdaten-Funktionen bereit.

Die bestehende Codebasis verwendet MongoDB, Telegram, TensorFlow.js/DQN, KuCoin-Marktdaten und Backtesting. Die Hauptdatei ist weiterhin ein stark gekoppelter Kompatibilitäts-Einstiegspunkt; die neue `src/`-Struktur extrahiert die risikoarmen, deterministischen und wiederverwendbaren Bausteine schrittweise.

## Änderungsplan

| Datei | Änderung |
|---|---|
| `src/indicators.js` | Gemeinsame EMA, RSI, ATR, ADX, Hurst, MACD, VWAP, POC, RelVol, BOS, Chop, Aggregation |
| `src/config.js` | Zentrale ENV-/Profil-Konfiguration und Filter-Registry |
| `src/filter-system.js` | Zentraler Filter-/Confluence-Score; `filterState`, adaptive ADX/Volume und Short-Gate |
| `src/queue.js` | Begrenzte Async-/Retry-Queues |
| `src/api/kucoin.js` | GET-only KuCoin-Marktdaten mit Retry/Circuit-Breaker |
| `src/risk-manager.js` | Paper-Risikoberechnung, Drawdown, Exposure, Kelly |
| `src/tracker.js` | Paper-Trade-Mark-to-market/Stop/TP-Hilfslogik |
| `src/telegram-bot.js` | Telegram Polling/Send + bounded queue |
| `src/index.js` | Dependency-Injection/Composition Root für die neuen Services |
| `trading-bot-v21.1-tfjs.js` | Kritische Fixes, gemeinsame Indikatoren, bounded Telegram/DB queues, API-Key und Health |
| `backtest-engine.js` | Gemeinsame Indikatorquelle |
| `ml-engine.js` | Hyperparameter-Suche nur täglich/alle N Retrains |
| `rl-engine.js` | `tf.tidy()` für Prediction-Tensoren + sichere Async-Disposition |
| `tests/indicators.test.js` | RSI/ATR/MACD/ADX/Filter-Regressionstests |

## Kritische Fixes

### 1. Shorts

Ein sekundäres SHORT-Signal wird nur noch geprüft, wenn `ENABLE_SHORT_SIGNALS === true`. Das verhindert insbesondere den Fehlerfall `primaryDir === LONG` + `ENABLE_SHORT_SIGNALS=false`.

### 2. Adaptive ADX / Volume

`evaluateDirectionGates()` verwendet die tatsächlich übergebenen Werte:

- `p.adaptiveADX`
- `p.adaptiveVolume`

und fällt nur bei fehlendem/nicht-numerischem Wert auf die Basis-Konfiguration zurück.

### 3. Filter-Off

Folgende Filter beeinflussen Score und Gate nur noch, wenn sie aktiviert sind:

- Hurst
- ADX
- Choppiness
- RSI-Zone
- Relatives Volumen
- POC/VWAP-Lage
- MACD
- BOS
- 4H-Trend
- BTC-Countertrend

Ein deaktivierter Filter erhält **keine Punkte und keinen Malus**.

## Dynamische Filter

| Filter | Bedeutung | Standard | Telegram |
|---|---|---:|---|
| `adx` | Trendstärke über ADX | 20 | `/filter adx on`, `/filter adx off`, `/filter adx 24` |
| `hurst` | Persistenz/Trendcharakter der Renditen | 0.52 | `/filter hurst on/off/value` |
| `chop` | Choppiness; hohe Werte = Seitwärtsmarkt | 61.8 max | `/filter chop on/off/value` |
| `relvol` | Aktuelles Volumen relativ zum Mittel | 1.2 | `/filter relvol on/off/value` |
| `bos` | Break of Structure | 10 Bars | `/filter bos on/off/value` |
| `rsi_long_min` | Untergrenze RSI für Long | 48 | `/filter rsi_long_min on/off/value` |
| `rsi_short_max` | Obergrenze RSI für Short | 52 | `/filter rsi_short_max on/off/value` |
| `pocvwap` | Preis relativ zu POC und VWAP | aktiv | `/filter pocvwap on/off` |
| `macd` | MACD-Histogramm in Signalrichtung | aktiv | `/filter macd on/off` |
| `trend4h` | 4H-Trend-Ausrichtung | aktiv | `/filter trend4h on/off` |
| `btctrend` | BTC-Countertrend-Schutz | aktiv | `/filter btctrend on/off` |
| `timetrend` | Zeitbasierter Lern-/Historienfilter | aktiv | `/filter timetrend on/off` |

## Kline-Caching

Der Scan-Standard wurde von 100 auf **60 abgeschlossene 15m-Kerzen** reduziert. 60 reichen für den gemeinsamen Indikatorsatz einschließlich MACD; die übrigen HTF-Daten werden separat geladen/abgeleitet.

Konfigurierbar über:

```env
KLINES_SCAN_LIMIT=60
```

## ML Hyperparameter

Die bestehende ML-Engine speichert `bestHyperparameters` bereits in `metadata.json`. Die neue Logik führt die Suche nur noch aus, wenn:

- ein Modell noch keine gespeicherten Hyperparameter hat,
- ein neuer UTC-Tag begonnen hat,
- `force=true` gesetzt ist,
- oder der Retrain-Zähler jedes N-te Retraining erreicht.

Standard:

```env
ML_HYPERPARAM_SEARCH_EVERY=5
```

## Health Monitoring

`/health` prüft:

- MongoDB-Verbindungsstatus
- KuCoin-Marktdaten-Erreichbarkeit
- ML-Modellstatus
- Telegram-Konfiguration/Erreichbarkeit

Bei einem neuen Fehlerzustand wird maximal einmal je 30 Minuten ein Telegram-Alarm ausgelöst.

## Express-Schutz

Bei `0.0.0.0` sollte `API_KEY` gesetzt werden:

```env
API_KEY=change-me
API_BIND_HOST=0.0.0.0
```

Requests benötigen:

```http
X-API-Key: change-me
```

Optional kann `/health` mit `HEALTH_PUBLIC=true` öffentlich gemacht werden.

## Queues

Telegram:

```env
TELEGRAM_QUEUE_MAX=100
```

MongoDB Bulk:

```env
DB_BULK_QUEUE_MAX=500
DB_BULK_MAX_RETRIES=3
```

Bei Überlauf werden die ältesten wartenden Einträge verworfen. Fehlgeschlagene DB-Batches werden maximal dreimal erneut versucht und danach geloggt.

## Tests

```bash
node tests/indicators.test.js
node tests/hardening.test.js
npm test
```

Vor dem produktiven Einsatz sollte zusätzlich ein vollständiger Backtest-Vergleich mit identischem Datensatz erfolgen, weil die Extraktion der Indikatoren absichtlich die bestehende Live-Berechnung als gemeinsame Referenz verwendet.
