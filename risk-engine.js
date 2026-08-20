'use strict';

class RiskEngine {
  constructor(config, logger = console) {
    this.config = config;
    this.logger = logger;
    this.killSwitch = false;
    this.killReason = null;
  }

  setKillSwitch(reason) { this.killSwitch = true; this.killReason = reason || 'manual'; }
  isKilled() { return this.killSwitch; }
  clearKillSwitch() { this.killSwitch = false; this.killReason = null; }

  positionSize({ equityUSD, riskPercent, entryPrice, stopLossPrice }) {
    const equity = Number(equityUSD);
    const riskPct = Number(riskPercent);
    const entry = Number(entryPrice);
    const stop = Number(stopLossPrice);
    if (![equity, riskPct, entry, stop].every(Number.isFinite) || equity <= 0 || riskPct <= 0 || entry <= 0) {
      throw new Error('Invalid risk sizing inputs');
    }
    const stopDistance = Math.abs(entry - stop);
    if (!(stopDistance > 0)) throw new Error('Stop distance must be > 0');
    const riskUSD = equity * riskPct / 100;
    const units = riskUSD / stopDistance;
    const notionalUSD = units * entry;
    return { riskUSD, units, notionalUSD, stopDistance, stopPct: stopDistance / entry };
  }

  evaluate({ equityUSD, dailyPnL, peakEquityUSD, activeTrades = [], direction, notionalUSD = 0, maxConcurrent, maxSameDirection, maxExposureRatio, maxDailyLossUSD, maxDrawdownPercent, leverage = 1 }) {
    if (this.killSwitch) return { allowed: false, reason: 'kill-switch:' + this.killReason };
    if (!Number.isFinite(equityUSD) || equityUSD <= 0) return { allowed: false, reason: 'invalid-equity' };
    if (dailyPnL <= -Math.abs(maxDailyLossUSD)) return { allowed: false, reason: 'daily-loss-limit' };
    const dd = peakEquityUSD > 0 ? (peakEquityUSD - equityUSD) / peakEquityUSD * 100 : 0;
    if (dd >= maxDrawdownPercent) return { allowed: false, reason: 'max-drawdown' };
    if (activeTrades.length >= maxConcurrent) return { allowed: false, reason: 'max-concurrent-trades' };
    if (direction) {
      const same = activeTrades.filter(t => t.direction === direction).length;
      if (same >= maxSameDirection) return { allowed: false, reason: 'max-same-direction' };
    }
    const currentNotional = activeTrades.reduce((s, t) => s + Math.abs(Number(t.notionalUSD) || 0), 0);
    const effectiveLeverage = Number.isFinite(Number(leverage)) && Number(leverage) > 0 ? Number(leverage) : 1;
    const currentMargin = currentNotional / effectiveLeverage;
    const newMargin = Math.abs(notionalUSD) / effectiveLeverage;
    const maxMargin = equityUSD * maxExposureRatio;
    if (currentMargin + newMargin > maxMargin) return { allowed: false, reason: 'max-exposure' };
    return { allowed: true, reason: null, drawdownPercent: dd };
  }
}
module.exports = { RiskEngine };
