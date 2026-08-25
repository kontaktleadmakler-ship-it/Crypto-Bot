'use strict';

const EventEmitter = require('events');
const { LocalOrderBook } = require('./local-order-book');

/**
 * Step 4 orchestration: WS -> sequence validation -> gap detection -> local L2
 * -> freshness -> strategy-facing metrics. Any gap pauses the symbol until a
 * new sequenced snapshot is installed.
 */
class OrderBookEngine extends EventEmitter {
  constructor({ logger = console, maxAgeMs = 1500, depth = 10, onTradingPause } = {}) {
    super();
    this.logger = logger;
    this.maxAgeMs = maxAgeMs;
    this.depth = depth;
    this.onTradingPause = onTradingPause;
    this.books = new Map();
    this.pausedSymbols = new Set();
  }

  get(symbol) {
    if (!this.books.has(symbol)) {
      const book = new LocalOrderBook({
        symbol, logger: this.logger, maxAgeMs: this.maxAgeMs
      });
      this.books.set(symbol, book);
    }
    return this.books.get(symbol);
  }

  _pause(info) {
    this.pausedSymbols.add(info.symbol);
    this.emit('gap', info);
    try { this.onTradingPause?.(info); } catch (_) {}
  }

  installSnapshot(symbol, snapshot) {
    const ok = this.get(symbol).applySnapshot(snapshot);
    if (!ok) { this._pause({ symbol, reason: this.get(symbol).reason }); return false; }
    this.pausedSymbols.delete(symbol);
    this.emit('resumed', { symbol, sequence: this.get(symbol).sequence });
    return true;
  }

  applyDelta(symbol, delta) {
    const book = this.get(symbol);
    const ok = book.applyDelta(delta);
    if (!ok) this._pause({ symbol, reason: book.reason });
    return ok;
  }

  metrics(symbol) {
    const book = this.get(symbol);
    const metrics = book.metrics(this.depth);
    if (!metrics.valid) this.pausedSymbols.add(symbol);
    return { ...metrics, tradingPaused: this.pausedSymbols.has(symbol) };
  }

  isTradable(symbol) {
    const m = this.metrics(symbol);
    return m.valid && !m.tradingPaused;
  }

  isPaused(symbol) {
    return this.pausedSymbols.has(symbol);
  }

  invalidate(symbol, reason = 'MANUAL_INVALIDATION') {
    const book = this.get(symbol);
    book.reset(reason);
    this._pause({ symbol, reason });
  }
}

module.exports = { OrderBookEngine };
