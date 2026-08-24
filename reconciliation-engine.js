'use strict';

/**
 * Reconciliation Engine – v22.3
 *
 * B3: compare persisted bot state with paper execution state.
 * Any mismatch is fail-closed: new signals must be blocked until resolved.
 */
class ReconciliationEngine {
  constructor({ getBotTrades, executionAdapter, logger = console } = {}) {
    this.getBotTrades = getBotTrades;
    this.executionAdapter = executionAdapter;
    this.logger = logger;
    this.healthy = true;
    this.lastResult = null;
  }

  reconcile() {
    const botTrades = this.getBotTrades ? this.getBotTrades() : new Map();
    const paperPositions = new Map(
      this.executionAdapter.getPositions().map(p => [p.symbol, p])
    );
    const missingInPaper = [];
    const missingInBot = [];
    const mismatched = [];

    for (const [symbol, trade] of botTrades.entries()) {
      const pos = paperPositions.get(symbol);
      if (!pos) {
        missingInPaper.push(symbol);
        continue;
      }
      if (pos.direction !== trade.direction ||
          Math.abs(Number(pos.quantity) - Number(trade.positionSizeUnits || 0)) > 1e-12) {
        mismatched.push({
          symbol,
          bot: { direction: trade.direction, quantity: trade.positionSizeUnits },
          paper: { direction: pos.direction, quantity: pos.quantity }
        });
      }
    }

    for (const [symbol] of paperPositions.entries()) {
      if (!botTrades.has(symbol)) missingInBot.push(symbol);
    }

    const healthy = missingInPaper.length === 0 && missingInBot.length === 0 && mismatched.length === 0;
    this.healthy = healthy;
    this.lastResult = {
      healthy,
      checkedAt: Date.now(),
      botCount: botTrades.size,
      paperCount: paperPositions.size,
      missingInPaper,
      missingInBot,
      mismatched
    };

    if (!healthy) {
      this.logger.error(`[RECONCILIATION] FEHLER – neue Trades werden blockiert: ${JSON.stringify(this.lastResult)}`);
    }
    return this.lastResult;
  }

  isHealthy() {
    return this.healthy;
  }

  getStatus() {
    return this.lastResult || { healthy: this.healthy, checkedAt: null };
  }
}

module.exports = { ReconciliationEngine };
