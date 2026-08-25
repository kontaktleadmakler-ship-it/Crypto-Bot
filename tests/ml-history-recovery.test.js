'use strict';
const assert = require('assert');
const { indexPaperOrders, findExactPaperOrder, recoverTrade } = require('../ml-history-recovery');

const orders = [{ orderId: 'PAPER-1', signalId: 'sig-1', requestedPrice: 100, avgFillPrice: 100.2 }];
const idx = indexPaperOrders(orders);
const match = findExactPaperOrder({ paperOrderId: 'PAPER-1' }, idx);
assert(match.order);
const recovered = recoverTrade({ paperOrderId: 'PAPER-1' }, match.order);
assert.strictEqual(recovered.patch.signalPriceAtEntry, 100);
assert.strictEqual(recovered.patch.entry, 100.2);
assert.strictEqual(recovered.patch.mlRecoverySource, 'paperOrders-exact-entry');

const unresolved = findExactPaperOrder({ paperOrderId: 'missing' }, idx);
assert.strictEqual(unresolved.order, null);

console.log('ML historical recovery test: OK');

const intentIndex = require('../ml-history-recovery').indexExecutionIntents([
  { executionId: 'exec-1', clientOrderId: 'sig-2' }
]);
const eventIndex = require('../ml-history-recovery').indexExecutionEvents([
  {
    executionId: 'exec-1',
    type: 'EXECUTION_INTENT_CREATED',
    sequence: 0,
    payload: { action: 'OPEN', referencePrice: 200 }
  },
  {
    executionId: 'exec-1',
    type: 'EXECUTION_FILLED',
    sequence: 3,
    payload: { action: 'OPEN', remote: { requestedPrice: 200, avgFillPrice: 200.4 } }
  }
]);
const source = require('../ml-history-recovery').findExactExecutionSource(
  { signalId: 'sig-2' },
  intentIndex,
  eventIndex
);
assert(source.event);
const recoveredFromEvent = require('../ml-history-recovery').recoverTrade(
  { signalId: 'sig-2' },
  null,
  source
);
assert.strictEqual(recoveredFromEvent.patch.signalPriceAtEntry, 200);
assert.strictEqual(recoveredFromEvent.patch.entry, 200.4);

console.log('ML historical recovery execution-event test: OK');
