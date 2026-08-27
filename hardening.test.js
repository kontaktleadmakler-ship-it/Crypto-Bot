'use strict';
const assert = require('assert');
// Bugfix: this file lives at the project root, not inside tests/, so the
// original '../risk-engine' etc. paths pointed one directory too high and
// threw MODULE_NOT_FOUND. Also, positionSize() is implemented on
// RiskManager (risk-manager.js), not on RiskEngine (risk-engine.js, which
// only exposes assess()/evaluate()) - RiskEngine.positionSize() does not
// exist and would have thrown "risk.positionSize is not a function".
const { RiskManager } = require('./risk-manager');
const { DataValidator } = require('./data-validator');
const { OrderFlowAnalyzer } = require('./orderFlowAnalyzer');

const risk = new RiskManager({});
const sized = risk.positionSize({ equityUSD: 10000, riskPercent: 1, entryPrice: 100, stopLossPrice: 95 });
assert(Math.abs(sized.riskUSD - 100) < 1e-9);
assert(Math.abs(sized.units - 20) < 1e-9);
assert(Math.abs(sized.notionalUSD - 2000) < 1e-9);

const candles = [];
for (let i = 0; i < 60; i++) candles.push({ time: 1700000000000 + i * 900000, open: 100, high: 102, low: 99, close: 101, volume: 10 });
const validator = new DataValidator({ maxAgeMs: 365 * 24 * 3600000 });
// Bugfix: candle `time` is OPEN time (see data-validator.js), so `now` must
// be at/after the last candle's CLOSE (open + timeframeMs) or the validator
// correctly (and intentionally) rejects it as 'unclosed-latest-candle'.
// The original test passed `now: candles.at(-1).time`, which is still
// mid-candle, so this assertion always failed.
assert.equal(validator.candles(candles, { timeframeMs: 900000, now: candles.at(-1).time + 900000 }).valid, true);
const bad = candles.map(x => ({ ...x })); bad[30].time = bad[29].time;
assert.equal(validator.candles(bad, { timeframeMs: 900000, now: candles.at(-1).time + 900000 }).valid, false);

const of = new OrderFlowAnalyzer();
const evaluated = of.evaluateOrderFlow(candles, {});
assert.equal(evaluated.isTrueCVD, false);
assert.equal(typeof evaluated.score, 'number');
console.log('hardening tests: 3/3 passed');
