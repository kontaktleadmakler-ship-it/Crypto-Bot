'use strict';

/**
 * Gemeinsame VWAP-Utility für Live-Bot und Backtest-Engine (Punkt 8).
 *
 * Vorher hatten trading-bot-v21.1-tfjs.js und backtest-engine.js zwei separate
 * Implementierungen. Sie waren inhaltlich fast identisch, aber leicht
 * unterschiedlich gerundet, wodurch Live- und Backtest-Ergebnisse bei exakt
 * identischen Eingabedaten trotzdem nicht bitgenau übereinstimmten. Diese
 * Datei ist jetzt die einzige Quelle der Wahrheit für beide.
 *
 * candle.time wird als epoch MILLISECONDS erwartet (KuCoin Futures Kline-
 * Format). Die Session (für den täglichen VWAP-Reset) wird als UTC-Tag
 * berechnet.
 */
function calculateVWAP(candles) {
  if (!candles || candles.length === 0) return 0;

  const lastCandleDate = new Date(candles[candles.length - 1].time);
  const sessionStartMs = Date.UTC(
    lastCandleDate.getUTCFullYear(),
    lastCandleDate.getUTCMonth(),
    lastCandleDate.getUTCDate()
  );

  const sessionCandles = candles.filter(c => c.time >= sessionStartMs);
  const workingSet = sessionCandles.length > 0 ? sessionCandles : candles;

  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  for (const c of workingSet) {
    const typicalPrice = (c.high + c.low + c.close) / 3;
    cumulativeTPV += typicalPrice * c.volume;
    cumulativeVolume += c.volume;
  }

  if (cumulativeVolume === 0) return workingSet[workingSet.length - 1].close;
  return Number((cumulativeTPV / cumulativeVolume).toFixed(4));
}

module.exports = { calculateVWAP };
