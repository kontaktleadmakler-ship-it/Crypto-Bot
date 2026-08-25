'use strict';

/**
 * Dynamic time-stop evaluator.
 * Deterministic, bounded and fail-safe: it may extend a normal time-stop,
 * but it can never override the absolute maximum hold or a hard risk stop.
 */
function clamp(v, min = 0, max = 1) {
  return Math.max(min, Math.min(max, Number.isFinite(Number(v)) ? Number(v) : 0));
}
function ema(values, period) {
  if (!Array.isArray(values) || values.length < period) return values?.[values.length - 1] || 0;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}
function rsi(values, period = 14) {
  if (!Array.isArray(values) || values.length <= period) return 50;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d; else loss += -d;
  }
  let ag = gain / period, al = loss / period;
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
  }
  return 100 - 100 / (1 + ag / (al || 0.001));
}
function atr(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 1) return 0;
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
function adx(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period * 2 + 5) return 0;
  const tr = [], pdm = [], mdm = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
    const up = c.high - p.high, down = p.low - c.low;
    pdm.push(up > down && up > 0 ? up : 0);
    mdm.push(down > up && down > 0 ? down : 0);
  }
  let t = tr.slice(0, period).reduce((a,b)=>a+b,0);
  let p = pdm.slice(0, period).reduce((a,b)=>a+b,0);
  let m = mdm.slice(0, period).reduce((a,b)=>a+b,0);
  const dx = [];
  for (let i = period; i < tr.length; i++) {
    t = t - t / period + tr[i] / period;
    p = p - p / period + pdm[i] / period;
    m = m - m / period + mdm[i] / period;
    const pdi = p / (t || 1) * 100, mdi = m / (t || 1) * 100;
    dx.push((pdi + mdi) ? Math.abs(pdi - mdi) / (pdi + mdi) * 100 : 0);
  }
  return dx.length >= period ? dx.slice(-period).reduce((a,b)=>a+b,0) / period : 0;
}

class DynamicTimeStopAgent {
  constructor(options = {}) {
    this.timesFM = options.timesFM || null;
    this.timesFMWeight = Math.max(0, Math.min(0.45, Number(options.timesFMWeight) || 0.30));
    this.maxExtensionHours = Math.max(0.25, Number(options.maxExtensionHours) || 2);
    this.extensionStepHours = Math.max(0.25, Number(options.extensionStepHours) || 1);
    this.minTrendScoreToHold = clamp(options.minTrendScoreToHold ?? 0.56);
  }

  async evaluate({ trade, candles, currentPrice, hoursElapsed, normalMaxHoldHours, absoluteMaxHoldHours }) {
    const prices = (candles || []).map(c => Number(c.close)).filter(Number.isFinite);
    const maxHold = Math.max(0.1, Number(normalMaxHoldHours) || 4);
    const absolute = Math.max(maxHold, Number(absoluteMaxHoldHours) || 24);
    const remainingAbsolute = Math.max(0, absolute - Number(hoursElapsed || 0));

    if (remainingAbsolute <= 0) {
      return { decision: 'EXIT', score: 1, extensionHours: 0, recommendedHoldHours: 0, reasons: ['absolute-time-limit'] };
    }
    if (!trade) {
      return { decision: 'DEFER', score: 0, extensionHours: 0, recommendedHoldHours: Number(hoursElapsed || 0), reasons: ['trade-missing'] };
    }
    if (prices.length < 25) {
      // Missing/insufficient market data is an operational condition, not a
      // bearish signal. Never turn a data outage into a forced time-stop exit.
      return { decision: 'DEFER', score: 0, extensionHours: 0, recommendedHoldHours: Number(hoursElapsed || 0), reasons: ['insufficient-market-data'] };
    }

    const entry = Number(trade.entry);
    const price = Number(currentPrice);
    const direction = trade.direction === 'SHORT' ? -1 : 1;
    const pnlPct = entry > 0 ? ((price - entry) / entry) * 100 * direction : 0;
    const fast = ema(prices, 9);
    const slow = ema(prices, 21);
    const prevFast = ema(prices.slice(0, -3), 9);
    const trendDirection = (fast - slow) * direction;
    const slope = (fast - prevFast) * direction;
    const atrValue = atr(candles, 14);
    const atrPct = price > 0 ? atrValue / price * 100 : 0;
    const momentum = prices.length >= 6 ? ((prices.at(-1) - prices.at(-6)) / prices.at(-6)) * 100 * direction : 0;
    const rsiValue = rsi(prices, 14);
    const trendRsi = direction === 1 ? rsiValue >= 48 && rsiValue <= 72 : rsiValue <= 52 && rsiValue >= 28;
    const strength = clamp(adx(candles, 14) / 40);
    const trend = clamp(0.5
      + (trendDirection > 0 ? 0.18 : -0.18)
      + (slope > 0 ? 0.14 : -0.14)
      + (momentum > 0 ? 0.12 : -0.12)
      + (trendRsi ? 0.08 : -0.08));
    const room = atrPct > 0 ? clamp(Math.abs((entry - price) / price * 100) / (atrPct * 2)) : 0;
    const baseScore = clamp(trend * 0.55 + strength * 0.20 + clamp((pnlPct + 1) / 3) * 0.15 + room * 0.10);
    let timesFM = null;
    if (this.timesFM && typeof this.timesFM.forecast === 'function') {
      try {
        timesFM = await this.timesFM.forecast({
          symbol: trade.symbol,
          direction: trade.direction,
          prices,
          horizon: Math.min(8, Math.max(4, Math.ceil((absolute - Number(hoursElapsed || 0)) * 4)))
        });
      } catch (err) {
        timesFM = { enabled: true, available: false, error: err.message };
      }
    }
    const tfmP50 = Number(timesFM?.p50ReturnPct ?? timesFM?.expectedReturnPct);
    const tfmP10 = Number(timesFM?.p10ReturnPct);
    const tfmP90 = Number(timesFM?.p90ReturnPct);
    const directionalP50 = tfmP50 * direction;
    const directionalP10 = Number.isFinite(tfmP10) ? tfmP10 * direction : directionalP50;
    const directionalP90 = Number.isFinite(tfmP90) ? tfmP90 * direction : directionalP50;
    const tfmBias = timesFM?.available ? clamp((directionalP50 + 0.75) / 1.5) : 0.5;
    const tfmDownsidePenalty = timesFM?.available && Number.isFinite(directionalP10)
      ? clamp(Math.max(0, -directionalP10) / Math.max(0.25, atrPct * 1.5))
      : 0;
    const weight = timesFM?.available ? this.timesFMWeight : 0;
    const score = clamp(baseScore * (1 - weight) + tfmBias * weight - tfmDownsidePenalty * weight * 0.35);

    const reasons = [
      `trend=${trend.toFixed(2)}`,
      `strength=${strength.toFixed(2)}`,
      `momentum=${momentum.toFixed(2)}%`,
      `pnl=${pnlPct.toFixed(2)}%`,
      timesFM?.available ? `timesfm=p50:${tfmP50.toFixed(3)}% p10:${Number.isFinite(tfmP10) ? tfmP10.toFixed(3) : 'n/a'}% p90:${Number.isFinite(tfmP90) ? tfmP90.toFixed(3) : 'n/a'}%` : 'timesfm=unavailable'
    ];

    // Hold a losing trade only when directional evidence is still constructive.
    const forecastSupportsHold = !timesFM?.available || (directionalP50 > -Math.max(0.10, atrPct * 0.50) && directionalP10 > -Math.max(0.75, atrPct * 1.5));
    const shouldExtend = pnlPct < 0
      ? trend >= this.minTrendScoreToHold && strength >= 0.30 && momentum > -Math.max(0.15, atrPct * 0.35) && forecastSupportsHold && score >= this.minTrendScoreToHold
      : trend >= 0.50 && (momentum >= 0 || strength >= 0.35) && forecastSupportsHold;

    if (shouldExtend) {
      const used = Math.max(0, Number(trade.timeStopExtensionUsedHours) || 0);
      const remainingExtensionBudget = Math.max(0, this.maxExtensionHours - used);
      if (remainingExtensionBudget <= 0) {
        return {
          decision: 'EXIT',
          score,
          extensionHours: 0,
          recommendedHoldHours: Number(hoursElapsed || 0),
          reasons: reasons.concat(['dynamic-extension-budget-exhausted']),
          timesFM
        };
      }
      const extension = Math.min(this.extensionStepHours, remainingExtensionBudget, remainingAbsolute);
      const recommended = Math.min(absolute, Number(hoursElapsed || 0) + extension);
      return {
        decision: 'EXTEND',
        score,
        extensionHours: extension,
        recommendedHoldHours: recommended,
        reasons: reasons.concat(['market-structure-still-supports-holding', ...(timesFM?.available ? ['timesfm-forecast-supports-hold'] : [])]),
        timesFM
      };
    }

    return {
      decision: 'EXIT',
      score,
      extensionHours: 0,
      recommendedHoldHours: Number(hoursElapsed || 0),
      reasons: reasons.concat(['time-stop-condition-no-longer-favorable']),
      timesFM
    };
  }
}

module.exports = { DynamicTimeStopAgent };
