'use strict';

/** B5: Single source of truth for execution economics used by paper/research layers. */
class ExecutionParity {
  constructor({ config = {}, simulator = null } = {}) {
    this.config = config;
    this.simulator = simulator;
  }
  fee(notionalUSD, liquidity = 'taker') {
    const pct = liquidity === 'maker'
      ? Number(this.config.PAPER_MAKER_FEE_PERCENT ?? this.config.FEE_PERCENT ?? 0)
      : Number(this.config.PAPER_TAKER_FEE_PERCENT ?? this.config.FEE_PERCENT ?? 0);
    return Math.abs(Number(notionalUSD) || 0) * Math.max(0, pct) / 100;
  }
  fill({ side, referencePrice, quantity, orderBook = null, liquidity = 'taker' }) {
    if (!this.simulator) throw new Error('EXECUTION_PARITY_REQUIRES_SIMULATOR');
    const fill = this.simulator.simulateMarketOrder({
      direction: String(side).toUpperCase() === 'SELL' ? 'SHORT' : 'LONG',
      referencePrice, quantity, orderBook, liquidity
    });
    return { ...fill, feeUSD: this.fee(fill.notionalUSD, liquidity) };
  }
  tradePnl({ direction, entryPrice, exitPrice, quantity, entryFee = 0, exitFee = 0, fundingUSD = 0 }) {
    const d = String(direction).toUpperCase();
    const gross = d === 'SHORT'
      ? (Number(entryPrice) - Number(exitPrice)) * Number(quantity)
      : (Number(exitPrice) - Number(entryPrice)) * Number(quantity);
    return { grossPnLUSD: gross, feesUSD: Number(entryFee) + Number(exitFee), fundingUSD: Number(fundingUSD), netPnLUSD: gross - Number(entryFee) - Number(exitFee) - Number(fundingUSD) };
  }
  compare(a, b, tolerance = 1e-8) {
    const keys = ['grossPnLUSD', 'feesUSD', 'fundingUSD', 'netPnLUSD'];
    return { equal: keys.every(k => Math.abs(Number(a?.[k] || 0) - Number(b?.[k] || 0)) <= tolerance), differences: Object.fromEntries(keys.map(k => [k, Number(a?.[k] || 0) - Number(b?.[k] || 0)])) };
  }
}
module.exports = { ExecutionParity };
