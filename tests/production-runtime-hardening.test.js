const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const runtimePath = path.join(root, 'trading-bot-v25-marketdata-fixed.mjs');
const runtime = fs.readFileSync(runtimePath, 'utf8');

assert.match(runtime, /async function predictSignalSuccessAsync\(features\)/);
assert.match(runtime, /const mlPrediction = await predictSignalSuccessAsync\(mlFeatures\);/);
assert.doesNotMatch(runtime, /const mlPrediction = predictSignalSuccess\(mlFeatures\);/);
assert.match(runtime, /FUTURES_API_CONCURRENCY: parseInt\(process\.env\.FUTURES_API_CONCURRENCY/);
assert.match(runtime, /FUTURES_API_QUEUE_TIMEOUT_MS: parseInt\(process\.env\.FUTURES_API_QUEUE_TIMEOUT_MS/);
assert.match(runtime, /const transient =\s*!status\s*\|\|\s*status === 408/);
assert.match(runtime, /code === 'ECONNRESET'/);
assert.match(runtime, /status >= 500/);
assert.match(runtime, /BOT_TEST_MODE/);

const smoke = spawnSync(process.execPath, ['--input-type=module', '-e', `
  process.env.BOT_TEST_MODE='true';
  process.env.ML_ENABLED='false';
  const m = await import(${JSON.stringify(runtimePath)});
  if (!m.__test) throw new Error('test surface missing');
  if (m.__test.config.TEST_MODE !== true) throw new Error('test mode not active');
  const r = await m.__test.predictSignalSuccessAsync([1]);
  if (r.trained !== false || r.class !== 'UNKNOWN') throw new Error('async ML fallback failed');
  console.log('production-runtime smoke: PASS');
`], { encoding: 'utf8', timeout: 15000, env: { ...process.env, BOT_TEST_MODE: 'true', ML_ENABLED: 'false' } });

if (smoke.status !== 0) {
  console.error(smoke.stdout || '');
  console.error(smoke.stderr || '');
  throw new Error('production runtime smoke import failed');
}

console.log('production-runtime-hardening: PASS');
