'use strict';

/**
 * Normalized bridge between a websocket transport and OrderBookEngine.
 * Exchange-specific adapters only need to map their messages to:
 * {type:'snapshot'|'delta', symbol, sequence/sequenceStart/sequenceEnd,bids,asks}
 */
class SequencedOrderBookBridge {
  constructor({ ws, engine, snapshotProvider, logger = console } = {}) {
    if (!ws || !engine) throw new Error('WS_AND_ENGINE_REQUIRED');
    this.ws = ws;
    this.engine = engine;
    this.snapshotProvider = snapshotProvider;
    this.logger = logger;
    this._onMessage = this._onMessage.bind(this);
    this._onGap = this._onGap.bind(this);
    this.ws.on?.('message', this._onMessage);
    this.engine.on?.('gap', this._onGap);
  }

  async _onGap(info) {
    if (typeof this.snapshotProvider !== 'function') return;
    try {
      const snapshot = await this.snapshotProvider(info.symbol);
      if (!snapshot || !this.engine.installSnapshot(info.symbol, snapshot)) {
        this.logger.error?.(`[L2] snapshot recovery failed for ${info.symbol}`);
      }
    } catch (err) {
      this.logger.error?.(`[L2] snapshot recovery error ${info.symbol}: ${err.message}`);
    }
  }

  _onMessage(payload) {
    const m = payload?.data || payload;
    if (!m?.symbol) return;
    try {
      if (m.type === 'snapshot' || m.kind === 'snapshot') {
        this.engine.installSnapshot(m.symbol, {
          sequence: m.sequence,
          bids: m.bids || [], asks: m.asks || [], timestamp: m.timestamp || Date.now()
        });
        return;
      }
      if (m.type === 'delta' || m.kind === 'delta') {
        this.engine.applyDelta(m.symbol, {
          sequenceStart: m.sequenceStart,
          sequenceEnd: m.sequenceEnd,
          bids: m.bids || [], asks: m.asks || [], timestamp: m.timestamp || Date.now()
        });
      }
    } catch (err) {
      this.logger.warn?.(`[L2] invalid normalized message: ${err.message}`);
    }
  }

  close() {
    this.ws.off?.('message', this._onMessage);
    this.engine.off?.('gap', this._onGap);
  }
}

module.exports = { SequencedOrderBookBridge };
