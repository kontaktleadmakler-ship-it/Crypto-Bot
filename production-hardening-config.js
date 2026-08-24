/**
 * v22.7 B11 configuration.
 */
'use strict';

module.exports = {
  tradingMode: String(process.env.TRADING_MODE || 'PAPER').toUpperCase(),
  requireStartupReconciliation:
    String(process.env.REQUIRE_STARTUP_RECONCILIATION || 'true').toLowerCase() !== 'false',
  requireReadinessGates:
    String(process.env.REQUIRE_READINESS_GATES || 'true').toLowerCase() !== 'false',
  auditTrailFile: process.env.AUDIT_TRAIL_FILE || './data/audit/audit.jsonl',
  failClosed: true
};
