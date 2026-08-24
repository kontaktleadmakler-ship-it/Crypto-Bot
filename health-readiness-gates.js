/**
 * v22.7 B11 - Safety health/readiness gates.
 * Fail closed: missing/unknown critical checks are not ready.
 */
'use strict';

class HealthReadinessGates {
  constructor({ logger = console } = {}) {
    this.logger = logger;
    this.checks = new Map();
  }

  set(name, ok, details = null) {
    this.checks.set(String(name), { ok: Boolean(ok), details, ts: Date.now() });
  }

  snapshot() {
    const result = {};
    for (const [name, value] of this.checks) result[name] = value;
    return result;
  }

  evaluate(required = []) {
    const failures = [];
    for (const name of required) {
      const item = this.checks.get(name);
      if (!item || !item.ok) failures.push({ name, value: item || null });
    }
    return {
      ready: failures.length === 0,
      failures,
      checks: this.snapshot()
    };
  }

  assertReady(required = []) {
    const result = this.evaluate(required);
    if (!result.ready) {
      const err = new Error('READINESS_GATE_FAILED');
      err.failures = result.failures;
      throw err;
    }
    return true;
  }
}

module.exports = { HealthReadinessGates };
