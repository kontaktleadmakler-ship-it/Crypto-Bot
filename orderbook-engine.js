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
    // FIX 2026-08-29: no websocket feed is currently wired to this engine in
    // production (SequencedOrderBookBridge is never instantiated), so every
    // symbol's book stays permanently empty. Without this tracking, the very
    // first isTradable() call on any never-fed symbol self-poisons it into
    // pausedSymbols (see metrics() below) and callers give up instead of
    // using the REST fallback - meaning orderBookMetrics is always null for
    // every symbol, forever. fedSymbols lets callers distinguish "genuinely
    // paused after a real feed/gap" from "never had a feed to begin with".
    this.fedSymbols = new Set();
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

  // True once this symbol has received at least one real snapshot/delta from
  // a live feed. False for a symbol nobody has ever pushed data for.
  hasFeed(symbol) {
    return this.fedSymbols.has(symbol);
  }

  _pause(info) {
    this.pausedSymbols.add(info.symbol);
    this.emit('gap', info);
    try { this.onTradingPause?.(info); } catch (_) {}
  }

  installSnapshot(symbol, snapshot) {
    this.fedSymbols.add(symbol);
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
    // Only latch a symbol into pausedSymbols on invalid metrics if it has
    // actually been fed real data at some point. A symbol nobody ever fed
    // is simply "no data yet", not "paused due to a gap/failure" - treating
    // it as paused permanently blocks the REST fallback for no reason.
    if (!metrics.valid && this.fedSymbols.has(symbol)) this.pausedSymbols.add(symbol);
    return { ...metrics, tradingPaused: this.pausedSymbols.has(symbol) };
  }

  isTradable(symbol) {
    const m = this.metrics(symbol);
    return m.valid && !m.tradingPaused;
  }

  isPaused(symbol) {
    // Never fed -> not "paused", just has no WS data. Lets callers fall
    // back to REST instead of giving up.
    if (!this.fedSymbols.has(symbol)) return false;
    return this.pausedSymbols.has(symbol);
  }

  invalidate(symbol, reason = 'MANUAL_INVALIDATION') {
    const book = this.get(symbol);
    book.reset(reason);
    this._pause({ symbol, reason });
  }
}

module.exports = { OrderBookEngine };
