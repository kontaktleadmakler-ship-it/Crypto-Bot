'use strict';
const assert = require('assert');
const { RiskEngine } = require('../risk-engine');
const { DataValidator } = require('../data-validator');
const { OrderFlowAnalyzer } = require('../orderFlowAnalyzer');

const risk = new RiskEngine({});
const sized = risk.positionSize({ equityUSD: 10000, riskPercent: 1, entryPrice: 100, stopLossPrice: 95 });
assert(Math.abs(sized.riskUSD - 100) < 1e-9);
assert(Math.abs(sized.units - 20) < 1e-9);
assert(Math.abs(sized.notionalUSD - 2000) < 1e-9);

const candles = [];
for (let i = 0; i < 60; i++) candles.push({ time: 1700000000000 + i * 900000, open: 100, high: 102, low: 99, close: 101, volume: 10 });
const validator = new DataValidator({ maxAgeMs: 365 * 24 * 3600000 });
assert.equal(validator.candles(candles, { timeframeMs: 900000, now: candles.at(-1).time }).valid, true);
const bad = candles.map(x => ({ ...x })); bad[30].time = bad[29].time;
assert.equal(validator.candles(bad, { timeframeMs: 900000, now: candles.at(-1).time }).valid, false);

const of = new OrderFlowAnalyzer();
const evaluated = of.evaluateOrderFlow(candles, {});
assert.equal(evaluated.isTrueCVD, false);
assert.equal(typeof evaluated.score, 'number');
console.log('hardening tests: 3/3 passed');
