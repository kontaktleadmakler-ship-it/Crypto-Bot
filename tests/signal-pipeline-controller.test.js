const assert = require('assert');
const { createPipeline, transition, reject, withTimeout } = require('../signal-pipeline-controller');

(async () => {
  const p = createPipeline('BTC-USDT', 7);
  transition(p, 'AGENTS_EVALUATING');
  reject(p, 'RISK_REJECTED');
  transition(p, 'EXECUTION');
  assert.equal(p.stage, 'REJECTED');
  assert.equal(p.reason, 'RISK_REJECTED');

  const value = await withTimeout(() => Promise.resolve(42), 100);
  assert.equal(value, 42);

  await assert.rejects(() => withTimeout(() => new Promise(() => {}), 10), /PIPELINE_TIMEOUT/);
  console.log('Signal Pipeline Controller tests: OK');
})().catch(err => { console.error(err); process.exit(1); });
