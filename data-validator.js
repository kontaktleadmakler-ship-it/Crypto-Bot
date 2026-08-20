'use strict';

class DataValidator {
  constructor({ logger = console, maxAgeMs = 180000 } = {}) {
    this.logger = logger;
    this.maxAgeMs = maxAgeMs;
  }

  candles(candles, {
    timeframeMs,
    now = Date.now(),
    minLength = 20,
    maxAgeMs = this.maxAgeMs,
    allowGaps = false,
    maxGapFactor = 1.5,
    maxGapRatio = 0.25
  } = {}) {
    if (!Array.isArray(candles) || candles.length < minLength) return { valid: false, reason: 'insufficient-candles' };

    // KuCoin may omit a candle completely when there are no ticks. Sort first
    // so validation is independent of response ordering, then treat such gaps
    // as a quality warning in tolerant live-scan mode instead of discarding
    // every illiquid contract. Strict/backtest callers retain the old behavior.
    const rows = candles.slice().sort((a, b) => Number(a.time ?? a.timestamp ?? a[0]) - Number(b.time ?? b.timestamp ?? b[0]));
    let prevTs = null;
    let gapCount = 0;
    let maxGapIntervals = 0;
    let maxObservedGapMs = 0;

    for (const c of rows) {
      const rawTs = Number(c.time ?? c.timestamp ?? c[0]);
      const ts = rawTs > 0 && rawTs < 1e12 ? rawTs * 1000 : rawTs;
      const open = Number(c.open ?? c[1]);
      const high = Number(c.high ?? c[2]);
      const low = Number(c.low ?? c[3]);
      const close = Number(c.close ?? c[4]);
      const volume = Number(c.volume ?? c[5]);
      if (![ts, open, high, low, close, volume].every(Number.isFinite)) return { valid: false, reason: 'non-numeric-candle' };
      if (high < Math.max(open, close) || low > Math.min(open, close) || low > high || volume < 0 || open <= 0 || close <= 0) return { valid: false, reason: 'invalid-ohlcv' };
      if (prevTs !== null && timeframeMs) {
        const diff = ts - prevTs;
        if (diff <= 0) return { valid: false, reason: 'out-of-order-or-duplicate' };
        if (diff > timeframeMs * maxGapFactor) {
          gapCount++;
          const intervals = Math.max(1, Math.round(diff / timeframeMs) - 1);
          maxGapIntervals = Math.max(maxGapIntervals, intervals);
          maxObservedGapMs = Math.max(maxObservedGapMs, diff);
          if (!allowGaps) return { valid: false, reason: 'candle-gap', gapCount, maxGapIntervals, maxObservedGapMs };
        }
      }
      prevTs = ts;
    }

    const rawLatest = Number(rows[rows.length - 1].time ?? rows[rows.length - 1].timestamp ?? rows[rows.length - 1][0]);
    const latest = rawLatest > 0 && rawLatest < 1e12 ? rawLatest * 1000 : rawLatest;
    const effectiveMaxAgeMs = Number.isFinite(Number(maxAgeMs)) ? Number(maxAgeMs) : this.maxAgeMs;
    if (now - latest > effectiveMaxAgeMs) return { valid: false, reason: 'stale-data', ageMs: now - latest };
    if (latest > now + 10000) return { valid: false, reason: 'future-data' };

    const gapRatio = rows.length > 1 ? gapCount / (rows.length - 1) : 0;
    if (allowGaps && gapCount && gapRatio > maxGapRatio) {
      return { valid: false, reason: 'excessive-candle-gaps', gapCount, gapRatio, maxGapIntervals, maxObservedGapMs };
    }

    return {
      valid: true,
      warnings: gapCount ? [{ reason: 'candle-gap', gapCount, gapRatio, maxGapIntervals, maxObservedGapMs }] : []
    };
  }

  finiteObject(obj, required = []) {
    for (const key of required) if (!Number.isFinite(Number(obj?.[key]))) return { valid: false, reason: `invalid:${key}` };
    return { valid: true };
  }
}
module.exports = { DataValidator };
