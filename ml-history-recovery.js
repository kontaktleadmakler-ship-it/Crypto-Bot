'use strict';

/**
 * Historical ML data recovery v2.
 *
 * Purpose:
 * - Recover ONLY persisted, provable entry prices for legacy closedTrades.
 * - Prefer the exact entry paperOrder referenced by paperOrderId/signalId.
 * - Fall back to exact execution-intent/event identifiers when available.
 * - Never use a close fill as an entry fill.
 * - Never invent indicators or reconstruct features from PnL.
 *
 * This module is deliberately conservative: a trade is recovered only when
 * the source can be linked to the trade by an exact identifier.
 */

function finitePositive(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function str(v) {
  return v == null ? null : String(v);
}

function isEntryPaperOrder(order) {
  return !!order && typeof order === 'object' && !order.closeReason && !order.parentOrderId;
}

function indexPaperOrders(orders) {
  const byOrderId = new Map();
  const bySignalId = new Map();

  for (const order of orders || []) {
    if (!isEntryPaperOrder(order)) continue;
    if (order.orderId || order._id) {
      const id = str(order.orderId || order._id);
      if (id) byOrderId.set(id, order);
    }
    if (order.signalId) bySignalId.set(str(order.signalId), order);
  }
  return { byOrderId, bySignalId };
}

function indexExecutionIntents(intents) {
  const byExecutionId = new Map();
  const byClientOrderId = new Map();
  for (const doc of intents || []) {
    if (!doc || typeof doc !== 'object') continue;
    if (doc.executionId) byExecutionId.set(str(doc.executionId), doc);
    if (doc.clientOrderId) byClientOrderId.set(str(doc.clientOrderId), doc);
  }
  return { byExecutionId, byClientOrderId };
}

function indexExecutionEvents(events) {
  const byExecutionId = new Map();
  for (const event of events || []) {
    if (!event?.executionId) continue;
    const key = str(event.executionId);
    const list = byExecutionId.get(key) || [];
    list.push(event);
    byExecutionId.set(key, list);
  }
  for (const list of byExecutionId.values()) {
    list.sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0));
  }
  return { byExecutionId };
}

function findExactPaperOrder(trade, indexes) {
  const paperOrderId = str(trade?.paperOrderId);
  if (paperOrderId && indexes.byOrderId.has(paperOrderId)) {
    return { order: indexes.byOrderId.get(paperOrderId), source: 'paperOrders.orderId', sourceId: paperOrderId };
  }

  const signalId = str(trade?.signalId);
  if (signalId && indexes.bySignalId.has(signalId)) {
    return { order: indexes.bySignalId.get(signalId), source: 'paperOrders.signalId', sourceId: signalId };
  }

  return { order: null, source: null, sourceId: null };
}

function getPayload(event) {
  return event?.payload && typeof event.payload === 'object' ? event.payload : {};
}

function eventLooksLikeEntry(event) {
  const p = getPayload(event);
  return String(p.action || '').toUpperCase() === 'OPEN' ||
    String(event?.type || '').includes('EXECUTION_INTENT_CREATED') && String(p.action || '').toUpperCase() === 'OPEN';
}

function findExactExecutionSource(trade, intentIndexes, eventIndexes) {
  const ids = [
    str(trade?.executionId),
    str(trade?.paperExecutionId),
    str(trade?.clientOrderId),
    str(trade?.signalId)
  ].filter(Boolean);

  for (const id of ids) {
    const intent = intentIndexes.byExecutionId.get(id) || intentIndexes.byClientOrderId.get(id);
    if (!intent) continue;

    const executionId = str(intent.executionId);
    const events = executionId ? (eventIndexes.byExecutionId.get(executionId) || []) : [];
    const entryEvents = events.filter(eventLooksLikeEntry);
    const filled = [...entryEvents].reverse().find(e => {
      const p = getPayload(e);
      return p.remote?.avgFillPrice || p.remote?.requestedPrice || p.referencePrice || p.remote?.fillPrice;
    });

    return {
      intent,
      event: filled || entryEvents[entryEvents.length - 1] || null,
      source: 'executionEvents.exact-id',
      sourceId: executionId || id
    };
  }

  return { intent: null, event: null, source: null, sourceId: null };
}

function pricesFromPaperOrder(order) {
  if (!order) return { signalPriceAtEntry: null, entry: null, reason: null };

  const requested = finitePositive(order.requestedPrice);
  const fill = finitePositive(order.avgFillPrice);

  return {
    signalPriceAtEntry: requested,
    entry: fill,
    reason: requested || fill ? 'paperOrders.entry-order' : null
  };
}

function pricesFromExecutionSource(intent, event) {
  const ip = intent?.payload && typeof intent.payload === 'object' ? intent.payload : {};
  const ep = getPayload(event);
  const remote = ep.remote && typeof ep.remote === 'object' ? ep.remote : {};

  const signal =
    finitePositive(ip.signalPriceAtEntry) ||
    finitePositive(ip.referencePrice) ||
    finitePositive(ep.signalPriceAtEntry) ||
    finitePositive(ep.referencePrice) ||
    finitePositive(remote.requestedPrice);

  const entry =
    finitePositive(remote.avgFillPrice) ||
    finitePositive(remote.fillPrice) ||
    finitePositive(ep.avgFillPrice) ||
    finitePositive(ep.fillPrice);

  return {
    signalPriceAtEntry: signal,
    entry,
    reason: signal || entry ? 'executionEvents.exact-entry' : null
  };
}

function recoverTrade(trade, paperOrder = null, executionSource = null) {
  const patch = {};
  const reasons = [];

  const paperPrices = pricesFromPaperOrder(paperOrder);
  const executionPrices = pricesFromExecutionSource(
    executionSource?.intent,
    executionSource?.event
  );

  if (!finitePositive(trade?.signalPriceAtEntry)) {
    const signal = paperPrices.signalPriceAtEntry || executionPrices.signalPriceAtEntry;
    if (signal) {
      patch.signalPriceAtEntry = signal;
      reasons.push(
        paperPrices.signalPriceAtEntry
          ? 'signalPriceAtEntry<-exact-paperOrder.requestedPrice'
          : 'signalPriceAtEntry<-exact-execution.referencePrice'
      );
    }
  }

  if (!finitePositive(trade?.entry)) {
    const fill = paperPrices.entry || executionPrices.entry;
    if (fill) {
      patch.entry = fill;
      reasons.push(
        paperPrices.entry
          ? 'entry<-exact-paperOrder.avgFillPrice'
          : 'entry<-exact-execution.avgFillPrice'
      );
    }
  }

  if (Object.keys(patch).length) {
    patch.mlRecoverySource = paperOrder
      ? 'paperOrders-exact-entry'
      : 'executionEvents-exact-entry';
    patch.mlRecoverySourceId = paperOrder?.orderId || paperOrder?._id ||
      executionSource?.sourceId || null;
    patch.mlRecoveryAt = new Date();
    patch.mlRecoveryVersion = 2;
  }

  return { patch, reasons };
}

module.exports = {
  finitePositive,
  indexPaperOrders,
  indexExecutionIntents,
  indexExecutionEvents,
  findExactPaperOrder,
  findExactExecutionSource,
  recoverTrade,
  isEntryPaperOrder
};
