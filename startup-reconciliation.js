/**
 * v22.7 B11 - Startup state reconciliation.
 * On uncertainty: fail closed and block new signals.
 */
'use strict';

class StartupReconciliation {
  constructor({ logger = console } = {}) {
    this.logger = logger;
    this.lastResult = null;
  }

  async run({ localState = {}, executionState = {}, compare } = {}) {
    try {
      if (typeof compare !== 'function') throw new Error('RECONCILIATION_COMPARATOR_REQUIRED');
      const result = await compare(localState, executionState);
      const normalized = {
        ok: result === true || result?.ok === true,
        reason: result?.reason || (result === true ? 'consistent' : 'inconsistent'),
        details: result?.details || null,
        ts: Date.now()
      };
      this.lastResult = normalized;
      if (!normalized.ok) {
        this.logger.error?.(`[RECONCILIATION] FAILED: ${normalized.reason}`);
      }
      return normalized;
    } catch (error) {
      const failed = { ok: false, reason: 'reconciliation-error', error: error.message, ts: Date.now() };
      this.lastResult = failed;
      this.logger.error?.(`[RECONCILIATION] ERROR: ${error.message}`);
      return failed;
    }
  }

  isSafe() {
    return this.lastResult?.ok === true;
  }
}

module.exports = { StartupReconciliation };
