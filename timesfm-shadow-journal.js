'use strict';
const fs = require('fs');
const path = require('path');

class TimesFMShadowJournal {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.file = options.file || process.env.TIMESFM_SHADOW_JOURNAL_FILE || './data/shadow/timesfm-decisions.jsonl';
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); } catch (_) {}
  }

  append(event) {
    const payload = { schemaVersion: 1, ts: Date.now(), ...event };
    try { fs.appendFileSync(this.file, JSON.stringify(payload) + '\n', 'utf8'); } catch (err) { this.logger.debug?.(`[TimesFM Shadow] write failed: ${err.message}`); }
  }

  recordDecision(symbol, trade, currentPrice, decision) {
    const tfm = decision?.timesFM || {};
    this.append({
      type: 'time-stop-decision', symbol, direction: trade.direction,
      tradeStartedAt: trade.startTime || null, decision: decision.decision,
      price: Number(currentPrice), pnlPct: trade.entry > 0 ? ((Number(currentPrice) - Number(trade.entry)) / Number(trade.entry) * 100 * (trade.direction === 'SHORT' ? -1 : 1)) : null,
      score: decision.score, extensionHours: decision.extensionHours,
      timesFM: tfm.available ? {
        expectedReturnPct: tfm.expectedReturnPct, p10ReturnPct: tfm.p10ReturnPct,
        p50ReturnPct: tfm.p50ReturnPct, p90ReturnPct: tfm.p90ReturnPct,
        horizon: tfm.horizon, model: tfm.model
      } : { available: false, error: tfm.error || null }
    });
  }

  recordClose(symbol, trade, exitPrice, pnlUSD) {
    const decisions = Array.isArray(trade.timeStopDecisionHistory) ? trade.timeStopDecisionHistory : [];
    const direction = trade.direction === 'SHORT' ? -1 : 1;
    const entry = Number(trade.entry);
    for (const d of decisions) {
      const decisionPrice = Number(d.decisionPrice);
      const actualReturnPct = decisionPrice > 0 ? ((Number(exitPrice) - decisionPrice) / decisionPrice) * 100 * direction : null;
      this.append({
        type: 'time-stop-outcome', symbol, direction: trade.direction,
        decisionAt: d.at, decision: d.decision, decisionPrice,
        closeTime: Date.now(), exitPrice: Number(exitPrice), pnlUSD: Number(pnlUSD),
        actualReturnPct, hoursAfterDecision: d.at ? (Date.now() - d.at) / 3600000 : null,
        timesFM: d.timesFM || null
      });
    }
  }
}

module.exports = { TimesFMShadowJournal };
