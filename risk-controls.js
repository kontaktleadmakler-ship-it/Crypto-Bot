'use strict';
class KillSwitch {
  constructor({ logger = console } = {}) { this.logger = logger; this.active = true; this.reason = 'default-safe-state'; this.changedAt = Date.now(); }
  enable(reason = 'manual') { this.active = true; this.reason = reason; this.changedAt = Date.now(); this.logger.error?.(`[KILL-SWITCH] ENABLED: ${reason}`); }
  disable(reason = 'manual') { this.active = false; this.reason = reason; this.changedAt = Date.now(); this.logger.warn?.(`[KILL-SWITCH] DISABLED: ${reason}`); }
  assertEnabled() { if (this.active) throw new Error(`Kill-switch active: ${this.reason}`); }
  status() { return { active: this.active, reason: this.reason, changedAt: this.changedAt }; }
}
module.exports = { KillSwitch };
