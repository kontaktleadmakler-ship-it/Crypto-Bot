/**
 * v22.7 B11 - Production safety state machine.
 * No live execution is enabled by this state machine.
 */
'use strict';

const EventEmitter = require('events');

const STATES = Object.freeze({
  STARTING: 'STARTING',
  PAPER: 'PAPER',
  SHADOW: 'SHADOW',
  DEGRADED: 'DEGRADED',
  HALTED: 'HALTED'
});

const TRANSITIONS = Object.freeze({
  STARTING: new Set(['PAPER', 'SHADOW', 'HALTED']),
  PAPER: new Set(['SHADOW', 'DEGRADED', 'HALTED']),
  SHADOW: new Set(['PAPER', 'DEGRADED', 'HALTED']),
  DEGRADED: new Set(['PAPER', 'SHADOW', 'HALTED']),
  HALTED: new Set(['STARTING'])
});

class ProductionStateMachine extends EventEmitter {
  constructor({ initial = STATES.STARTING, logger = console } = {}) {
    super();
    if (!Object.values(STATES).includes(initial)) throw new Error(`INVALID_STATE:${initial}`);
    this.state = initial;
    this.logger = logger;
    this.reason = 'initial';
    this.changedAt = Date.now();
  }

  get() {
    return { state: this.state, reason: this.reason, changedAt: this.changedAt };
  }

  canTransition(next) {
    return TRANSITIONS[this.state]?.has(next) || false;
  }

  transition(next, reason = 'unspecified') {
    if (!Object.values(STATES).includes(next)) throw new Error(`INVALID_STATE:${next}`);
    if (!this.canTransition(next)) {
      throw new Error(`INVALID_STATE_TRANSITION:${this.state}->${next}`);
    }
    const previous = this.state;
    this.state = next;
    this.reason = String(reason);
    this.changedAt = Date.now();
    const event = { previous, state: next, reason: this.reason, changedAt: this.changedAt };
    this.logger.info?.(`[STATE] ${previous} -> ${next} | ${this.reason}`);
    this.emit('transition', event);
    return event;
  }

  halt(reason = 'safety-stop') {
    if (this.state === STATES.HALTED) return this.get();
    return this.transition(STATES.HALTED, reason);
  }

  reset() {
    if (this.state !== STATES.HALTED) throw new Error('RESET_REQUIRES_HALTED');
    return this.transition(STATES.STARTING, 'manual-reset');
  }
}

module.exports = { STATES, ProductionStateMachine };
