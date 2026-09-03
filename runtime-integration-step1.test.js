// NOTE: this root-level copy is a stale duplicate of
// tests/hardening/runtime-integration-step1.test.js. Its relative imports
// (`../../execution-core/...`) assume a location two directories deep (like
// tests/hardening/), so from the repo root they resolve outside the repo and
// this file cannot run standalone (confirmed pre-existing: same
// ERR_MODULE_NOT_FOUND occurs regardless of which runtime .mjs is
// referenced below). It is not picked up by `npm test`
// (scripts/run-all-tests.js only scans tests/*.test.js, non-recursively) and
// is not the canonical suite entry - that is
// tests/hardening/runtime-integration-step1.test.js, which passes (5/5).
// Left un-executed here rather than "fixed" to run standalone, since
// deduplicating/relocating stray root files is outside this task's scope
// (aligning the runtime import target).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { protectedSubmit } from '../../execution-core/protected-submit.mjs';
import { CriticalStateQueue } from '../../execution-core/critical-state-queue.mjs';
import { ExecutionState, ExecutionStateMachine } from '../../execution-core/execution-state-machine.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtime = fs.readFileSync(path.join(here, '../../trading-bot-v25-marketdata-fixed.mjs'), 'utf8');

test('runtime routes paper opening execution through protectedSubmit', () => {
  assert.match(runtime, /protectedSubmit\(/);
  assert.match(runtime, /executePaperExecutionThroughCore/);
  assert.doesNotMatch(
    runtime.replace(/submitter:\s*async[\s\S]*?\n\s*logger\n\s*\}\);/, ''),
    /paperExecutionAdapter\.submitMarketOrder\(/
  );
});

test('critical state queue fails closed when DB is unhealthy', async () => {
  const queue = new CriticalStateQueue({ isHealthy: () => false });
  await assert.rejects(
    queue.enqueue(async () => undefined),
    /CRITICAL_STATE_DB_UNHEALTHY/
  );
});

test('protected submit enforces pre-trade gate before reservation', async () => {
  let reserved = false;
  await assert.rejects(
    protectedSubmit({
      symbol: 'BTC-USDT',
      side: 'BUY',
      clientOrderId: 'test-gate-1',
      payload: {},
      riskContext: {
        dbHealthy: false,
        instanceLeaseValid: true,
        marketDataHealthy: true,
        reconciliationHealthy: true,
        killSwitch: false
      },
      orderBookValid: true,
      spreadPct: 0.1,
      marketDataAgeMs: 10,
      reserveExecutionIntent: async () => { reserved = true; },
      transitionExecution: async () => {},
      submitter: async () => ({ status: 'FILLED' })
    }),
    /PRETRADE_DB_UNHEALTHY/
  );
  assert.equal(reserved, false);
});

test('protected submit follows state pipeline and never retries ambiguous submit', async () => {
  const states = [];
  const sm = new ExecutionStateMachine();
  const reservation = { executionId: 'exec-1', sm };
  let submits = 0;

  const result = await protectedSubmit({
    symbol: 'BTC-USDT',
    side: 'BUY',
    clientOrderId: 'exec-1',
    payload: {},
    riskContext: {
      dbHealthy: true,
      instanceLeaseValid: true,
      marketDataHealthy: true,
      reconciliationHealthy: true,
      killSwitch: false,
      risk: { allowed: true, reason: 'OK' }
    },
    orderBookValid: true,
    spreadPct: 0.1,
    marketDataAgeMs: 10,
    reserveExecutionIntent: async () => reservation,
    transitionExecution: async ({ next }) => {
      sm.transition(next);
      states.push(next);
    },
    submitter: async () => {
      submits++;
      return { status: 'FILLED', orderId: 'paper-1' };
    }
  });

  assert.equal(result.state, ExecutionState.FILLED);
  assert.equal(submits, 1);
  assert.deepEqual(states, [
    ExecutionState.RISK_APPROVED,
    ExecutionState.IDEMPOTENCY_RESERVED,
    ExecutionState.ORDER_SUBMITTING,
    ExecutionState.FILLED
  ]);
});

test('ambiguous submit transitions to UNKNOWN and is not retried', async () => {
  const sm = new ExecutionStateMachine();
  const states = [];
  let submits = 0;

  await assert.rejects(
    protectedSubmit({
      symbol: 'BTC-USDT',
      side: 'BUY',
      clientOrderId: 'exec-timeout-1',
      payload: {},
      riskContext: {
        dbHealthy: true,
        instanceLeaseValid: true,
        marketDataHealthy: true,
        reconciliationHealthy: true,
        killSwitch: false,
        risk: { allowed: true }
      },
      orderBookValid: true,
      spreadPct: 0.1,
      marketDataAgeMs: 10,
      reserveExecutionIntent: async () => ({ executionId: 'exec-timeout-1', sm }),
      transitionExecution: async ({ next }) => {
        sm.transition(next);
        states.push(next);
      },
      submitter: async () => {
        submits++;
        const e = new Error('request timed out');
        e.code = 'ETIMEDOUT';
        throw e;
      }
    }),
    /EXECUTION_UNKNOWN_RECONCILIATION_REQUIRED/
  );

  assert.equal(submits, 1);
  assert.equal(sm.state, ExecutionState.UNKNOWN);
  assert.deepEqual(states, [
    ExecutionState.RISK_APPROVED,
    ExecutionState.IDEMPOTENCY_RESERVED,
    ExecutionState.ORDER_SUBMITTING,
    ExecutionState.UNKNOWN
  ]);
});
