'use strict';
const assert = require('assert');
const { InstitutionalAgentSuite } = require('../agent-suite');
const suite = new InstitutionalAgentSuite();
const result = suite.evaluate({
  assets: [{ symbol: 'BTCUSDT', requestedWeightPct: 70 }, { symbol: 'ETHUSDT', requestedWeightPct: 50 }],
  maxPortfolioExposurePct: 100,
  spreadPct: 0.02,
  depthUSD: 1000000,
  orderSizeUSD: 10000,
  apiLatencyMs: 50,
  candleDelayMs: 1000,
  exposurePct: 20,
  maxExposurePct: 80,
  drawdownPct: 2,
  maxDrawdownPct: 25,
  dailyLossPct: 1,
  maxDailyLossPct: 10,
  regime: { confidence: 0.8 },
  oosScore: 0.8,
  driftScore: 0.1,
  expectancy: 0.4,
  sharpe: 1.1,
  maxHoldingMinutes: 1440,
  holdingMinutes: 20,
  unrealizedPnlPct: 1
});
for (const key of ['riskSupervisor','portfolioAllocation','anomaly','liquidity','exit','strategy','meta']) assert.ok(result[key], key);
assert.ok(result.meta.decision);
const blocked = suite.evaluate({ exposurePct: 95, maxExposurePct: 80, maxDrawdownPct: 25, maxDailyLossPct: 10 });
assert.equal(blocked.riskSupervisor.hardBlock, true);
assert.equal(blocked.meta.decision, 'NO_TRADE');

const advisory = suite.evaluate({ spreadPct: 10, maxSpreadPct: 1, depthUSD: 0, orderSizeUSD: 10000, strategy: {}, oosScore: 0, driftScore: 1, maxExposurePct: 80, exposurePct: 0, maxDrawdownPct: 25, drawdownPct: 0, maxDailyLossPct: 10, dailyLossPct: 0 });
assert.equal(advisory.meta.hardBlock, false, 'STRATEGY_HEALTH_IS_ADVISORY');
assert.ok(Array.isArray(advisory.meta.advisoryBlocks));
console.log('Agent Suite tests: OK');
