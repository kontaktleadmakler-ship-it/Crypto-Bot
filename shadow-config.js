/**
 * v22.6 B10 configuration. Shadow is OFF by default.
 */
'use strict';

module.exports = {
  mode: String(process.env.TRADING_MODE || 'PAPER').toUpperCase(),
  shadowEnabled: String(process.env.SHADOW_TRADING_ENABLED || 'false').toLowerCase() === 'true',
  haltOnRiskFailure: String(process.env.SHADOW_HALT_ON_RISK_FAILURE || 'true').toLowerCase() !== 'false',
  journalFile: process.env.SHADOW_JOURNAL_FILE || './data/shadow/shadow-trades.jsonl'
};
