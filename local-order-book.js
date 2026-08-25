'use strict';

/**
 * Step 4 - Deterministic local L2 order book.
 * Never applies a delta across a sequence gap. A gap invalidates the book
 * until a fresh snapshot is installed and subsequent deltas validate.
 */
class LocalOrderBook {
  constructor({ symbol, logger = console, maxAgeMs = 1500, onInvalid } = {}) {
    if (!symbol) throw new Error('SYMBOL_REQUIRED');
    this.symbol = symbol;
    this.logger = logger;
    this.maxAgeMs = Number(maxAgeMs) > 0 ? Number(maxAgeMs) : 1500;
    this.onInvalid = onInvalid;
    this.reset('INIT');
  }

  reset(reason = 'RESET') {
    this.bids = new Map();
    this.asks = new Map();
    this.sequence = null;
    this.valid = false;
    this.state = 'GAP';
    this.reason = reason;
    this.updatedAt = 0;
  }

  _invalidate(reason) {
    this.valid = false;
    this.state = 'GAP';
    this.reason = reason;
    this.logger.warn?.(`[L2:${this.symbol}] MARKET_DATA_INVALID: ${reason}`);
    try { this.onInvalid?.({ symbol: this.symbol, reason, sequence: this.sequence }); } catch (_) {}
  }

  _levels(target, levels = []) {
    target.clear();
    for (const level of levels) {
      const price = Number(level?.[0]);
      const size = Number(level?.[1]);
      if (!(price > 0) || !Number.isFinite(size) || size < 0) continue;
      if (size > 0) target.set(price, size);
    }
  }

  applySnapshot({ bids = [], asks = [], sequence, timestamp = Date.now() } = {}) {
    const seq = Number(sequence);
    if (!Number.isSafeInteger(seq) || seq < 0) {
      this._invalidate('SNAPSHOT_SEQUENCE_MISSING');
      return false;
    }
    this._levels(this.bids, bids);
    this._levels(this.asks, asks);
    if (!this.bids.size || !this.asks.size) {
      this._invalidate('SNAPSHOT_EMPTY');
      return false;
    }
    this.sequence = seq;
    this.updatedAt = Number(timestamp) || Date.now();
    this.valid = true;
    this.state = 'SYNCED';
    this.reason = null;
    return true;
  }

  applyDelta({ sequenceStart, sequenceEnd, bids = [], asks = [], timestamp = Date.now() } = {}) {
    if (!this.valid || this.sequence == null) {
      this._invalidate('DELTA_BEFORE_SNAPSHOT');
      return false;
    }
    const start = Number(sequenceStart);
    const end = Number(sequenceEnd);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) {
      this._invalidate('INVALID_DELTA_SEQUENCE');
      return false;
    }

    const expected = this.sequence + 1;
    if (start > expected || end < expected) {
      this._invalidate(`SEQUENCE_GAP_EXPECTED_${expected}_GOT_${start}_${end}`);
      return false;
    }
    if (start <= this.sequence) {
      if (end <= this.sequence) return true; // duplicate/stale delta
      this._invalidate(`OVERLAPPING_DELTA_${start}_${end}_AFTER_${this.sequence}`);
      return false;
    }

    for (const [p, q] of bids) this._set(this.bids, p, q);
    for (const [p, q] of asks) this._set(this.asks, p, q);
    this.sequence = end;
    this.updatedAt = Number(timestamp) || Date.now();
    if (!this.bids.size || !this.asks.size) {
      this._invalidate('BOOK_EMPTY_AFTER_DELTA');
      return false;
    }
    const top = this.top();
    if (!(top.bestBid > 0) || !(top.bestAsk > 0) || top.bestAsk < top.bestBid) {
      this._invalidate('CROSSED_OR_INVALID_BOOK');
      return false;
    }
    return true;
  }

  _set(map, priceRaw, sizeRaw) {
    const price = Number(priceRaw);
    const size = Number(sizeRaw);
    if (!(price > 0) || !Number.isFinite(size) || size < 0) {
      this._invalidate('INVALID_LEVEL');
      return;
    }
    if (size === 0) map.delete(price);
    else map.set(price, size);
  }

  top(depth = 10) {
    const bids = [...this.bids.entries()].sort((a, b) => b[0] - a[0]).slice(0, depth);
    const asks = [...this.asks.entries()].sort((a, b) => a[0] - b[0]).slice(0, depth);
    const bestBid = bids[0]?.[0] || 0;
    const bestAsk = asks[0]?.[0] || 0;
    const bidVolume = bids.reduce((s, [, q]) => s + q, 0);
    const askVolume = asks.reduce((s, [, q]) => s + q, 0);
    const spreadPct = bestBid > 0 && bestAsk >= bestBid ? ((bestAsk - bestBid) / bestBid) * 100 : Infinity;
    return {
      bestBid, bestAsk, bidVolume, askVolume,
      bidAskRatio: askVolume > 0 ? bidVolume / askVolume : null,
      spreadPct,
      sequence: this.sequence,
      updatedAt: this.updatedAt,
      ageMs: this.updatedAt ? Math.max(0, Date.now() - this.updatedAt) : Infinity
    };
  }

  metrics(depth = 10) {
    const top = this.top(depth);
    const fresh = top.ageMs <= this.maxAgeMs;
    const valid = this.valid && this.state === 'SYNCED' && fresh && Number.isFinite(top.spreadPct) && top.bestBid > 0 && top.bestAsk >= top.bestBid;
    return { ...top, fresh, valid, state: this.state, reason: this.reason, source: 'local_l2' };
  }
}

module.exports = { LocalOrderBook };
