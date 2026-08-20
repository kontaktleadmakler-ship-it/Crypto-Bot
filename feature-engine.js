'use strict';

const { calculateEMA } = require('./indicators-safe');

function clamp(v, min, max) { return Math.max(min, Math.min(max, Number(v) || 0)); }
function finite(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }

function candleMid(c) { return (finite(c.high) + finite(c.low) + finite(c.close)) / 3; }

function volumeWeightedMACD(candles, fast = 12, slow = 26, signal = 9) {
  if (!Array.isArray(candles) || candles.length < slow + signal) return { line: 0, signal: 0, histogram: 0, vwPrices: [] };
  const vwPrices = candles.map(c => {
    const v = Math.max(finite(c.volume), 0);
    const typical = candleMid(c);
    return v > 0 ? ((typical * v) + (finite(c.close) * v)) / (2 * v) : finite(c.close);
  });
  const fastEma = calculateEMA(vwPrices, fast);
  const slowEma = calculateEMA(vwPrices, slow);
  const scale = slowEma ? finite(vwPrices.at(-1)) / slowEma : 1;
  const line = (fastEma - slowEma) * scale;
  const pseudoSeries = [];
  for (let i = slow - 1; i < vwPrices.length; i++) {
    const s = vwPrices.slice(0, i + 1);
    pseudoSeries.push((calculateEMA(s, fast) - calculateEMA(s, slow)) * (calculateEMA(s, slow) ? s.at(-1) / calculateEMA(s, slow) : 1));
  }
  const sig = calculateEMA(pseudoSeries, signal);
  return { line, signal: sig, histogram: line - sig, vwPrices };
}

function ichimoku(candles, conversion = 9, base = 26, spanB = 52) {
  if (!Array.isArray(candles) || candles.length < spanB) return { conversion: null, base: null, spanA: null, spanB: null, price: null, cloudBias: 'NEUTRAL' };
  const hiLo = (arr) => ({ hi: Math.max(...arr.map(c => finite(c.high))), lo: Math.min(...arr.map(c => finite(c.low))) });
  const last = candles.at(-1);
  const conv = hiLo(candles.slice(-conversion));
  const bas = hiLo(candles.slice(-base));
  const sb = hiLo(candles.slice(-spanB));
  const conversionLine = (conv.hi + conv.lo) / 2;
  const baseLine = (bas.hi + bas.lo) / 2;
  const spanBLine = (sb.hi + sb.lo) / 2;
  const spanALine = (conversionLine + baseLine) / 2;
  const top = Math.max(spanALine, spanBLine), bottom = Math.min(spanALine, spanBLine);
  const price = finite(last.close);
  const cloudBias = price > top && conversionLine >= baseLine ? 'BULLISH' : price < bottom && conversionLine <= baseLine ? 'BEARISH' : 'NEUTRAL';
  return { conversion: conversionLine, base: baseLine, spanA: spanALine, spanB: spanBLine, price, cloudTop: top, cloudBottom: bottom, cloudBias };
}

function swingPoints(candles, lookback = 5) {
  const highs = [], lows = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i];
    const left = candles.slice(i - lookback, i), right = candles.slice(i + 1, i + lookback + 1);
    if (c.high >= Math.max(...left.map(x => x.high), ...right.map(x => x.high))) highs.push({ index: i, price: finite(c.high) });
    if (c.low <= Math.min(...left.map(x => x.low), ...right.map(x => x.low))) lows.push({ index: i, price: finite(c.low) });
  }
  return { highs, lows };
}

function fibonacciLevels(candles, lookback = 120) {
  if (!Array.isArray(candles) || candles.length < 10) return { direction: 'NEUTRAL', swingHigh: null, swingLow: null, levels: {} };
  const sample = candles.slice(-lookback);
  const high = Math.max(...sample.map(c => finite(c.high)));
  const low = Math.min(...sample.map(c => finite(c.low)));
  const last = finite(sample.at(-1).close);
  const range = high - low;
  if (!(range > 0)) return { direction: 'NEUTRAL', swingHigh: high, swingLow: low, levels: {} };
  const direction = last >= (high + low) / 2 ? 'BULLISH' : 'BEARISH';
  const ratios = [0.236, 0.382, 0.5, 0.618, 0.786];
  const levels = Object.fromEntries(ratios.map(r => [String(r), direction === 'BULLISH' ? high - range * r : low + range * r]));
  return { direction, swingHigh: high, swingLow: low, levels };
}

function fibonacciEntryZone(fib, price, direction, tolerance = 0.004) {
  const values = Object.values(fib?.levels || {}).filter(Number.isFinite);
  if (!values.length) return { inZone: false, nearest: null, ratio: null, distancePct: null };
  let nearest = null;
  for (const [ratio, level] of Object.entries(fib.levels)) {
    const d = Math.abs(price - level) / price;
    if (!nearest || d < nearest.distance) nearest = { ratio, level, distance: d };
  }
  return { inZone: nearest.distance <= tolerance, nearest: nearest.level, ratio: nearest.ratio, distancePct: nearest.distance * 100, direction };
}

const DEFAULT_WEIGHTS = {
  TRENDING: { '1m': 0.05, '5m': 0.10, '15m': 0.20, '1h': 0.30, '4h': 0.35 },
  RANGING:  { '1m': 0.10, '5m': 0.20, '15m': 0.30, '1h': 0.25, '4h': 0.15 },
  VOLATILE: { '1m': 0.10, '5m': 0.25, '15m': 0.30, '1h': 0.20, '4h': 0.15 }
};
function directionScore(trend, direction) { return trend === (direction === 'LONG' ? 'BULLISH' : 'BEARISH') ? 1 : trend === 'NEUTRAL' ? 0 : -1; }
function multiTimeframeConfluence(timeframes, direction, phase = 'RANGING', weights = DEFAULT_WEIGHTS) {
  const matrix = weights[phase] || weights.RANGING;
  let score = 0, total = 0;
  const details = {};
  for (const tf of Object.keys(matrix)) {
    const s = directionScore(timeframes?.[tf], direction);
    score += s * matrix[tf]; total += matrix[tf]; details[tf] = { trend: timeframes?.[tf] || 'NEUTRAL', score: s, weight: matrix[tf] };
  }
  return { score: total ? clamp((score / total + 1) * 50, 0, 100) : 50, signedScore: total ? score / total : 0, weights: matrix, details };
}

function trueCVDFromTrades(trades, initial = 0) {
  let cvd = finite(initial), buy = 0, sell = 0;
  for (const t of trades || []) {
    const size = Math.abs(finite(t.size ?? t.volume ?? t.qty));
    const side = String(t.side || t.takerSide || '').toLowerCase();
    if (side === 'buy' || side === 'long') { cvd += size; buy += size; }
    else if (side === 'sell' || side === 'short') { cvd -= size; sell += size; }
  }
  return { cvd, buyVolume: buy, sellVolume: sell, delta: buy - sell, isTrueCVD: true };
}
function approximateCVD(candles, lookback = 20) {
  let delta = 0, volume = 0;
  for (const c of (candles || []).slice(-lookback)) {
    const o = finite(c.open), cl = finite(c.close), h = finite(c.high), l = finite(c.low), v = Math.max(0, finite(c.volume));
    const range = Math.max(h - l, 1e-12);
    delta += ((cl - o) / range) * v; volume += v;
  }
  return { cvd: delta, delta, buyVolume: Math.max(volume + delta, 0) / 2, sellVolume: Math.max(volume - delta, 0) / 2, isTrueCVD: false, confidence: 0.35 };
}

function buildFeatureSnapshot({ candlesByTf, phase, direction, cvdTrades = [], config = {} }) {
  const c15 = candlesByTf['15m'] || [];
  const price = finite(c15.at(-1)?.close);
  const iw = ichimoku(c15, config.ICHIMOKU_CONVERSION || 9, config.ICHIMOKU_BASE || 26, config.ICHIMOKU_SPAN_B || 52);
  const fib = fibonacciLevels(c15, config.FIB_LOOKBACK || 120);
  const fibZone = fibonacciEntryZone(fib, price, direction, config.FIB_ZONE_TOLERANCE || 0.004);
  const cvd = cvdTrades.length ? trueCVDFromTrades(cvdTrades, config.CVD_INITIAL || 0) : approximateCVD(c15, config.CVD_LOOKBACK || 20);
  const vwm = volumeWeightedMACD(c15, config.VWMACD_FAST || 12, config.VWMACD_SLOW || 26, config.VWMACD_SIGNAL || 9);
  const timeframes = Object.fromEntries(Object.entries(candlesByTf).map(([tf, c]) => [tf, c?.length ? (calculateEMA(c.map(x => finite(x.close)), 20) >= calculateEMA(c.map(x => finite(x.close)), 50) ? 'BULLISH' : 'BEARISH') : 'NEUTRAL']));
  const confluence = multiTimeframeConfluence(timeframes, direction, phase, DEFAULT_WEIGHTS);
  const ichimokuScore = iw.cloudBias === (direction === 'LONG' ? 'BULLISH' : 'BEARISH') ? 100 : iw.cloudBias === 'NEUTRAL' ? 50 : 0;
  const volumeMACDScore = vwm.histogram > 0 === (direction === 'LONG') ? 100 : 0;
  const cvdScore = cvd.delta > 0 === (direction === 'LONG') ? 100 : 0;
  return { price, cvd, volumeWeightedMACD: vwm, ichimoku: iw, fibonacci: fib, fibonacciZone: fibZone, timeframes, confluence, ichimokuScore, volumeMACDScore, cvdScore };
}

module.exports = { volumeWeightedMACD, ichimoku, fibonacciLevels, fibonacciEntryZone, multiTimeframeConfluence, trueCVDFromTrades, approximateCVD, buildFeatureSnapshot, DEFAULT_WEIGHTS, swingPoints };
