'use strict';

class DataFusion {
  constructor({ logger = console, maxAgeMs = 1200000 } = {}) { this.logger = logger; this.maxAgeMs = maxAgeMs; }
  normalizeCandle(c) {
    const rawTs = Number(c?.time ?? c?.timestamp ?? c?.[0]);
    const ts = rawTs > 0 && rawTs < 1e12 ? rawTs * 1000 : rawTs;
    return { timestamp: ts, open: Number(c?.open ?? c?.[1]), high: Number(c?.high ?? c?.[2]), low: Number(c?.low ?? c?.[3]), close: Number(c?.close ?? c?.[4]), volume: Number(c?.volume ?? c?.[5]) };
  }
  candles(candles, { now = Date.now(), timeframeMs, minLength = 20 } = {}) {
    const rows = (candles || []).map(c => this.normalizeCandle(c)).sort((a,b)=>a.timestamp-b.timestamp);
    if (rows.length < minLength) return { valid:false, reason:'insufficient-candles', rows };
    const valid = rows.every(r => [r.timestamp,r.open,r.high,r.low,r.close,r.volume].every(Number.isFinite) && r.open > 0 && r.close > 0 && r.volume >= 0);
    if (!valid) return { valid:false, reason:'non-numeric-or-invalid-ohlcv', rows };
    const latestAgeMs = now - rows.at(-1).timestamp;
    const gapCount = timeframeMs ? rows.slice(1).filter((r,i)=>r.timestamp-rows[i].timestamp > timeframeMs*1.5).length : 0;
    const stale = latestAgeMs > this.maxAgeMs;
    return { valid: !stale, reason: stale ? 'stale-data' : null, rows, latestAgeMs, gapCount, qualityScore: Math.max(0, 1 - (stale ? .6 : 0) - Math.min(gapCount / Math.max(rows.length-1,1), .4)) };
  }
  merge(primary, fallback) {
    if (primary?.valid) return { ...primary, source:'primary' };
    if (fallback?.valid) { this.logger.warn?.('[DATA-FUSION] primary invalid, using fallback source'); return { ...fallback, source:'fallback' }; }
    return { valid:false, reason: primary?.reason || fallback?.reason || 'no-valid-source' };
  }
}
module.exports = { DataFusion };
