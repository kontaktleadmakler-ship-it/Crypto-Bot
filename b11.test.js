const assert = require('assert');
const { ProductionStateMachine, STATES } = require('../production-state-machine');
const { HealthReadinessGates } = require('../health-readiness-gates');
const { StartupReconciliation } = require('../startup-reconciliation');
const { KillSwitchController } = require('../kill-switch-controller');
const { runFailureChaosTests } = require('../failure-chaos-tests');

(async () => {
  const logger = { info() {}, warn() {}, error() {} };
  const sm = new ProductionStateMachine({ logger });
  assert.strictEqual(sm.state, STATES.STARTING);
  sm.transition(STATES.PAPER, 'tests-ready');

  const gates = new HealthReadinessGates({ logger });
  assert.strictEqual(gates.evaluate(['db']).ready, false);
  gates.set('db', true);
  assert.strictEqual(gates.evaluate(['db']).ready, true);

  const reconciliation = new StartupReconciliation({ logger });
  const ok = await reconciliation.run({
    compare: () => ({ ok: true, reason: 'consistent' })
  });
  assert.strictEqual(ok.ok, true);

  const kill = new KillSwitchController({ stateMachine: sm, logger });
  kill.activate('test');
  assert.strictEqual(kill.isActive(), true);
  assert.strictEqual(sm.state, STATES.HALTED);
  assert.throws(() => kill.guard('signal'), /KILL_SWITCH_ACTIVE|SYSTEM_HALTED/);

  const chaosState = new ProductionStateMachine({ logger });
  chaosState.transition(STATES.PAPER, 'chaos');
  const chaosKill = new KillSwitchController({ stateMachine: chaosState, logger });
  const chaos = await runFailureChaosTests({
    stateMachine: chaosState,
    gates: new HealthReadinessGates({ logger }),
    reconciliation: new StartupReconciliation({ logger }),
    killSwitch: chaosKill
  });
  assert.strictEqual(chaos.passed, true);
  console.log('Phase B11 tests: OK');
})().catch(err => { console.error(err); process.exit(1); });
