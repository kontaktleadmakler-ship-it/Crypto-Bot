'use strict';

/**
 * Explicit final gate for real-money execution.
 * It is impossible to become live merely by setting DRY_RUN=false; the
 * independent readiness result and an explicit LIVE_TRADING_ENABLED flag are
 * both required.
 */
class LiveExecutionGate {
  constructor({ enabled = false, readinessProvider = () => ({ ready: false }) } = {}) {
    this.enabled = Boolean(enabled);
    this.readinessProvider = readinessProvider;
  }
  status() {
    const readiness = this.readinessProvider() || { ready: false };
    return { enabled: this.enabled, readiness, allowed: this.enabled && readiness.ready === true };
  }
  assertAllowed() {
    const s = this.status();
    if (!s.enabled) throw new Error('LIVE_EXECUTION_DISABLED');
    if (!s.readiness.ready) throw new Error(`LIVE_EXECUTION_BLOCKED:${(s.readiness.failed || []).join(',') || 'READINESS_GATE'}`);
    return true;
  }
}
module.exports = { LiveExecutionGate };
