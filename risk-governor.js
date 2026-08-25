'use strict';

/**
 * Central execution authority. RiskEngine computes trade risk; RiskGovernor
 * owns the global system state and is the final execution gate.
 * State can only escalate automatically. HALT/EMERGENCY require an explicit
 * recovery transition after the underlying condition is cleared.
 */
const STATES = Object.freeze({ NORMAL: 0, REDUCED: 1, HALT: 2, EMERGENCY: 3 });
const NAMES = Object.freeze(['NORMAL', 'REDUCED', 'HALT', 'EMERGENCY']);

class RiskGovernor {
  constructor({ config = {}, logger = console } = {}) {
    this.config = config;
    this.logger = logger;
    this.state = 'NORMAL';
    this.reason = 'startup';
    this.updatedAt = Date.now();
  }
  _n(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
  _cfg(name, fallback) { return this._n(this.config[name], fallback); }
  _rank(s) { return STATES[s] ?? STATES.EMERGENCY; }

  transition(next, reason = 'unspecified', { force = false } = {}) {
    if (!NAMES.includes(next)) throw new Error(`INVALID_RISK_GOVERNOR_STATE:${next}`);
    const current = this._rank(this.state);
    const target = this._rank(next);
    // Automatic recovery is deliberately forbidden. Only an explicit force
    // transition may move HALT/EMERGENCY back toward a safer state.
    if (!force && target < current) return this.snapshot();
    this.state = next;
    this.reason = String(reason);
    this.updatedAt = Date.now();
    this.logger.warn?.(`[RISK-GOVERNOR] ${this.state}: ${this.reason}`);
    return this.snapshot();
  }

  evaluate({ equity, peakEquity, dailyPnL = 0, openPositions = [], proposed = null,
              spreadPct = 0, slippagePct = 0, marketDataAgeMs = 0,
              exchangeLatencyMs = 0, volatilityPct = 0, concentrationPct = 0,
              correlationPct = 0 } = {}) {
    const eq = this._n(equity);
    const peak = this._n(peakEquity, eq);
    if (!(eq > 0) || !(peak > 0)) return this.transition('EMERGENCY', 'INVALID_EQUITY');

    const drawdownPct = Math.max(0, (peak - eq) / peak * 100);
    const dailyLoss = Math.max(0, -this._n(dailyPnL));
    const exposure = openPositions.reduce((s, p) => s + Math.abs(this._n(p.notionalUSD ?? p.quantity * p.entryPrice)), 0);
    const proposedNotional = proposed ? Math.abs(this._n(proposed.notionalUSD ?? proposed.quantity * proposed.entryPrice)) : 0;
    const totalExposure = exposure + proposedNotional;
    const leverage = Math.max(1, this._cfg('LEVERAGE', 1));
    const exposureMargin = totalExposure / leverage;
    const maxExposureRatio = this._cfg('MAX_EXPOSURE_RATIO', 0.6);
    const exposureRatio = exposureMargin / eq;

    const hard = [];
    const reduced = [];
    const maxDD = this._cfg('MAX_DRAWDOWN_PERCENT', 25);
    const maxDailyLoss = this._cfg('MAX_DAILY_LOSS_USD', 250);
    const maxSpread = this._cfg('RISK_GOVERNOR_MAX_SPREAD_PCT', this._cfg('MAX_SPREAD_PERCENT', 0.15));
    const maxSlippage = this._cfg('RISK_GOVERNOR_MAX_SLIPPAGE_PCT', this._cfg('SLIPPAGE_PERCENT', 0.10) * 2);
    const maxMdAge = this._cfg('RISK_GOVERNOR_MAX_MARKET_DATA_AGE_MS', 5000);
    const maxExchangeLatency = this._cfg('RISK_GOVERNOR_MAX_EXCHANGE_LATENCY_MS', 3000);
    const maxPosition = this._cfg('RISK_GOVERNOR_MAX_POSITION_NOTIONAL_USD', Infinity);
    const maxOrder = this._cfg('RISK_GOVERNOR_MAX_ORDER_NOTIONAL_USD', Infinity);
    const maxVol = this._cfg('RISK_GOVERNOR_MAX_VOLATILITY_PCT', Infinity);
    const maxConcentration = this._cfg('RISK_GOVERNOR_MAX_CONCENTRATION_PCT', 60);
    const maxCorrelation = this._cfg('RISK_GOVERNOR_MAX_CORRELATION_PCT', 90);

    if (drawdownPct >= maxDD) hard.push(`MAX_DRAWDOWN:${drawdownPct.toFixed(2)}`);
    if (dailyLoss >= maxDailyLoss) hard.push(`MAX_DAILY_LOSS:${dailyLoss.toFixed(2)}`);
    if (exposureRatio > maxExposureRatio) hard.push('MAX_NOTIONAL_EXPOSURE');
    if (proposedNotional > maxOrder) hard.push('MAX_ORDER_SIZE');
    if (proposedNotional > maxPosition) hard.push('MAX_POSITION_SIZE');
    if (Number.isFinite(spreadPct) && spreadPct > maxSpread) hard.push('SPREAD_TOO_WIDE');
    if (Number.isFinite(slippagePct) && slippagePct > maxSlippage) hard.push('SLIPPAGE_TOO_HIGH');
    if (Number.isFinite(marketDataAgeMs) && marketDataAgeMs > maxMdAge) hard.push('MARKET_DATA_STALE');
    if (Number.isFinite(exchangeLatencyMs) && exchangeLatencyMs > maxExchangeLatency) hard.push('EXCHANGE_LATENCY');
    if (Number.isFinite(volatilityPct) && volatilityPct > maxVol) hard.push('VOLATILITY_REGIME');
    if (Number.isFinite(concentrationPct) && concentrationPct > maxConcentration) hard.push('CONCENTRATION_LIMIT');
    if (Number.isFinite(correlationPct) && correlationPct > maxCorrelation) hard.push('CORRELATION_LIMIT');

    // Catastrophic conditions jump directly to EMERGENCY.
    if (drawdownPct >= maxDD * this._cfg('RISK_GOVERNOR_EMERGENCY_DD_MULTIPLIER', 1.25) ||
        dailyLoss >= maxDailyLoss * this._cfg('RISK_GOVERNOR_EMERGENCY_DAILY_LOSS_MULTIPLIER', 1.25)) {
      return this.transition('EMERGENCY', 'CATASTROPHIC_LOSS_LIMIT');
    }
    if (hard.length) return this.transition('HALT', hard.join(','));

    const ddReduced = maxDD * this._cfg('RISK_GOVERNOR_REDUCED_DD_RATIO', 0.75);
    const dailyReduced = maxDailyLoss * this._cfg('RISK_GOVERNOR_REDUCED_DAILY_LOSS_RATIO', 0.75);
    const exposureReduced = maxExposureRatio * this._cfg('RISK_GOVERNOR_REDUCED_EXPOSURE_RATIO', 0.85);
    if (drawdownPct >= ddReduced || dailyLoss >= dailyReduced || exposureRatio >= exposureReduced ||
        (Number.isFinite(spreadPct) && spreadPct > maxSpread * 0.75) ||
        (Number.isFinite(volatilityPct) && volatilityPct > maxVol * 0.75)) {
      return this.transition('REDUCED', 'RISK_HEADROOM_LOW');
    }

    if (this.state === 'NORMAL') return this.transition('NORMAL', 'RISK_WITHIN_LIMITS', { force: true });
    // REDUCED/HALT/EMERGENCY never self-recover. An explicit operator/recovery
    // workflow must clear the state after the underlying condition is verified.
    return this.snapshot();
  }

  assertExecutionAllowed({ action = 'OPEN', proposed = null, reducedSize = false } = {}) {
    const a = String(action).toUpperCase();
    if (this.state === 'EMERGENCY') {
      if (a === 'CLOSE' || a === 'REDUCE') return true;
      throw new Error(`RISK_GOVERNOR_EMERGENCY:${this.reason}`);
    }
    if (this.state === 'HALT') {
      if (a === 'CLOSE' || a === 'REDUCE') return true;
      throw new Error(`RISK_GOVERNOR_HALT:${this.reason}`);
    }
    if (this.state === 'REDUCED' && a === 'OPEN' && !reducedSize) {
      throw new Error(`RISK_GOVERNOR_REDUCED:${this.reason}`);
    }
    if (!['OPEN', 'REDUCE', 'CLOSE'].includes(a)) throw new Error(`RISK_GOVERNOR_INVALID_ACTION:${a}`);
    return true;
  }

  recoverToNormal(reason = 'operator-approved-recovery') {
    if (this.state === 'NORMAL') return this.snapshot();
    return this.transition('NORMAL', reason, { force: true });
  }
  snapshot() { return { state: this.state, reason: this.reason, updatedAt: this.updatedAt }; }
}

module.exports = { RiskGovernor, STATES };
