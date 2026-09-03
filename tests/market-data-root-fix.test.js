const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const runtime = fs.readFileSync(path.join(root, 'trading-bot-v25-marketdata-fixed.mjs'), 'utf8');
const kucoin = fs.readFileSync(path.join(root, 'kucoin.js'), 'utf8');
const srcKucoin = fs.readFileSync(path.join(root, 'src/api/kucoin.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

assert.equal(pkg.version, '25.0.16');
assert.equal((runtime.match(/if \(isKucoinCircuitOpen\(\)\)/g) || []).length, 2);
assert.match(runtime, /async function getMarketDataBundle\(symbol\) \{/);
assert.doesNotMatch(runtime, /async function getMarketDataBundle\(symbol\) \{\s*if \(isKucoinCircuitOpen\(\)\) \{\s*if \(isKucoinCircuitOpen\(\)\)/);
assert.match(runtime, /MARKET_DATA_CONCURRENCY: parseInt\(process\.env\.MARKET_DATA_CONCURRENCY, 10\) \|\| 3/);
// NOTE: v24.6-runtime.mjs declares a `MARKET_DATA_QUEUE_TIMEOUT_MS` config
// key, but it has no consumer anywhere in that file - it's dead config left
// over from an earlier refactor. The actual behavior required by
// MARKET_DATA_ROOT_CAUSE_FIX_V25.0.13.md ("market-data bundle timeout capped
// at 10s by default") is implemented in trading-bot-v25-marketdata-fixed.mjs
// via MARKET_DATA_BUNDLE_TIMEOUT_MS and the hardcoded semaphore acquire
// timeout below - just through a different config surface. Assert on the
// real, live implementation instead of the dead v24.6 declaration.
assert.match(runtime, /MARKET_DATA_BUNDLE_TIMEOUT_MS = Math\.min\(/);
assert.match(runtime, /marketDataSemaphore\.acquire\(10000\)/);
assert.match(runtime, /err\.code = 'MARKET_DATA_QUEUE_TIMEOUT'/);
assert.match(runtime, /ENABLE_PRELOADING: process\.env\.ENABLE_PRELOADING === 'true'/);
assert.match(runtime, /err\.code = 'ASYNC_POOL_ITEM_TIMEOUT'/);
for (const text of [kucoin, srcKucoin]) {
  assert.match(text, /circuitThreshold = 8, cooldownMs = 15000/);
  assert.match(text, /const transient = !status \|\| status === 408/);
}
console.log('market-data-root-fix: PASS');
