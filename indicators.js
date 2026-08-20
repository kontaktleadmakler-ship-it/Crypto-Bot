'use strict';

/**
 * Central indicator library.
 * // IMPROVED: Live bot and backtest use the same implementations.
 */
const { calculateVWAP } = require('./vwap-calculator');

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function calculateEMA(prices, period) {
  if (!prices || prices.length < period) return prices?.[prices.length - 1] ?? 0;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) ema = prices[i] * k + ema * (1 - k);
  return ema;
}

function calculateEMASeries(values, period) {
  if (!values || values.length < period) return [];
  const out = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = ema;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

function calculateRSI(prices, period = 14) {
  if (!prices || prices.length <= period) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff >= 0) gains += diff; else losses += Math.abs(diff);
  }
  let avgGain = gains / period, avgLoss = losses / period;
  for (let i = period + 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff >= 0) {
      avgGain = (avgGain * (period - 1) + diff) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.abs(diff)) / period;
    }
  }
  const rs = avgGain / (avgLoss === 0 ? 0.001 : avgLoss);
  return 100 - (100 / (1 + rs));
}

function calculateATR(candles, period = 14) {
  if (!candles || candles.length < period + 1) return 0;
  const tr = [];
  for (let i = 1; i < candles.length; i++) {
    tr.push(Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    ));
  }
  return tr.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calculateChoppinessIndex(candles, period = 14) {
  if (!candles || candles.length < period + 1) return 50;
  const sample = candles.slice(-period);
  const highest = Math.max(...sample.map(c => c.high));
  const lowest = Math.min(...sample.map(c => c.low));
  let sumTR = 0;
  for (let i = 1; i < sample.length; i++) {
    sumTR += Math.max(sample[i].high - sample[i].low,
      Math.abs(sample[i].high - sample[i - 1].close),
      Math.abs(sample[i].low - sample[i - 1].close));
  }
  const range = highest - lowest;
  if (range === 0) return 50;
  return Number((100 * (Math.log10(sumTR / range) / Math.log10(period))).toFixed(1));
}

function calculateADX(candles, period = 14) {
  if (!candles || candles.length < period * 2 + 10) return 0;
  const tr = [], pDM = [], mDM = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high, low = candles[i].low;
    const prevClose = candles[i - 1].close, prevHigh = candles[i - 1].high, prevLow = candles[i - 1].low;
    tr.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
    const upMove = high - prevHigh, downMove = prevLow - low;
    pDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    mDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  let smoothTR = tr.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothpDM = pDM.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothmDM = mDM.slice(0, period).reduce((a, b) => a + b, 0);
  const dxList = [];
  for (let i = period; i < tr.length; i++) {
    smoothTR = smoothTR - smoothTR / period + tr[i] / period;
    smoothpDM = smoothpDM - smoothpDM / period + pDM[i] / period;
    smoothmDM = smoothmDM - smoothmDM / period + mDM[i] / period;
    const pDI = (smoothpDM / (smoothTR || 1)) * 100;
    const mDI = (smoothmDM / (smoothTR || 1)) * 100;
    const diDiff = Math.abs(pDI - mDI), diSum = pDI + mDI;
    dxList.push(diSum === 0 ? 0 : (diDiff / diSum) * 100);
  }
  if (dxList.length < period) return 0;
  return Number((dxList.slice(-period).reduce((a, b) => a + b, 0) / period).toFixed(1));
}

function calculateHurstExponent(prices) {
  if (!prices || prices.length < 80) return 0.5;
  const returns = [];
  for (let i = 1; i < prices.length; i++) returns.push(Math.log(prices[i] / prices[i - 1]));
  const sizes = [8, 16, 32, 64].filter(s => s < returns.length / 2);
  if (sizes.length < 2) return 0.5;
  const points = [];
  for (const size of sizes) {
    const rsValues = [];
    for (let i = 0; i + size <= returns.length; i += size) {
      const segment = returns.slice(i, i + size);
      const mean = segment.reduce((a, b) => a + b, 0) / segment.length;
      let cumSum = 0, max = -Infinity, min = Infinity, variance = 0;
      for (const r of segment) {
        cumSum += r - mean; max = Math.max(max, cumSum); min = Math.min(min, cumSum);
        variance += Math.pow(r - mean, 2);
      }
      const sd = Math.sqrt(variance / segment.length);
      if (sd > 0 && max > min) rsValues.push((max - min) / sd);
    }
    if (rsValues.length) points.push([Math.log(size), Math.log(rsValues.reduce((a, b) => a + b, 0) / rsValues.length)]);
  }
  if (points.length < 2) return 0.5;
  const meanX = points.reduce((a, p) => a + p[0], 0) / points.length;
  const meanY = points.reduce((a, p) => a + p[1], 0) / points.length;
  const num = points.reduce((a, p) => a + (p[0] - meanX) * (p[1] - meanY), 0);
  const den = points.reduce((a, p) => a + Math.pow(p[0] - meanX, 2), 0);
  return Number(clamp(den ? num / den : 0.5, 0, 1).toFixed(3));
}

function calculateMACD(closes) {
  if (!closes || closes.length < 35) return { macd: 0, signal: 0, histogram: 0 };
  const e12 = calculateEMASeries(closes, 12), e26 = calculateEMASeries(closes, 26), macdSeries = [];
  for (let i = 0; i < closes.length; i++) if (e12[i] != null && e26[i] != null) macdSeries.push(e12[i] - e26[i]);
  if (macdSeries.length < 9) {
    const line = macdSeries.at(-1) || 0;
    return { macd: line, signal: 0, histogram: line };
  }
  const sig = calculateEMASeries(macdSeries, 9), line = macdSeries.at(-1), signal = sig.at(-1) ?? 0;
  return { macd: line, signal, histogram: line - signal };
}

function calculateVolumeProfilePOC(candles, lookback = 30, binsCount = 20) {
  if (!candles || candles.length < lookback) return null;
  const sample = candles.slice(-lookback);
  const minPrice = Math.min(...sample.map(c => c.low)), maxPrice = Math.max(...sample.map(c => c.high));
  const step = (maxPrice - minPrice) / binsCount;
  if (step === 0) return minPrice;
  const bins = new Array(binsCount).fill(0);
  for (const c of sample) {
    const avgPrice = (c.high + c.low + c.close) / 3;
    const idx = Math.min(Math.floor((avgPrice - minPrice) / step), binsCount - 1);
    bins[idx] += c.volume;
  }
  let maxVolBin = 0, maxVol = 0;
  bins.forEach((vol, idx) => { if (vol > maxVol) { maxVol = vol; maxVolBin = idx; } });
  return Number((minPrice + (maxVolBin + 0.5) * step).toFixed(4));
}

function calculateRelativeVolume(candles, lookback = 20) {
  if (!candles || candles.length < lookback + 1) return 1;
  const current = candles.at(-1).volume;
  const previous = candles.slice(-lookback - 1, -1);
  const avg = previous.reduce((a, c) => a + c.volume, 0) / previous.length;
  return avg === 0 ? 1 : current / avg;
}

function checkSwingBreakOfStructure(candles, lookback = 10) {
  if (!candles || candles.length < lookback + 2) return { bosBullish: false, bosBearish: false };
  const current = candles.at(-1), previous = candles.slice(-lookback - 2, -2);
  const hi = Math.max(...previous.map(c => c.close)), lo = Math.min(...previous.map(c => c.close));
  return { bosBullish: current.close > hi, bosBearish: current.close < lo };
}

function findSwingStop(candles, direction, lookback = 10) {
  if (!candles || candles.length < lookback + 1) return null;
  const sample = candles.slice(-lookback - 1, -1);
  return direction === 'LONG' ? Math.min(...sample.map(c => c.low)) : Math.max(...sample.map(c => c.high));
}

function aggregate(candles, periods) {
  const out = [];
  for (let i = periods - 1; i < candles.length; i += periods) {
    const s = candles.slice(i - periods + 1, i + 1);
    out.push({ time: s[0].time, open: s[0].open, high: Math.max(...s.map(c => c.high)),
      low: Math.min(...s.map(c => c.low)), close: s.at(-1).close, volume: s.reduce((a, c) => a + c.volume, 0) });
  }
  return out;
}

function trend(candles, fast, slow) {
  if (!candles || candles.length < slow) return 'NEUTRAL';
  const closes = candles.map(c => c.close);
  return calculateEMA(closes, fast) > calculateEMA(closes, slow) ? 'BULLISH' : 'BEARISH';
}

module.exports = {
  calculateEMA, calculateEMASeries, calculateRSI, calculateATR, calculateADX,
  calculateHurstExponent, calculateMACD, calculateVWAP, calculateVolumeProfilePOC,
  calculateRelativeVolume, checkSwingBreakOfStructure, calculateChoppinessIndex,
  findSwingStop, aggregate, trend
};
