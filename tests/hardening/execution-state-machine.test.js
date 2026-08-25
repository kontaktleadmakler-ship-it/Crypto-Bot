import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ExecutionState, ExecutionStateMachine } from '../../execution-core/execution-state-machine.js';

test('execution state machine enters UNKNOWN after submit timeout', () => {
  const sm = new ExecutionStateMachine();
  sm.transition(ExecutionState.RISK_APPROVED);
  sm.transition(ExecutionState.IDEMPOTENCY_RESERVED);
  sm.transition(ExecutionState.ORDER_SUBMITTING);
  sm.transition(ExecutionState.UNKNOWN);
  assert.equal(sm.state, ExecutionState.UNKNOWN);
});

test('UNKNOWN cannot directly be retried', () => {
  const sm = new ExecutionStateMachine({ state: ExecutionState.UNKNOWN });
  assert.throws(() => sm.transition(ExecutionState.ORDER_SUBMITTING));
});

test('UNKNOWN must reconcile before resolution', () => {
  const sm = new ExecutionStateMachine({ state: ExecutionState.UNKNOWN });
  sm.transition(ExecutionState.RECONCILING);
  sm.transition(ExecutionState.FILLED);
  assert.equal(sm.state, ExecutionState.FILLED);
});
