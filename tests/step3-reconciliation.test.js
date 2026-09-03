import assert from 'node:assert/strict';
import { ReconciliationEngine } from '../execution-core/reconciliation-engine.mjs';
import fs from 'node:fs';

const runtime = fs.readFileSync(new URL('../trading-bot-v25-marketdata-fixed.mjs', import.meta.url), 'utf8');

function exchange(snapshot) {
  return {
    name: 'test-exchange',
    async getReconciliationSnapshot() { return snapshot; },
    async getOrderStatus() { return { status: 'FILLED' }; }
  };
}

let engine = new ReconciliationEngine({
  exchange: exchange({ positions: [{ symbol: 'BTCUSDTM', direction: 'LONG', quantity: 0.25 }], openOrders: [], fills: [], balances: [] })
});
let result = await engine.startupReconcile({ internalPositions: [{ symbol: 'BTCUSDTM', direction: 'LONG', quantity: 0.25 }] });
assert.equal(result.ok, true);
assert.equal(engine.isHealthy(), true);
assert.equal(result.phase, 'RESUME');

engine = new ReconciliationEngine({
  exchange: exchange({ positions: [{ symbol: 'BTCUSDTM', direction: 'LONG', quantity: 0.25 }], openOrders: [], fills: [], balances: [] })
});
result = await engine.startupReconcile({ internalPositions: [] });
assert.equal(result.ok, false);
assert.equal(result.phase, 'HALT');
assert.equal(result.mismatches[0].type, 'REMOTE_POSITION_WITHOUT_INTERNAL');

engine = new ReconciliationEngine({
  exchange: { name: 'disabled-live-adapter' }
});
result = await engine.startupReconcile({ internalPositions: [] });
assert.equal(result.ok, false);
assert.match(result.reason, /REMOTE_RECONCILIATION_API_UNAVAILABLE/);

// Startup ordering: persisted state + paper restore must happen before recovery.
const dbInit = runtime.indexOf('const savedTrades = await tradesCollection.find({}).toArray();');
const restore = runtime.indexOf('await paperExecutionAdapter.restore();', dbInit);
const recovery = runtime.indexOf('await runExecutionRecovery();', dbInit);
assert.ok(dbInit >= 0 && restore > dbInit, 'DB state must load before reconciliation');
assert.ok(recovery > restore, 'recovery must run after persisted/paper state restore');

assert.match(runtime, /startupReconcile/);
assert.match(runtime, /global\.reconciliationHealthy = false/);

console.log('step3_reconciliation: PASS');
