'use strict';

/**
 * Phase-A data validation hotfix.
 *
 * IMPORTANT:
 * KuCoin kline `time` is the OPEN timestamp of the candle.
 * The previous validator compared `Date.now()` directly against that
 * timestamp, which made a perfectly usable closed 15m candle appear stale
 * 15 minutes too early.
 *
 * We validate freshness against the candle CLOSE time:
 *   freshnessAnchor = candleOpen + timeframe
 *
 * This module remains fail-closed: if the newest CLOSED candle is genuinely
 * too old, validation still rejects it.
 */
class DataValidator {
  constructor({
    logger = console,
    // Maximum allowed delay AFTER the newest candle has closed.
    // 5 minutes is conservative for a 5-minute scan cycle.
    maxAgeMs = 5 * 60 * 1000,
    futureToleranceMs = 10 * 1000
  } = {}) {
    this.logger = logger;
    this.maxAgeMs = Number.isFinite(Number(maxAgeMs))
      ? Number(maxAgeMs)
      : 5 * 60 * 1000;
    this.futureToleranceMs = futureToleranceMs;
  }

  candles(candles, {
    timeframeMs,
    now = Date.now(),
    minLength = 20,
    requireClosed = true,
    allowGaps = false,
    maxGapFactor = 1.5
  } = {}) {
    if (!Array.isArray(candles) || candles.length < minLength) {
      return { valid: false, reason: 'insufficient-candles' };
    }

    if (!Number.isFinite(timeframeMs) || timeframeMs <= 0) {
      return { valid: false, reason: 'invalid-timeframe' };
    }

    let prevTs = null;

    for (const c of candles) {
      let ts = Number(c?.time ?? c?.timestamp ?? c?.[0]);
      if (Number.isFinite(ts) && ts > 0 && ts < 1e12) ts *= 1000;
      const open = Number(c?.open ?? c?.[1]);
      const high = Number(c?.high ?? c?.[2]);
      const low = Number(c?.low ?? c?.[3]);
      const close = Number(c?.close ?? c?.[4]);
      const volume = Number(c?.volume ?? c?.[5]);

      if (![ts, open, high, low, close, volume].every(Number.isFinite)) {
        return { valid: false, reason: 'non-numeric-candle' };
      }

      if (
        high < Math.max(open, close) ||
        low > Math.min(open, close) ||
        low > high ||
        volume < 0 ||
        open <= 0 ||
        close <= 0
      ) {
        return { valid: false, reason: 'invalid-ohlcv' };
      }

      if (prevTs !== null) {
        if (ts <= prevTs) {
          return { valid: false, reason: 'out-of-order-or-duplicate' };
        }
        if (ts - prevTs > timeframeMs * Math.max(1, Number(maxGapFactor) || 1.5) && !allowGaps) {
          return { valid: false, reason: 'candle-gap' };
        }
      }

      if (ts > now + this.futureToleranceMs) {
        return { valid: false, reason: 'future-data', timestamp: ts };
      }

      prevTs = ts;
    }

    let latest = Number(
      candles[candles.length - 1]?.time ??
      candles[candles.length - 1]?.timestamp ??
      candles[candles.length - 1]?.[0]
    );
    if (Number.isFinite(latest) && latest > 0 && latest < 1e12) latest *= 1000;

    // The candle timestamp is its OPEN time.
    const closeTime = latest + timeframeMs;

    if (requireClosed && closeTime > now + this.futureToleranceMs) {
      return {
        valid: false,
        reason: 'unclosed-latest-candle',
        ageMs: now - latest,
        closeTime
      };
    }

    // Freshness is measured from CLOSE, not OPEN.
    const ageSinceCloseMs = now - closeTime;

    if (ageSinceCloseMs > this.maxAgeMs) {
      return {
        valid: false,
        reason: 'stale-data',
        ageMs: ageSinceCloseMs,
        latestOpenTime: latest,
        latestCloseTime: closeTime
      };
    }

    return {
      valid: true,
      latestOpenTime: latest,
      latestCloseTime: closeTime,
      ageMs: Math.max(0, ageSinceCloseMs)
    };
  }

  finiteObject(obj, required = []) {
    for (const key of required) {
      if (!Number.isFinite(Number(obj?.[key]))) {
        return { valid: false, reason: `invalid:${key}` };
      }
    }
    return { valid: true };
  }
}

module.exports = { DataValidator };
