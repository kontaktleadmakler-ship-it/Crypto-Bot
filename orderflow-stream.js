'use strict';
const axios = require('axios');

class KuCoinTradeStream {
  constructor({ symbol, logger = console, reconnectMs = 2500 } = {}) {
    this.symbol = symbol;
    this.logger = logger;
    this.reconnectMs = reconnectMs;
    this.ws = null;
    this.closed = false;
    this.trades = [];
    this.lastSequence = null;
  }

  async start() {
    if (!this.symbol) throw new Error('symbol required');
    this.closed = false;
    const { data } = await axios.post('https://api-futures.kucoin.com/api/v1/bullet-public', null, { timeout: 10000 });
    const token = data?.data?.token;
    const server = data?.data?.instanceServers?.[0];
    if (!token || !server?.endpoint) throw new Error('KuCoin public websocket token unavailable');
    const endpoint = `${server.endpoint}?token=${encodeURIComponent(token)}`;
    const WS = globalThis.WebSocket;
    if (!WS) throw new Error('Node WebSocket API unavailable; run on Node.js 20.10+ or install a WebSocket implementation');
    this.ws = new WS(endpoint);
    this.ws.onopen = () => this.ws.send(JSON.stringify({ id: String(Date.now()), type: 'subscribe', topic: `/contractMarket/execution:${this.symbol}`, response: true }));
    this.ws.onmessage = event => {
      try {
        const msg = JSON.parse(event.data);
        if (msg?.type !== 'message' || msg?.subject !== 'match') return;
        const d = msg.data || {};
        const trade = { symbol: d.symbol, side: d.side, size: Number(d.size), price: Number(d.price), tradeId: String(d.tradeId), sequence: Number(d.sequence), ts: Number(d.ts) };
        if (Number.isFinite(trade.sequence) && this.lastSequence != null && trade.sequence <= this.lastSequence) return;
        this.lastSequence = trade.sequence;
        this.trades.push(trade);
        if (this.trades.length > 5000) this.trades.splice(0, this.trades.length - 5000);
      } catch (e) { this.logger.warn?.(`[CVD] invalid WS message: ${e.message}`); }
    };
    this.ws.onerror = e => this.logger.warn?.(`[CVD] websocket error: ${e?.message || 'unknown'}`);
    this.ws.onclose = () => { if (!this.closed) setTimeout(() => this.start().catch(err => this.logger.warn?.(`[CVD] reconnect failed: ${err.message}`)), this.reconnectMs); };
    return this;
  }
  stop() { this.closed = true; try { this.ws?.close(); } catch (_) {} }
  drainTrades() { const out = this.trades; this.trades = []; return out; }
}
module.exports = { KuCoinTradeStream };
