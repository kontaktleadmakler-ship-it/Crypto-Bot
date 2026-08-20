'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { RiskEngine } = require('../risk-engine');
const { DataValidator } = require('../data-validator');

const root = path.resolve(__dirname, '..');
const now = Date.now();
const validator = new DataValidator({ maxAgeMs: 20 * 60 * 1000 });
const candles = Array.from({ length: 20 }, (_, i) => ({
  time: now - (19 - i) * 15 * 60 * 1000,
  open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i, volume: 10
}));
assert.equal(validator.candles(candles, { timeframeMs: 15 * 60 * 1000, now }).valid, true);
assert.equal(validator.candles([{ ...candles[0], high: 1, low: 2 }], { timeframeMs: 15 * 60 * 1000, now, minLength: 1 }).valid, false);

const risk = new RiskEngine({});
let r = risk.evaluate({ equityUSD: 10000, dailyPnL: 0, peakEquityUSD: 10000, activeTrades: [], direction: 'LONG', notionalUSD: 1000, maxConcurrent: 3, maxSameDirection: 2, maxExposureRatio: .6, maxDailyLossUSD: 250, maxDrawdownPercent: 25, leverage: 3 });
assert.equal(r.allowed, true);
risk.setKillSwitch('test');
assert.equal(risk.evaluate({ equityUSD: 10000, dailyPnL: 0, peakEquityUSD: 10000, activeTrades: [], direction: 'LONG', notionalUSD: 1000, maxConcurrent: 3, maxSameDirection: 2, maxExposureRatio: .6, maxDailyLossUSD: 250, maxDrawdownPercent: 25, leverage: 3 }).allowed, false);

const main = fs.readFileSync(path.join(root, 'trading-bot-v22.2.1.js'), 'utf8');
const ml = fs.readFileSync(path.join(root, 'ml-engine.js'), 'utf8');
const rl = fs.readFileSync(path.join(root, 'rl-engine.js'), 'utf8');
const bt = fs.readFileSync(path.join(root, 'backtest-engine.js'), 'utf8');
assert(main.includes('riskEngine.evaluate'));
assert(main.includes("command === '/dqn'"));
assert(main.includes('DataValidator'));
assert(!/config\.ATR_STOP_MULT\s*=\s*best\.atrMultiplier/.test(main));
assert(!/config\.ADX_MIN\s*=\s*best\.adxMin/.test(main));
assert(ml.includes('signalPriceAtEntry'));
assert(!/finite\(trade\.entry, 0\)/.test(ml));
assert(/sort\(\{ closeTime: 1 \}\)/.test(rl));
assert(bt.includes('REQUIRE_FUNDING_HISTORY'));
assert(bt.includes('monteCarlo('));
console.log('✅ Phase A hardening tests passed');
