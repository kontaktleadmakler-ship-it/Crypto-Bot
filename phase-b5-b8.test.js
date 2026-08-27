'use strict';
const assert = require('assert');
const { ExecutionSimulator } = require('../execution-simulator');
const { ExecutionParity } = require('../execution-parity');
const { RiskEngine } = require('../risk-engine');
const { splitWalkForward, chronologicalAssert } = require('../walk-forward-validator');
const { evaluateProbabilities } = require('../ml-evaluation');
const { evaluateActions } = require('../dqn-evaluation');

const cfg = { PAPER_SLIPPAGE_PERCENT: 0.1, PAPER_SPREAD_PERCENT: 0.02, PAPER_TAKER_FEE_PERCENT: 0.1, PAPER_MAKER_FEE_PERCENT: 0.05, PAPER_EXECUTION_LATENCY_MS: 100, PAPER_IMPACT_BPS: 5, PAPER_FILL_RATIO: 1, MAX_DAILY_LOSS_USD: 100, MAX_DRAWDOWN_PERCENT: 20, MAX_EXPOSURE_RATIO: 0.6 };
const sim = new ExecutionSimulator({ config: cfg });
const parity = new ExecutionParity({ config: cfg, simulator: sim });
const fill = parity.fill({ side: 'BUY', referencePrice: 100, quantity: 2 });
assert(fill.fillPrice > 100);
assert(fill.feeUSD > 0);
const pnl = parity.tradePnl({ direction: 'LONG', entryPrice: 100, exitPrice: 110, quantity: 2, entryFee: 0.2, exitFee: 0.22, fundingUSD: 0.1 });
assert.strictEqual(Number(pnl.netPnLUSD.toFixed(2)), 19.48);

const risk = new RiskEngine({ config: cfg });
assert.strictEqual(risk.assess({ equity: 1000, peakEquity: 1000, dailyPnL: 0, openPositions: [], proposed: { notionalUSD: 100 } }).allowed, true);
assert.strictEqual(risk.assess({ equity: 700, peakEquity: 1000, dailyPnL: 0, openPositions: [] }).allowed, false);
risk.setKillSwitch(true);
assert.strictEqual(risk.assess({ equity: 1000, peakEquity: 1000 }).allowed, false);

const items = Array.from({length: 20}, (_, i) => ({ time: i }));
const splits = splitWalkForward(items, { trainSize: 8, testSize: 4, purgeSize: 2, embargoSize: 1, stepSize: 4 });
assert(splits.length > 0);
chronologicalAssert(splits[0].train, splits[0].test);
assert.strictEqual(splits[0].purge.length, 2);

const ml = evaluateProbabilities([{p:.9,y:1},{p:.1,y:0},{p:.6,y:1},{p:.4,y:0}]);
assert(ml.logLoss >= 0 && ml.brierScore >= 0 && ml.calibration.length === 10);
const dqn = evaluateActions([{reward:1},{reward:-0.5},{reward:2}]);
assert(dqn.samples === 3 && Number.isFinite(dqn.meanReward));
console.log('Phase B5-B8 tests: OK');
