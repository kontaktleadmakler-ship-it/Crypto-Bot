/**
 * v22.5 B9 - Market Data WebSocket Adapter
 * Market-data only. No order/execution functionality.
 */
'use strict';

const EventEmitter = require('events');

class MarketDataWebSocket extends EventEmitter {
  constructor({ logger = console, reconnectBaseMs = 1000, reconnectMaxMs = 30000 } = {}) {
    super();
    this.logger = logger;
    this.reconnectBaseMs = reconnectBaseMs;
    this.reconnectMaxMs = reconnectMaxMs;
    this.ws = null;
    this.url = null;
    this.connected = false;
    this.closedByUser = false;
    this.retry = 0;
    this.subscriptions = new Set();
    this._connectTimer = null;
  }

  async connect(url) {
    if (!url) throw new Error('WS_URL_REQUIRED');
    this.url = url;
    this.closedByUser = false;
    return this._open();
  }

  subscribe(channel) {
    this.subscriptions.add(channel);
    if (this.connected) this._send({ type: 'subscribe', channel });
  }

  unsubscribe(channel) {
    this.subscriptions.delete(channel);
    if (this.connected) this._send({ type: 'unsubscribe', channel });
  }

  _send(payload) {
    if (!this.ws || !this.connected) return false;
    try {
      this.ws.send(JSON.stringify(payload));
      return true;
    } catch (err) {
      this.logger.warn?.(`[WS] send failed: ${err.message}`);
      return false;
    }
  }

  async _open() {
    let WebSocket;
    try {
      WebSocket = require('ws');
    } catch {
      throw new Error('WS_PACKAGE_REQUIRED');
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(this.url);
      this.ws = ws;

      ws.on('open', () => {
        this.connected = true;
        this.retry = 0;
        for (const channel of this.subscriptions) this._send({ type: 'subscribe', channel });
        this.emit('connected');
        if (!settled) { settled = true; resolve(); }
      });

      ws.on('message', raw => {
        try {
          const payload = JSON.parse(raw.toString());
          this.emit('message', payload);
        } catch (err) {
          this.logger.warn?.(`[WS] invalid JSON message: ${err.message}`);
        }
      });

      ws.on('error', err => {
        this.emit('error', err);
        if (!settled) { settled = true; reject(err); }
      });

      ws.on('close', (code, reason) => {
        this.connected = false;
        this.emit('disconnected', { code, reason: reason?.toString?.() || '' });
        if (!this.closedByUser) this._scheduleReconnect();
      });
    });
  }

  _scheduleReconnect() {
    if (this._connectTimer) return;
    const delay = Math.min(this.reconnectBaseMs * (2 ** this.retry), this.reconnectMaxMs);
    this.retry += 1;
    this._connectTimer = setTimeout(async () => {
      this._connectTimer = null;
      try { await this._open(); }
      catch (err) { this.logger.warn?.(`[WS] reconnect failed: ${err.message}`); this._scheduleReconnect(); }
    }, delay);
    this._connectTimer.unref?.();
  }

  close() {
    this.closedByUser = true;
    if (this._connectTimer) clearTimeout(this._connectTimer);
    this._connectTimer = null;
    try { this.ws?.close(); } catch {}
    this.ws = null;
    this.connected = false;
  }
}

module.exports = { MarketDataWebSocket };
