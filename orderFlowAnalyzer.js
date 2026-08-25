'use strict';

/**
 * L2 microstructure analyzer. Candle OHLCV is never treated as true CVD.
 * Trade-level aggressor data is optional; without it the analyzer remains
 * conservative and returns no directional microstructure signal.
 */
class OrderFlowAnalyzer {
  constructor({ logger = console, wallRatio = 6, minDepthLevels = 3 } = {}) {
    this.logger = logger;
    this.wallRatio = wallRatio;
    this.minDepthLevels = minDepthLevels;
  }

  evaluateOrderFlow(candles, orderBook = {}, trades = []) {
    if (!Array.isArray(orderBook.bids) || !Array.isArray(orderBook.asks)) {
      return { valid: false, reason: 'L2_MISSING', score: 50, pressure: 'UNKNOWN', isTrueCVD: false };
    }
    const bids = normalizeLevels(orderBook.bids);
    const asks = normalizeLevels(orderBook.asks);
    if (bids.length < this.minDepthLevels || asks.length < this.minDepthLevels) {
      return { valid: false, reason: 'L2_INSUFFICIENT_DEPTH', score: 50, pressure: 'UNKNOWN', isTrueCVD: false };
    }

    const bidVol = bids.reduce((s, x) => s + x.qty, 0);
    const askVol = asks.reduce((s, x) => s + x.qty, 0);
    const imbalance = (bidVol - askVol) / Math.max(1e-12, bidVol + askVol);
    const topBid = bids[0].price, topAsk = asks[0].price;
    const mid = (topBid + topAsk) / 2;
    const spreadBps = mid > 0 ? ((topAsk - topBid) / mid) * 10000 : Infinity;

    const agg = aggressorStats(trades);
    const cancelAdd = finite(orderBook.cancelAddRatio, null);
    const persistence = finite(orderBook.depthPersistence, null);
    const withdrawal = finite(orderBook.liquidityWithdrawal, null);
    const lifetime = finite(orderBook.orderLifetimeMs, null);
    const sweep = finite(orderBook.sweepScore, 0);
    const absorption = finite(orderBook.absorptionScore, 0);

    const wall = detectWall(bids, asks, this.wallRatio);
    // A wall is evidence, never a signal. Penalize wall-only directional bias.
    const independentEvidence = [
      Math.abs(agg.aggression) > 1e-9 ? 1 : 0,
      Math.abs(sweep) > 1e-9 ? 1 : 0,
      Math.abs(absorption) > 1e-9 ? 1 : 0,
      Number.isFinite(persistence) ? 1 : 0,
      Number.isFinite(withdrawal) ? 1 : 0
    ].reduce((a,b)=>a+b,0);
    const rawScore = 50 + imbalance * 35 + (agg.aggression || 0) * 20 + sweep * 10 + absorption * 10
      + (persistence || 0) * 8 - (withdrawal || 0) * 8;
    const score = clamp(rawScore, 0, 100);
    const pressure = independentEvidence < 2 ? 'NEUTRAL' : score >= 65 ? 'BULLISH_DOMINANT' : score <= 35 ? 'BEARISH_DOMINANT' : 'NEUTRAL';

    return {
      valid: true,
      score,
      pressure,
      spreadBps,
      imbalance,
      tradeAggression: agg,
      cancelAddRatio: cancelAdd,
      depthPersistence: persistence,
      liquidityWithdrawal: withdrawal,
      sweepScore: sweep,
      absorptionScore: absorption,
      orderLifetimeMs: lifetime,
      wallDetected: wall.detected,
      wallSide: wall.side,
      wallOnlySignalBlocked: wall.detected && independentEvidence < 2,
      independentEvidence,
      isTrueCVD: agg.tradeCount > 0,
      cvd: agg.cvd
    };
  }
}

function normalizeLevels(levels) {
  return levels.map(x => Array.isArray(x) ? { price: Number(x[0]), qty: Number(x[1]) } : { price: Number(x.price), qty: Number(x.qty ?? x.quantity) })
    .filter(x => Number.isFinite(x.price) && Number.isFinite(x.qty) && x.qty >= 0)
    .sort((a,b) => b.price - a.price);
}
function aggressorStats(trades) {
  let buy = 0, sell = 0, cvd = 0, tradeCount = 0;
  for (const t of Array.isArray(trades) ? trades : []) {
    const qty = Number(t.qty ?? t.quantity ?? t.size);
    const side = String(t.aggressorSide ?? t.side ?? '').toUpperCase();
    if (!Number.isFinite(qty) || qty <= 0 || !['BUY','SELL'].includes(side)) continue;
    tradeCount++;
    if (side === 'BUY') { buy += qty; cvd += qty; } else { sell += qty; cvd -= qty; }
  }
  return { buyAggression: buy, sellAggression: sell, aggression: (buy - sell) / Math.max(1e-12, buy + sell), cvd, tradeCount };
}
function detectWall(bids, asks, ratio) {
  const median = arr => { const a = arr.map(x => x.qty).sort((x,y)=>x-y); return a.length ? a[Math.floor(a.length/2)] : 0; };
  const bm = median(bids), am = median(asks);
  const bidWall = bids.find(x => bm > 0 && x.qty >= bm * ratio);
  const askWall = asks.find(x => am > 0 && x.qty >= am * ratio);
  if (bidWall && !askWall) return { detected: true, side: 'BID' };
  if (askWall && !bidWall) return { detected: true, side: 'ASK' };
  if (bidWall || askWall) return { detected: true, side: 'BOTH' };
  return { detected: false, side: null };
}
function finite(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function clamp(v,min,max){return Math.max(min,Math.min(max,v));}

function validateOrderBookSnapshot(orderBook, { maxAgeMs = 5000, minLevels = 1 } = {}) {
  if (!orderBook || typeof orderBook !== 'object') return { valid: false, reason: 'MISSING' };
  if (!Number.isFinite(orderBook.timestamp)) return { valid: false, reason: 'NO_TIMESTAMP' };
  if (Date.now() - orderBook.timestamp > maxAgeMs) return { valid: false, reason: 'STALE' };
  if (!Array.isArray(orderBook.bids) || !Array.isArray(orderBook.asks)) return { valid: false, reason: 'MISSING_LEVELS' };
  if (orderBook.bids.length < minLevels || orderBook.asks.length < minLevels) return { valid: false, reason: 'INSUFFICIENT_DEPTH' };
  return { valid: true };
}

module.exports = { OrderFlowAnalyzer, validateOrderBookSnapshot };
