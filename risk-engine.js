'use strict';

/** B6: Central, deterministic portfolio risk gate. Fail-closed on invalid input. */
class RiskEngine {
  constructor({ config = {}, logger = console } = {}) { this.config = config; this.logger = logger; this.killSwitch = false; }
  setKillSwitch(enabled = true, reason = 'manual') { if (typeof enabled === 'string') { reason = enabled; enabled = true; } this.killSwitch = Boolean(enabled); return { enabled: this.killSwitch, reason }; }
  _n(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
  assess({ equity, peakEquity, dailyPnL = 0, openPositions = [], proposed = null } = {}) {
    const eq = this._n(equity); const peak = this._n(peakEquity, eq);
    if (!(eq > 0) || !(peak > 0)) return { allowed: false, reason: 'invalid-equity' };
    if (this.killSwitch) return { allowed: false, reason: 'kill-switch' };
    const drawdown = Math.max(0, (peak - eq) / peak * 100);
    const maxDD = this._n(this.config.MAX_DRAWDOWN_PERCENT, Infinity);
    const dailyLoss = -this._n(dailyPnL);
    const maxDaily = this._n(this.config.MAX_DAILY_LOSS_USD, Infinity);
    if (drawdown >= maxDD) return { allowed: false, reason: 'max-drawdown', drawdownPercent: drawdown };
    if (dailyLoss >= maxDaily) return { allowed: false, reason: 'daily-loss-limit', dailyLossUSD: dailyLoss };
    const exposure = openPositions.reduce((s, p) => s + Math.abs(this._n(p.notionalUSD ?? p.quantity * p.entryPrice)), 0);
    const proposedExposure = proposed ? Math.abs(this._n(proposed.notionalUSD ?? proposed.quantity * proposed.entryPrice)) : 0;
    // MAX_EXPOSURE_RATIO is defined as a fraction of account equity available
    // as margin. Convert gross notional to margin using the configured leverage
    // so this gate has the same semantics as canOpenNewTrade().
    const leverage = Math.max(1, this._n(this.config.LEVERAGE, 1));
    const totalExposure = exposure + proposedExposure;
    const exposureMargin = totalExposure / leverage;
    const maxExposureMargin = eq * this._n(this.config.MAX_EXPOSURE_RATIO, 1);
    if (exposureMargin > maxExposureMargin) {
      return {
        allowed: false,
        reason: 'max-exposure',
        exposureUSD: exposure,
        proposedExposureUSD: proposedExposure,
        totalExposureUSD: totalExposure,
        exposureMarginUSD: exposureMargin,
        maxExposureMarginUSD: maxExposureMargin,
        leverage
      };
    }
    return {
      allowed: true,
      drawdownPercent: drawdown,
      exposureUSD: exposure,
      proposedExposureUSD: proposedExposure,
      totalExposureUSD: totalExposure,
      exposureMarginUSD: exposureMargin,
      maxExposureMarginUSD: maxExposureMargin,
      leverage
    };
  }
  // Legacy compatibility API. The canonical interface is assess().
  evaluate({ equityUSD, peakEquityUSD, dailyPnL = 0, activeTrades = [], notionalUSD = 0, maxExposureRatio, maxDailyLossUSD, maxDrawdownPercent, leverage } = {}) {
    const cfg = { ...this.config };
    if (maxExposureRatio !== undefined) cfg.MAX_EXPOSURE_RATIO = maxExposureRatio;
    if (maxDailyLossUSD !== undefined) cfg.MAX_DAILY_LOSS_USD = maxDailyLossUSD;
    if (maxDrawdownPercent !== undefined) cfg.MAX_DRAWDOWN_PERCENT = maxDrawdownPercent;
    if (leverage !== undefined) cfg.LEVERAGE = leverage;
    const previous = this.config; this.config = cfg;
    try {
      const openPositions = activeTrades.map(t => ({ notionalUSD: t.notionalUSD ?? t.quantity * t.entryPrice }));
      return this.assess({ equity: equityUSD, peakEquity: peakEquityUSD, dailyPnL, openPositions, proposed: { notionalUSD } });
    } finally { this.config = previous; }
  }

}
module.exports = { RiskEngine };
