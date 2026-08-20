'use strict';

class OrderFlowAnalyzer {
  constructor({ logger = console } = {}) { this.logger = logger; }

  evaluateOrderFlow(candles, orderBook = {}) {
    if (!Array.isArray(candles) || candles.length < 5) return { valid: false, score: 50, pressure: 'UNKNOWN', cvd: null, isTrueCVD: false };
    // Candle OHLCV cannot establish aggressor side. This is deliberately named
    // candle-volume pressure, not CVD. Real CVD requires trade-level aggressor data.
    let delta = 0;
    for (const c of candles.slice(-20)) {
      const open = Number(c.open ?? c[1]);
      const close = Number(c.close ?? c[4]);
      const volume = Number(c.volume ?? c[5]);
      const range = Math.max(Number(c.high ?? c[2]) - Number(c.low ?? c[3]), 1e-12);
      delta += ((close - open) / range) * volume;
    }
    const last = candles.slice(-20).reduce((s, c) => s + Number(c.volume ?? c[5]), 0);
    const normalized = last > 0 ? delta / last : 0;
    const score = Math.max(0, Math.min(100, 50 + normalized * 50));
    let pressure = 'NEUTRAL';
    if (score >= 65) pressure = 'BULLISH_DOMINANT';
    else if (score <= 35) pressure = 'BEARISH_DOMINANT';
    return { valid: true, score, pressure, cvd: null, isTrueCVD: false, candleVolumePressure: normalized };
  }
}
module.exports = { OrderFlowAnalyzer };
