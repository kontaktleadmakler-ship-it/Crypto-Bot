/**
 * v22.7 B11 - Central kill switch.
 * Idempotent and fail-closed.
 */
'use strict';

const EventEmitter = require('events');

class KillSwitchController extends EventEmitter {
  constructor({ stateMachine, logger = console } = {}) {
    super();
    if (!stateMachine) throw new Error('STATE_MACHINE_REQUIRED');
    this.stateMachine = stateMachine;
    this.logger = logger;
    this.active = false;
    this.reason = null;
    this.activatedAt = null;
  }

  activate(reason = 'manual-kill-switch') {
    if (this.active) return this.status();
    this.active = true;
    this.reason = String(reason);
    this.activatedAt = Date.now();
    try { this.stateMachine.halt(this.reason); } catch (e) {
      this.logger.error?.(`[KILL] state transition failed: ${e.message}`);
    }
    this.logger.error?.(`[KILL SWITCH] AKTIV: ${this.reason}`);
    this.emit('activated', this.status());
    return this.status();
  }

  deactivate() {
    // Deliberately requires the state machine to be reset separately.
    if (!this.active) return this.status();
    this.active = false;
    this.reason = null;
    this.activatedAt = null;
    this.emit('deactivated', this.status());
    return this.status();
  }

  isActive() { return this.active; }

  guard(operation = 'new-signal') {
    if (this.active) throw new Error(`KILL_SWITCH_ACTIVE:${operation}`);
    if (this.stateMachine.state === 'HALTED') throw new Error(`SYSTEM_HALTED:${operation}`);
    return true;
  }

  status() {
    return {
      active: this.active,
      reason: this.reason,
      activatedAt: this.activatedAt,
      state: this.stateMachine.state
    };
  }
}

module.exports = { KillSwitchController };
