'use strict';

/** Canonical portfolio risk facade for the signal/paper runtime. */
const STATES = Object.freeze({ NORMAL: 0, REDUCED: 1, HALT: 2, EMERGENCY: 3 });
const NAMES = Object.freeze(['NORMAL', 'REDUCED', 'HALT', 'EMERGENCY']);

class RiskEngine {
  constructor({ config = {}, logger = console } = {}) {
    this.config = config; this.logger = logger; this.killSwitch = false; this.killReason = null;
    this.state = 'NORMAL'; this.reason = 'startup'; this.updatedAt = Date.now();
  }
  _n(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
  _cfg(name, fallback) { return this._n(this.config[name], fallback); }
  _rank(s) { return STATES[s] ?? STATES.EMERGENCY; }
  setKillSwitch(enabled = true, reason = 'manual') {
    if (typeof enabled === 'string') { reason = enabled; enabled = true; }
    this.killSwitch = Boolean(enabled); this.killReason = this.killSwitch ? String(reason) : null;
    if (this.killSwitch) this.transition('EMERGENCY', reason, { force: true });
    return this.snapshot();
  }
  clearKillSwitch(reason = 'operator-approved-recovery') {
    this.killSwitch = false; this.killReason = null; return this.recoverToNormal(reason);
  }
  transition(next, reason = 'unspecified', { force = false } = {}) {
    if (!NAMES.includes(next)) throw new Error(`INVALID_RISK_STATE:${next}`);
    const current = this._rank(this.state), target = this._rank(next);
    if (!force && target < current) return this.snapshot();
    this.state = next; this.reason = String(reason); this.updatedAt = Date.now();
    if (next !== 'NORMAL') this.logger.warn?.(`[RISK-ENGINE] ${next}: ${this.reason}`);
    return this.snapshot();
  }
  assess({
    equity, peakEquity, dailyPnL = 0, weeklyPnL = 0, openPositions = [], direction = null,
    consecutiveLosses = 0, proposed = null, spreadPct = null, slippagePct = null,
    marketDataAgeMs = null, exchangeLatencyMs = null, volatilityPct = null,
    concentrationPct = null, correlationPct = null
  } = {}) {
    const eq = this._n(equity), peak = this._n(peakEquity, eq);
    if (!(eq > 0) || !(peak > 0)) return this.transition('EMERGENCY', 'invalid-equity');
    if (this.killSwitch) return { ...this.snapshot(), allowed: false, reason: `kill-switch:${this.killReason || 'manual'}` };

    const drawdown = Math.max(0, (peak - eq) / peak * 100);
    const dailyLoss = Math.max(0, -this._n(dailyPnL));
    const weeklyLoss = Math.max(0, -this._n(weeklyPnL));
    const maxDD = this._cfg('MAX_DRAWDOWN_PERCENT', Infinity);
    const maxDaily = this._cfg('MAX_DAILY_LOSS_USD', Infinity);
    const maxWeekly = this._cfg('MAX_WEEKLY_DRAWDOWN_PERCENT', Infinity);
    const maxConcurrent = this._cfg('MAX_CONCURRENT_TRADES', Infinity);
    const maxSame = this._cfg('MAX_SAME_DIRECTION', Infinity);
    const maxConsecutive = this._cfg('MAX_CONSECUTIVE_LOSSES', Infinity);
    const leverage = Math.max(1, this._n(this.config.LEVERAGE, 1));
    const exposure = openPositions.reduce((sum, p) => sum + Math.abs(this._n(p.notionalUSD ?? p.quantity * p.entryPrice)), 0);
    const proposedExposure = proposed ? Math.abs(this._n(proposed.notionalUSD ?? proposed.quantity * proposed.entryPrice)) : 0;
    const totalExposure = exposure + proposedExposure;
    const exposureMargin = totalExposure / leverage;
    const maxExposureMargin = eq * this._cfg('MAX_EXPOSURE_RATIO', 1);
    const sameDirection = direction ? openPositions.filter(p => String(p.direction).toUpperCase() === String(direction).toUpperCase()).length : 0;
    const hard = [];

    if (drawdown >= maxDD) hard.push('max-drawdown');
    if (dailyLoss >= maxDaily) hard.push('daily-loss-limit');
    if (maxWeekly < Infinity && weeklyLoss >= this._cfg('CAPITAL_USD', eq) * (maxWeekly / 100)) hard.push('max-weekly-drawdown');
    if (openPositions.length >= maxConcurrent) hard.push('max-concurrent-trades');
    if (direction && sameDirection >= maxSame) hard.push('max-same-direction');
    if (maxConsecutive > 0 && consecutiveLosses >= maxConsecutive) hard.push('max-consecutive-losses');
    if (exposureMargin > maxExposureMargin) hard.push('max-exposure');

    const maxSpread = this._cfg('RISK_GOVERNOR_MAX_SPREAD_PCT', this._cfg('MAX_SPREAD_PERCENT', Infinity));
    const maxSlippage = this._cfg('RISK_GOVERNOR_MAX_SLIPPAGE_PCT', this._cfg('SLIPPAGE_PERCENT', Infinity) * 2);
    const maxMdAge = this._cfg('RISK_GOVERNOR_MAX_MARKET_DATA_AGE_MS', Infinity);
    const maxLatency = this._cfg('RISK_GOVERNOR_MAX_EXCHANGE_LATENCY_MS', Infinity);
    const maxVol = this._cfg('RISK_GOVERNOR_MAX_VOLATILITY_PCT', Infinity);
    const maxConcentration = this._cfg('RISK_GOVERNOR_MAX_CONCENTRATION_PCT', Infinity);
    const maxCorrelation = this._cfg('RISK_GOVERNOR_MAX_CORRELATION_PCT', Infinity);
    if (Number.isFinite(spreadPct) && spreadPct > maxSpread) hard.push('spread-too-wide');
    if (Number.isFinite(slippagePct) && slippagePct > maxSlippage) hard.push('slippage-too-high');
    if (Number.isFinite(marketDataAgeMs) && marketDataAgeMs > maxMdAge) hard.push('market-data-stale');
    if (Number.isFinite(exchangeLatencyMs) && exchangeLatencyMs > maxLatency) hard.push('exchange-latency');
    if (Number.isFinite(volatilityPct) && volatilityPct > maxVol) hard.push('volatility-regime');
    if (Number.isFinite(concentrationPct) && concentrationPct > maxConcentration) hard.push('concentration-limit');
    if (Number.isFinite(correlationPct) && correlationPct > maxCorrelation) hard.push('correlation-limit');

    const catastrophic = drawdown >= maxDD * this._cfg('RISK_GOVERNOR_EMERGENCY_DD_MULTIPLIER', 1.25) ||
      dailyLoss >= maxDaily * this._cfg('RISK_GOVERNOR_EMERGENCY_DAILY_LOSS_MULTIPLIER', 1.25);
    const globalHard = hard.filter(r => ['max-drawdown','daily-loss-limit','max-weekly-drawdown','max-consecutive-losses'].includes(r));
    if (catastrophic) this.transition('EMERGENCY', 'catastrophic-loss-limit');
    else if (globalHard.length) this.transition('HALT', globalHard.join(','));
    else {
      const reduced = drawdown >= maxDD * this._cfg('RISK_GOVERNOR_REDUCED_DD_RATIO', 0.75) ||
        dailyLoss >= maxDaily * this._cfg('RISK_GOVERNOR_REDUCED_DAILY_LOSS_RATIO', 0.75) ||
        (maxExposureMargin > 0 && exposureMargin / maxExposureMargin >= this._cfg('RISK_GOVERNOR_REDUCED_EXPOSURE_RATIO', 0.85));
      if (reduced) this.transition('REDUCED', 'risk-headroom-low');
      else if (this.state === 'NORMAL') this.transition('NORMAL', 'risk-within-limits', { force: true });
    }
    const stateAllows = this.state === 'NORMAL' || this.state === 'REDUCED';
    const allowed = stateAllows && hard.length === 0;
    return {
      allowed, state: this.state, level: this.state,
      reason: allowed ? null : (hard[0] || this.reason), drawdownPercent: drawdown,
      dailyLossUSD: dailyLoss, weeklyLossUSD: weeklyLoss, exposureUSD: exposure,
      proposedExposureUSD: proposedExposure, totalExposureUSD: totalExposure,
      exposureMarginUSD: exposureMargin, maxExposureMarginUSD: maxExposureMargin,
      sameDirection, concurrentTrades: openPositions.length, consecutiveLosses, leverage
    };
  }
  assertExecutionAllowed({ action = 'OPEN', proposed = null, reducedSize = false } = {}) {
    const a = String(action).toUpperCase();
    if (!['OPEN', 'REDUCE', 'CLOSE'].includes(a)) throw new Error(`RISK_ENGINE_INVALID_ACTION:${a}`);
    if (this.state === 'EMERGENCY' || this.state === 'HALT') {
      if (a === 'CLOSE' || a === 'REDUCE') return true;
      throw new Error(`RISK_ENGINE_${this.state}:${this.reason}`);
    }
    if (this.state === 'REDUCED' && a === 'OPEN' && !reducedSize) throw new Error(`RISK_ENGINE_REDUCED:${this.reason}`);
    return true;
  }
  recoverToNormal(reason = 'operator-approved-recovery') { return this.transition('NORMAL', reason, { force: true }); }
  snapshot() { return { state: this.state, reason: this.reason, updatedAt: this.updatedAt, killSwitch: this.killSwitch, killReason: this.killReason }; }
  evaluate({ equityUSD, peakEquityUSD, dailyPnL = 0, activeTrades = [], notionalUSD = 0, maxExposureRatio, maxDailyLossUSD, maxDrawdownPercent, leverage } = {}) {
    const cfg = { ...this.config };
    if (maxExposureRatio !== undefined) cfg.MAX_EXPOSURE_RATIO = maxExposureRatio;
    if (maxDailyLossUSD !== undefined) cfg.MAX_DAILY_LOSS_USD = maxDailyLossUSD;
    if (maxDrawdownPercent !== undefined) cfg.MAX_DRAWDOWN_PERCENT = maxDrawdownPercent;
    if (leverage !== undefined) cfg.LEVERAGE = leverage;
    const previous = this.config; this.config = cfg;
    try { return this.assess({ equity: equityUSD, peakEquity: peakEquityUSD, dailyPnL, openPositions: activeTrades, proposed: { notionalUSD } }); }
    finally { this.config = previous; }
  }
}
module.exports = { RiskEngine, STATES };
