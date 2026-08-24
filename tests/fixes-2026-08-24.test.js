'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { RiskEngine } = require('../risk-engine');

const rl = fs.readFileSync(path.join(__dirname, '..', 'rl-engine.js'), 'utf8');
assert(!/tf\.layers\.subtract\(\)/.test(rl), 'RL engine must not call unavailable tf.layers.subtract()');
assert(rl.includes('const negativeMeanRepLayer = tf.layers.dense'), 'RL engine must negate mean advantage with a supported layer');
assert(rl.includes('const centeredAdv = tf.layers.add().apply([advOut, negativeMeanRep]);'), 'RL engine must center advantage with tf.layers.add()');

const cfg = { MAX_EXPOSURE_RATIO: 0.6, LEVERAGE: 3, MAX_DRAWDOWN_PERCENT: 20, MAX_DAILY_LOSS_USD: 250 };
const risk = new RiskEngine({ config: cfg });

// 10k equity, 3x leverage, 60% max margin => 18k gross notional.
assert.strictEqual(risk.assess({
  equity: 10000, peakEquity: 10000, openPositions: [{ notionalUSD: 12000 }],
  proposed: { notionalUSD: 6000 }
}).allowed, true);

const blocked = risk.assess({
  equity: 10000, peakEquity: 10000, openPositions: [{ notionalUSD: 12000 }],
  proposed: { notionalUSD: 6001 }
});
assert.strictEqual(blocked.allowed, false);
assert.strictEqual(blocked.reason, 'max-exposure');
assert.strictEqual(blocked.maxExposureMarginUSD, 6000);
assert.strictEqual(blocked.totalExposureUSD, 18001);

console.log('2026-08-24 fixes test: OK');
