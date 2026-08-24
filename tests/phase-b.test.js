'use strict';

const assert = require('assert');
const { ExecutionSimulator } = require('../execution-simulator');
const { ExecutionIdempotency } = require('../execution-idempotency');
const { PaperExecutionAdapter } = require('../paper-execution-adapter');
const { ReconciliationEngine } = require('../reconciliation-engine');

(async () => {
  const config = {
    SLIPPAGE_PERCENT: 0.05,
    FEE_PERCENT: 0.10,
    PAPER_SLIPPAGE_PERCENT: 0.05,
    PAPER_TAKER_FEE_PERCENT: 0.10,
    PAPER_EXECUTION_LATENCY_MS: 150,
    PAPER_IMPACT_BPS: 5,
    PAPER_FILL_RATIO: 1
  };

  const simulator = new ExecutionSimulator({ config });
  const idempotency = new ExecutionIdempotency({});
  const paper = new PaperExecutionAdapter({ simulator, idempotency });

  const orderArgs = {
    signalId: 'test-signal-1',
    symbol: 'BTC-USDT',
    direction: 'LONG',
    quantity: 0.01,
    referencePrice: 100000
  };

  const entry = await paper.submitMarketOrder(orderArgs);
  assert.strictEqual(entry.status, 'FILLED');
  assert(entry.avgFillPrice > 100000);
  assert(entry.feeUSD > 0);
  assert.strictEqual(entry.latencyMs, 150);

  // B2: retry is idempotent and returns the original order.
  const retry = await paper.submitMarketOrder(orderArgs);
  assert.strictEqual(retry.orderId, entry.orderId);

  // B3: state must reconcile.
  const recon = new ReconciliationEngine({
    getBotTrades: () => new Map([[
      'BTC-USDT',
      { symbol: 'BTC-USDT', direction: 'LONG', positionSizeUnits: 0.01 }
    ]]),
    executionAdapter: paper
  });
  assert.strictEqual(recon.reconcile().healthy, true);

  // Partial fill / partial close path.
  const partial = await paper.reducePosition({
    symbol: 'BTC-USDT',
    quantity: 0.004,
    fillPriceOverride: 100500,
    referencePrice: 100500
  });
  assert.strictEqual(partial.remainingQty, 0.006);
  assert.strictEqual(paper.getPosition('BTC-USDT').quantity, 0.006);

  const reconPartial = new ReconciliationEngine({
    getBotTrades: () => new Map([[
      'BTC-USDT',
      { symbol: 'BTC-USDT', direction: 'LONG', positionSizeUnits: 0.006 }
    ]]),
    executionAdapter: paper
  });
  assert.strictEqual(reconPartial.reconcile().healthy, true);

  const close = await paper.closePosition({
    symbol: 'BTC-USDT',
    fillPriceOverride: 101000,
    referencePrice: 101000,
    reason: 'test-close'
  });
  assert.strictEqual(close.status, 'FILLED');
  assert.strictEqual(paper.getPositions().length, 0);

  console.log('Phase B1-B4 tests: OK');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
