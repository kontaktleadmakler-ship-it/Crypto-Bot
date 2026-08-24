const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ShadowTradingEngine } = require('../shadow-trading-engine');
const { ShadowTradeJournal } = require('../shadow-trade-journal');
const { MODES, isShadow, assertNoLiveExecution } = require('../shadow-mode');

(async () => {
  const simulator = {
    async simulateFill({ market, signalPrice }) {
      return { price: Number(market.price), reference: Number(signalPrice), fees: 0, slippage: 0 };
    }
  };

  const engine = new ShadowTradingEngine({
    simulator,
    config: { enabled: true },
    logger: { warn() {}, error() {} }
  });

  const signal = {
    signalId: 's1',
    symbol: 'BTC-USDT',
    side: 'BUY',
    quantity: 1,
    signalPrice: 100,
    strategyVersion: 'v1',
    featureVersion: 'f1',
    modelVersion: 'm1',
    configHash: 'c1'
  };

  const first = await engine.onSignal(signal, { price: 101 });
  assert.strictEqual(first.accepted, true);
  const duplicate = await engine.onSignal(signal, { price: 102 });
  assert.strictEqual(duplicate.duplicate, true);

  const closed = await engine.closePosition('s1', { price: 103 }, 'TP');
  assert.strictEqual(closed.closed, true);

  assert.strictEqual(isShadow(MODES.SHADOW), true);
  assert.throws(() => assertNoLiveExecution(MODES.SHADOW, 'placeOrder'), /SHADOW_LIVE_EXECUTION_BLOCKED/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-b10-'));
  const journal = new ShadowTradeJournal({ file: path.join(dir, 'journal.jsonl') });
  journal.append({ type: 'fill', signalId: 's1' });
  assert.strictEqual(fs.readFileSync(path.join(dir, 'journal.jsonl'), 'utf8').trim().length > 0, true);
  fs.rmSync(dir, { recursive: true, force: true });

  console.log('Phase B10 tests: OK');
})().catch(err => { console.error(err); process.exit(1); });
