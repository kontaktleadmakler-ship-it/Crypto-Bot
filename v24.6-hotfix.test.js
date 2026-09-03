'use strict';
const assert = require('assert');
const fs = require('fs');

const runtime = fs.readFileSync(require('path').join(__dirname, '..', 'trading-bot-v25-marketdata-fixed.mjs'), 'utf8');
const rl = fs.readFileSync(require('path').join(__dirname, '..', 'rl-engine.js'), 'utf8');
const pkg = require('../package.json');

assert.ok(runtime.includes("version: '24.7.0-agent-suite'"), 'v24.7 status endpoint missing');
assert.ok(runtime.includes("const normalizedText = String(text || '').trim();"), 'Telegram normalization missing');
assert.ok(runtime.includes("/pause | /resume | /scan | /backtest [Symbol] [Days]\n` +"), 'Telegram help concatenation not fixed');
assert.ok(!runtime.includes("/backtest [Symbol] [Days]`\n      `"), 'Telegram help still contains tagged-template bug');
assert.ok(rl.includes('const meanLayer = tf.layers.dense'), 'DQN mean layer missing');
assert.ok(rl.includes('meanLayer.setWeights([meanKernel])'), 'DQN layer weights are not assigned to the Layer');
assert.ok(!rl.includes('}).apply(advOut);\n\n    // Set the fixed averaging kernel'), 'DQN still assigns setWeights to symbolic tensor');
// Stale assumption: `npm start` no longer points at the intermediate
// trading-bot-v25.js - package.json's start script now runs the actually
// deployed runtime, trading-bot-v25-marketdata-fixed.mjs. Assert on that.
assert.strictEqual(pkg.scripts.start, 'node trading-bot-v25-marketdata-fixed.mjs');
console.log('v24.6 hotfix tests: OK');
