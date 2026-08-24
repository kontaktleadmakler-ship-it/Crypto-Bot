/**
 * v22.7 B11 - deterministic failure/chaos checks.
 * These are safety tests, not production chaos injection.
 */
'use strict';

async function runFailureChaosTests({ stateMachine, gates, reconciliation, killSwitch }) {
  const results = [];

  // Unknown readiness => fail closed.
  const gate = gates.evaluate(['db', 'marketData', 'reconciliation']);
  results.push({ name: 'readiness-fails-closed', ok: gate.ready === false });

  // Broken reconciliation => unsafe.
  const rec = await reconciliation.run({
    localState: { position: 1 },
    executionState: { position: 2 },
    compare: () => ({ ok: false, reason: 'state-mismatch' })
  });
  results.push({ name: 'reconciliation-mismatch-blocks', ok: rec.ok === false && !reconciliation.isSafe() });

  // Kill switch is idempotent and halts.
  killSwitch.activate('chaos-test');
  const once = killSwitch.status();
  killSwitch.activate('chaos-test-again');
  const twice = killSwitch.status();
  results.push({
    name: 'kill-switch-idempotent',
    ok: once.active === true && twice.active === true && stateMachine.state === 'HALTED'
  });

  return { passed: results.every(x => x.ok), results };
}

module.exports = { runFailureChaosTests };
