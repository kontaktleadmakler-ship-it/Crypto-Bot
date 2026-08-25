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
assert.strictEqual(recovered.patch.mlRecoverySource, 'paperOrders-exact-id');

const unresolved = findExactPaperOrder({ paperOrderId: 'missing' }, idx);
assert.strictEqual(unresolved.order, null);

console.log('ML historical recovery test: OK');
