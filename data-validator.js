'use strict';

class DataValidator {
  constructor({ logger = console, maxAgeMs = 180000 } = {}) {
    this.logger = logger;
    this.maxAgeMs = maxAgeMs;
  }

  candles(candles, { timeframeMs, now = Date.now(), minLength = 20 } = {}) {
    if (!Array.isArray(candles) || candles.length < minLength) return { valid: false, reason: 'insufficient-candles' };
    let prevTs = null;
    for (const c of candles) {
      const ts = Number(c.time ?? c.timestamp ?? c[0]);
      const open = Number(c.open ?? c[1]);
      const high = Number(c.high ?? c[2]);
      const low = Number(c.low ?? c[3]);
      const close = Number(c.close ?? c[4]);
      const volume = Number(c.volume ?? c[5]);
      if (![ts, open, high, low, close, volume].every(Number.isFinite)) return { valid: false, reason: 'non-numeric-candle' };
      if (high < Math.max(open, close) || low > Math.min(open, close) || low > high || volume < 0 || open <= 0 || close <= 0) return { valid: false, reason: 'invalid-ohlcv' };
      if (prevTs !== null) {
        if (ts <= prevTs) return { valid: false, reason: 'out-of-order-or-duplicate' };
        if (timeframeMs && ts - prevTs > timeframeMs * 1.5) return { valid: false, reason: 'candle-gap' };
      }
      prevTs = ts;
    }
    const latest = Number(candles[candles.length - 1].time ?? candles[candles.length - 1].timestamp ?? candles[candles.length - 1][0]);
    if (now - latest > this.maxAgeMs) return { valid: false, reason: 'stale-data', ageMs: now - latest };
    if (latest > now + 10000) return { valid: false, reason: 'future-data' };
    return { valid: true };
  }

  finiteObject(obj, required = []) {
    for (const key of required) if (!Number.isFinite(Number(obj?.[key]))) return { valid: false, reason: `invalid:${key}` };
    return { valid: true };
  }
}
module.exports = { DataValidator };
