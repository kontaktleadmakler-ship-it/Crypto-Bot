'use strict';

const crypto = require('crypto');

/**
 * PaperExecutionAdapter – v22.3
 *
 * B1: paper execution interface
 * B2: signal/order idempotency
 *
 * This adapter is deliberately incapable of sending exchange orders.
 */
class PaperExecutionAdapter {
  constructor({ simulator, idempotency, collection = null, logger = console } = {}) {
    if (!simulator) throw new Error('PaperExecutionAdapter requires simulator');
    if (!idempotency) throw new Error('PaperExecutionAdapter requires idempotency');
    this.simulator = simulator;
    this.idempotency = idempotency;
    this.collection = collection;
    this.logger = logger;
    this.orders = new Map();
    this.positions = new Map();
    this.symbolInFlight = new Set();
  }

  previewFillPrice({ symbol, direction, referencePrice, quantity = 0, orderBook = null } = {}) {
    return this.simulator.estimateFillPrice({
      side: String(direction).toUpperCase() === 'SHORT' ? 'SELL' : 'BUY',
      referencePrice,
      quantity,
      orderBook
    });
  }

  getCapabilities() {
    return {
      paper: true,
      liveExecution: false,
      idempotency: true,
      partialFills: true,
      marketImpact: true,
      fees: true,
      latencyModel: true
    };
  }

  _orderId() {
    return `PAPER-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  }

  async submitMarketOrder({
    signalId,
    symbol,
    direction,
    quantity,
    referencePrice,
    orderBook = null,
    metadata = {}
  }) {
    if (!symbol || !['LONG', 'SHORT'].includes(String(direction).toUpperCase())) {
      throw new Error('INVALID_PAPER_ORDER');
    }
    if (!(Number(quantity) > 0) || !(Number(referencePrice) > 0)) {
      throw new Error('INVALID_PAPER_ORDER_SIZE_OR_PRICE');
    }

    const configHash = metadata.configHash || crypto.createHash('sha256')
      .update(JSON.stringify(metadata.config || {}))
      .digest('hex')
      .slice(0, 16);

    const key = this.idempotency.constructor.makeKey({
      signalId,
      symbol,
      direction,
      strategyVersion: metadata.strategyVersion,
      configHash
    });

    const lock = await this.idempotency.acquire(key, {
      signalId, symbol, direction, configHash, ...metadata
    });
    if (!lock.acquired) {
      if (lock.reason === 'duplicate' && lock.record?.orderId) {
        return this.orders.get(lock.record.orderId) || lock.record;
      }
      throw new Error(`PAPER_EXECUTION_BLOCKED:${lock.reason}`);
    }

    if (this.symbolInFlight.has(symbol) || this.positions.has(symbol)) {
      await this.idempotency.release(key, 'symbol-active');
      throw new Error(`PAPER_EXECUTION_BLOCKED:symbol-already-active:${symbol}`);
    }
    this.symbolInFlight.add(symbol);

    try {
      const fill = this.simulator.simulateMarketOrder({
        symbol,
        direction,
        referencePrice,
        quantity,
        orderBook
      });

      const order = {
        orderId: this._orderId(),
        signalId: signalId || key,
        symbol,
        direction: String(direction).toUpperCase(),
        status: fill.fillRatio < 0.999999 ? 'PARTIALLY_FILLED' : 'FILLED',
        requestedQty: Number(quantity),
        filledQty: fill.quantity,
        requestedPrice: fill.requestedPrice,
        avgFillPrice: fill.fillPrice,
        notionalUSD: fill.notionalUSD,
        feeUSD: fill.feeUSD,
        latencyMs: fill.latencyMs,
        simulatedAt: fill.simulatedAt,
        metadata: { ...metadata, configHash }
      };

      this.orders.set(order.orderId, order);
      this.positions.set(symbol, {
        symbol,
        direction: order.direction,
        quantity: order.filledQty,
        entryPrice: order.avgFillPrice,
        orderId: order.orderId,
        signalId: order.signalId,
        updatedAt: Date.now()
      });

      await this.idempotency.commit(key, { orderId: order.orderId, status: 'FILLED' });
      this.symbolInFlight.delete(symbol);
      if (this.collection) {
        await this.collection.updateOne(
          { _id: order.orderId },
          { $set: { ...order, _id: order.orderId } },
          { upsert: true }
        );
      }
      return order;
    } catch (e) {
      this.symbolInFlight.delete(symbol);
      await this.idempotency.release(key, 'failed');
      throw e;
    }
  }

  async reducePosition({ symbol, quantity, referencePrice, fillPriceOverride = null, reason = 'partial-close' }) {
    const position = this.positions.get(symbol);
    if (!position) return null;
    const reduceQty = Math.min(Math.abs(Number(quantity)), Number(position.quantity));
    if (!(reduceQty > 0)) return null;

    const sideDirection = position.direction === 'LONG' ? 'SHORT' : 'LONG';
    const fill = fillPriceOverride
      ? {
          fillPrice: Number(fillPriceOverride),
          quantity: reduceQty,
          notionalUSD: Math.abs(Number(fillPriceOverride) * reduceQty),
          feeUSD: this.simulator.estimateFee(Math.abs(Number(fillPriceOverride) * reduceQty), 'taker'),
          latencyMs: this.simulator.estimateLatencyMs(),
          simulatedAt: Date.now()
        }
      : this.simulator.simulateMarketOrder({
          symbol,
          direction: sideDirection,
          referencePrice,
          quantity: reduceQty
        });

    const remainingQty = Math.max(0, Number(position.quantity) - reduceQty);
    const close = {
      orderId: this._orderId(),
      parentOrderId: position.orderId,
      symbol,
      direction: sideDirection,
      status: 'FILLED',
      filledQty: reduceQty,
      remainingQty,
      avgFillPrice: fill.fillPrice,
      notionalUSD: fill.notionalUSD,
      feeUSD: fill.feeUSD,
      latencyMs: fill.latencyMs,
      closeReason: reason,
      simulatedAt: fill.simulatedAt
    };

    this.orders.set(close.orderId, close);
    if (remainingQty > 0) {
      this.positions.set(symbol, { ...position, quantity: remainingQty, updatedAt: Date.now() });
    } else {
      this.positions.delete(symbol);
    }
    if (this.collection) {
      await this.collection.updateOne({ _id: close.orderId }, { $set: { ...close, _id: close.orderId } }, { upsert: true });
    }
    return close;
  }

  async closePosition({ symbol, referencePrice, fillPriceOverride = null, reason = 'unknown' }) {
    const position = this.positions.get(symbol);
    if (!position) return null;
    const sideDirection = position.direction === 'LONG' ? 'SHORT' : 'LONG';
    const fill = fillPriceOverride
      ? {
          fillPrice: Number(fillPriceOverride),
          quantity: Number(position.quantity),
          notionalUSD: Math.abs(Number(fillPriceOverride) * Number(position.quantity)),
          feeUSD: this.simulator.estimateFee(Math.abs(Number(fillPriceOverride) * Number(position.quantity)), 'taker'),
          latencyMs: this.simulator.estimateLatencyMs(),
          simulatedAt: Date.now()
        }
      : this.simulator.simulateMarketOrder({
          symbol,
          direction: sideDirection,
          referencePrice,
          quantity: position.quantity
        });

    const close = {
      orderId: this._orderId(),
      parentOrderId: position.orderId,
      symbol,
      direction: sideDirection,
      status: 'FILLED',
      filledQty: position.quantity,
      avgFillPrice: fill.fillPrice,
      notionalUSD: fill.notionalUSD,
      feeUSD: fill.feeUSD,
      latencyMs: fill.latencyMs,
      closeReason: reason,
      simulatedAt: fill.simulatedAt
    };

    this.orders.set(close.orderId, close);
    this.positions.delete(symbol);
    if (this.collection) {
      await this.collection.updateOne({ _id: close.orderId }, { $set: { ...close, _id: close.orderId } }, { upsert: true });
    }
    return close;
  }

  async bootstrapLegacyPosition(trade) {
    if (!trade?.symbol || !(Number(trade.positionSizeUnits) > 0) || !(Number(trade.entry) > 0)) return null;
    if (this.positions.has(trade.symbol)) return this.positions.get(trade.symbol);
    const orderId = `PAPER-LEGACY-${trade.symbol}-${Date.now()}`;
    const order = {
      orderId,
      signalId: trade.signalId || `legacy:${trade.symbol}:${trade.startTime || Date.now()}`,
      symbol: trade.symbol,
      direction: trade.direction,
      status: 'FILLED',
      requestedQty: Number(trade.positionSizeUnits),
      filledQty: Number(trade.positionSizeUnits),
      requestedPrice: Number(trade.entry),
      avgFillPrice: Number(trade.entry),
      notionalUSD: Math.abs(Number(trade.entry) * Number(trade.positionSizeUnits)),
      feeUSD: Number(trade.entryFeeUSD || 0),
      latencyMs: 0,
      simulatedAt: Date.now(),
      closeReason: null,
      metadata: { legacyBootstrap: true }
    };
    this.orders.set(orderId, order);
    this.positions.set(trade.symbol, {
      symbol: trade.symbol,
      direction: trade.direction,
      quantity: Number(trade.positionSizeUnits),
      entryPrice: Number(trade.entry),
      orderId,
      signalId: order.signalId,
      updatedAt: Date.now()
    });
    if (this.collection) {
      await this.collection.updateOne({ _id: orderId }, { $set: { ...order, _id: orderId } }, { upsert: true });
    }
    this.logger.warn(`[PAPER EXECUTION] Legacy-Trade ${trade.symbol} als Paper-State übernommen.`);
    return this.positions.get(trade.symbol);
  }

  getPosition(symbol) {
    return this.positions.get(symbol) || null;
  }

  getPositions() {
    return [...this.positions.values()];
  }

  getOrders() {
    return [...this.orders.values()];
  }

  async restore() {
    if (!this.collection) return;
    const docs = await this.collection.find({ status: 'FILLED', symbol: { $exists: true } })
      .sort({ simulatedAt: 1 }).toArray();
    for (const doc of docs) {
      this.orders.set(doc.orderId || doc._id, doc);
      if (doc.closeReason) {
        const current = this.positions.get(doc.symbol);
        if (current) {
          const remaining = Number.isFinite(Number(doc.remainingQty))
            ? Number(doc.remainingQty)
            : 0;
          if (remaining > 0) {
            this.positions.set(doc.symbol, { ...current, quantity: remaining, updatedAt: doc.simulatedAt });
          } else {
            this.positions.delete(doc.symbol);
          }
        }
        continue;
      }
      this.positions.set(doc.symbol, {
        symbol: doc.symbol,
        direction: doc.direction,
        quantity: doc.filledQty,
        entryPrice: doc.avgFillPrice,
        orderId: doc.orderId || doc._id,
        signalId: doc.signalId,
        updatedAt: doc.simulatedAt
      });
    }
  }
}

module.exports = { PaperExecutionAdapter };
