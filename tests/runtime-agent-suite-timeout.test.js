'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPipeline, withTimeout } = require('../signal-pipeline-controller');

const root = path.join(__dirname, '..');
const runtime = fs.readFileSync(path.join(root, 'trading-bot-v25-marketdata-fixed.mjs'), 'utf8');

assert.match(runtime, /pipelineWithTimeout\(\(\) => agentSuite\.evaluate\(\{/);
assert.match(runtime, /\}\), 3000, 'AGENT_SUITE_TIMEOUT'\);/);
assert.match(runtime, /pipelineTimeouts:\s*0/);
assert.match(runtime, /e\?\.code === 'AGENT_SUITE_TIMEOUT'/);
assert.match(runtime, /scanStats\.pipelineTimeouts = \(scanStats\.pipelineTimeouts \|\| 0\) \+ 1/);
assert.match(runtime, /pipelineRejected:\s*0, pipelineStages:\s*\{\}, pipelineTimeouts:\s*0/);
assert.match(runtime, /\[SCAN-DIAGNOSTICS-PIPELINE\]/);

(async () => {
  const scanStats = { pipelineTimeouts: 0, pipelineRejected: 0, pipelineStages: {} };
  const pipeline = createPipeline('TEST-USDT', 1);

  try {
    await withTimeout(() => new Promise(resolve => setTimeout(resolve, 50)), 5, 'AGENT_SUITE_TIMEOUT');
    assert.fail('expected AGENT_SUITE_TIMEOUT');
  } catch (err) {
    assert.equal(err.code, 'AGENT_SUITE_TIMEOUT');
    if (err.code === 'AGENT_SUITE_TIMEOUT') {
      scanStats.pipelineTimeouts = (scanStats.pipelineTimeouts || 0) + 1;
    }
  }

  assert.equal(scanStats.pipelineTimeouts, 1);
  assert.equal(pipeline.stage, 'CANDIDATE');
  console.log('runtime-agent-suite-timeout.test.js: PASS');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
