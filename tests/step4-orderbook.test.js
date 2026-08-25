'use strict';
const assert = require('assert');
const { LocalOrderBook } = require('../local-order-book');
const { OrderBookEngine } = require('../orderbook-engine');
const { EventEmitter } = require('events');
const { SequencedOrderBookBridge } = require('../sequenced-orderbook-bridge');

function testSnapshotAndSequentialDelta() {
  const book = new LocalOrderBook({ symbol: 'BTC-USDT', maxAgeMs: 10000 });
  assert.equal(book.applySnapshot({ sequence: 100, bids: [['100', '2']], asks: [['101', '3']] }), true);
  assert.equal(book.applyDelta({ sequenceStart: 101, sequenceEnd: 102, bids: [['100', '1']], asks: [['101', '2']] }), true);
  assert.equal(book.sequence, 102);
  assert.equal(book.metrics().valid, true);
}

function testGapInvalidatesAndDoesNotApply() {
  let paused = null;
  const book = new LocalOrderBook({ symbol: 'BTC-USDT', onInvalid: x => { paused = x; } });
  book.applySnapshot({ sequence: 100, bids: [['100', '2']], asks: [['101', '3']] });
  assert.equal(book.applyDelta({ sequenceStart: 102, sequenceEnd: 102, bids: [['100', '999']], asks: [] }), false);
  assert.equal(book.valid, false);
  assert.equal(book.state, 'GAP');
  assert.equal(book.bids.get(100), 2, 'gap delta must never be applied');
  assert.match(paused.reason, /SEQUENCE_GAP/);
}

function testRecoveryRequiresSequencedSnapshot() {
  const engine = new OrderBookEngine({ maxAgeMs: 10000 });
  assert.equal(engine.installSnapshot('BTC-USDT', { sequence: 10, bids: [['100', '1']], asks: [['101', '1']] }), true);
  assert.equal(engine.applyDelta('BTC-USDT', { sequenceStart: 12, sequenceEnd: 12, bids: [], asks: [] }), false);
  assert.equal(engine.isTradable('BTC-USDT'), false);
  assert.equal(engine.installSnapshot('BTC-USDT', { sequence: 20, bids: [['100', '2']], asks: [['101', '2']] }), true);
  assert.equal(engine.isTradable('BTC-USDT'), true);
}

async function testBridgeGapRecovery() {
  const ws = new EventEmitter();
  const engine = new OrderBookEngine({ maxAgeMs: 10000 });
  let snapshots = 0;
  const bridge = new SequencedOrderBookBridge({
    ws, engine,
    snapshotProvider: async () => { snapshots++; return { sequence: 50, bids: [['100','1']], asks: [['101','1']] }; }
  });
  ws.emit('message', { type: 'snapshot', symbol: 'BTC-USDT', sequence: 10, bids: [['100','1']], asks: [['101','1']] });
  ws.emit('message', { type: 'delta', symbol: 'BTC-USDT', sequenceStart: 12, sequenceEnd: 12, bids: [], asks: [] });
  await new Promise(r => setImmediate(r));
  assert.equal(snapshots, 1);
  assert.equal(engine.isTradable('BTC-USDT'), true);
  bridge.close();
}

function testStaleBookFailsClosed() {
  const book = new LocalOrderBook({ symbol: 'BTC-USDT', maxAgeMs: 1 });
  book.applySnapshot({ sequence: 1, bids: [['100', '1']], asks: [['101', '1']], timestamp: Date.now() - 100 });
  assert.equal(book.metrics().valid, false);
  assert.equal(book.metrics().fresh, false);
}

function run() {
  testSnapshotAndSequentialDelta();
  testGapInvalidatesAndDoesNotApply();
  testRecoveryRequiresSequencedSnapshot();
  testStaleBookFailsClosed();
  return testBridgeGapRecovery().then(() => console.log('step4-orderbook: PASS (5 tests)'));
}
Promise.resolve(run()).catch(err => { console.error(err); process.exitCode = 1; });
