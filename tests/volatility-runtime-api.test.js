'use strict';
const assert = require('node:assert/strict');
const VolatilitySurface = require('../volatilitySurface');

(async () => {
  const manager = new VolatilitySurface();
  const result = await manager.evaluateVolatilityMultiplier('BTC-USDT', 500, 10000);
  assert.equal(result.valid, true);
  assert.equal(result.symbol, 'BTC-USDT');
  assert.ok(Number.isFinite(result.volFactor));
  console.log('volatility-runtime-api.test.js: PASS');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
