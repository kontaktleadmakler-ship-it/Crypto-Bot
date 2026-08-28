'use strict';

/**
 * Persistent-friendly execution state machine.
 * UNKNOWN is terminal until reconciliation resolves it.
 */
export const ExecutionState = Object.freeze({
  INTENT_CREATED: 'INTENT_CREATED',
  RISK_APPROVED: 'RISK_APPROVED',
  IDEMPOTENCY_RESERVED: 'IDEMPOTENCY_RESERVED',
  ORDER_SUBMITTING: 'ORDER_SUBMITTING',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  PARTIALLY_FILLED: 'PARTIALLY_FILLED',
  FILLED: 'FILLED',
  CANCEL_PENDING: 'CANCEL_PENDING',
  CANCELLED: 'CANCELLED',
  REJECTED: 'REJECTED',
  UNKNOWN: 'UNKNOWN',
  RECONCILING: 'RECONCILING',
  FAILED: 'FAILED'
});

const transitions = {
  INTENT_CREATED: new Set(['RISK_APPROVED', 'FAILED']),
  RISK_APPROVED: new Set(['IDEMPOTENCY_RESERVED', 'FAILED']),
  IDEMPOTENCY_RESERVED: new Set(['ORDER_SUBMITTING', 'FAILED']),
  ORDER_SUBMITTING: new Set(['ACKNOWLEDGED', 'PARTIALLY_FILLED', 'FILLED', 'REJECTED', 'UNKNOWN']),
  ACKNOWLEDGED: new Set(['PARTIALLY_FILLED', 'FILLED', 'CANCEL_PENDING', 'CANCELLED', 'UNKNOWN']),
  PARTIALLY_FILLED: new Set(['PARTIALLY_FILLED', 'FILLED', 'CANCEL_PENDING', 'CANCELLED', 'UNKNOWN']),
  FILLED: new Set([]),
  CANCEL_PENDING: new Set(['CANCELLED', 'PARTIALLY_FILLED', 'FILLED', 'UNKNOWN']),
  CANCELLED: new Set([]),
  REJECTED: new Set([]),
  UNKNOWN: new Set(['RECONCILING']),
  RECONCILING: new Set(['ACKNOWLEDGED', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'REJECTED', 'FAILED']),
  FAILED: new Set([])
};

export class ExecutionStateMachine {
  constructor({ state = ExecutionState.INTENT_CREATED, version = 0 } = {}) {
    if (!transitions[state]) throw new Error(`INVALID_EXECUTION_STATE:${state}`);
    this.state = state;
    this.version = version;
  }

  canTransition(next) {
    return transitions[this.state]?.has(next) === true;
  }

  transition(next) {
    if (!this.canTransition(next)) {
      throw new Error(`INVALID_EXECUTION_TRANSITION:${this.state}->${next}`);
    }
    this.state = next;
    this.version += 1;
    return { state: this.state, version: this.version };
  }

  snapshot() {
    return { state: this.state, version: this.version };
  }
}

export default ExecutionStateMachine;
