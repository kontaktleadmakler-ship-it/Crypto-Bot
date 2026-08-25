'use strict';

/**
 * Historical ML data recovery.
 *
 * Only restores values that can be proven from persisted execution data.
 * It never invents indicators or derives a signal price from PnL.
 */

const PRICE_FIELDS = ['signalPriceAtEntry', 'entry'];

function finitePositive(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function indexPaperOrders(orders) {
  const byOrderId = new Map();
  const bySignalId = new Map();
  for (const order of orders || []) {
    if (!order || typeof order !== 'object') continue;
    if (order.orderId) byOrderId.set(String(order.orderId), order);
    if (order.signalId) bySignalId.set(String(order.signalId), order);
  }
  return { byOrderId, bySignalId };
}

function findExactPaperOrder(trade, indexes) {
  if (trade?.paperOrderId && indexes.byOrderId.has(String(trade.paperOrderId))) {
    return { order: indexes.byOrderId.get(String(trade.paperOrderId)), source: 'paperOrders.orderId' };
  }
  if (trade?.signalId && indexes.bySignalId.has(String(trade.signalId))) {
    return { order: indexes.bySignalId.get(String(trade.signalId)), source: 'paperOrders.signalId' };
  }
  return { order: null, source: null };
}

function recoverTrade(trade, paperOrder) {
  const patch = {};
  const reasons = [];

  if (!finitePositive(trade.signalPriceAtEntry)) {
    const requested = finitePositive(paperOrder?.requestedPrice);
    if (requested) {
      patch.signalPriceAtEntry = requested;
      reasons.push('signalPriceAtEntry<-paperOrders.requestedPrice');
    }
  }

  if (!finitePositive(trade.entry)) {
    const fill = finitePositive(paperOrder?.avgFillPrice);
    if (fill) {
      patch.entry = fill;
      reasons.push('entry<-paperOrders.avgFillPrice');
    }
  }

  if (patch.signalPriceAtEntry || patch.entry) {
    patch.mlRecoverySource = 'paperOrders-exact-id';
    patch.mlRecoveryAt = Date.now();
  }

  return { patch, reasons };
}

module.exports = { indexPaperOrders, findExactPaperOrder, recoverTrade };
