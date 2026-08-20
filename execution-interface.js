'use strict';
const crypto = require('crypto');
const axios = require('axios');

class ExecutionHaltedError extends Error { constructor(message = 'Execution halted') { super(message); this.name = 'ExecutionHaltedError'; } }

class ExecutionInterface {
  constructor({ dryRun = true, killSwitch = true, logger = console } = {}) {
    this.dryRun = Boolean(dryRun);
    this.killSwitch = Boolean(killSwitch);
    this.logger = logger;
  }
  assertCanExecute(order) {
    if (this.killSwitch) throw new ExecutionHaltedError('Global kill-switch is active');
    if (!order?.symbol || !order?.side || !order?.type) throw new Error('Invalid order');
  }
  async placeOrder() { throw new Error('placeOrder() must be implemented by an exchange adapter'); }
  async cancelOrder() { throw new Error('cancelOrder() must be implemented by an exchange adapter'); }
  async cancelAll() { throw new Error('cancelAll() must be implemented by an exchange adapter'); }
}

class KuCoinFuturesExecution extends ExecutionInterface {
  constructor({ apiKey = '', apiSecret = '', apiPassphrase = '', baseUrl = 'https://api-futures.kucoin.com', ...opts } = {}) {
    super(opts); this.apiKey = apiKey; this.apiSecret = apiSecret; this.apiPassphrase = apiPassphrase; this.baseUrl = baseUrl;
  }
  _sign(timestamp, method, endpoint, body = '') {
    const raw = `${timestamp}${method}${endpoint}${body}`;
    const signature = crypto.createHmac('sha256', this.apiSecret).update(raw).digest('base64');
    const passphrase = crypto.createHmac('sha256', this.apiSecret).update(this.apiPassphrase).digest('base64');
    return { signature, passphrase };
  }
  async _request(method, endpoint, data) {
    this.assertCanExecute({ symbol: data?.symbol || 'n/a', side: data?.side || 'n/a', type: data?.type || 'n/a' });
    const body = data ? JSON.stringify(data) : '';
    const ts = Date.now().toString();
    const s = this._sign(ts, method, endpoint, body);
    const res = await axios({ method, url: `${this.baseUrl}${endpoint}`, data, headers: { 'KC-API-KEY': this.apiKey, 'KC-API-SIGN': s.signature, 'KC-API-TIMESTAMP': ts, 'KC-API-PASSPHRASE': s.passphrase, 'KC-API-KEY-VERSION': '2', 'Content-Type': 'application/json' }, timeout: 15000 });
    return res.data;
  }
  async placeOrder(order) { this.assertCanExecute(order); if (this.dryRun) return { dryRun: true, clientOid: order.clientOid || crypto.randomUUID(), order }; return this._request('POST', '/api/v1/orders', order); }
  async testOrder(order) { if (this.killSwitch) throw new ExecutionHaltedError(); return this._request('POST', '/api/v1/orders/test', order); }
  async cancelOrder(orderId) { if (this.dryRun) return { dryRun: true, orderId }; return this._request('DELETE', `/api/v1/orders/${encodeURIComponent(orderId)}`); }
  async cancelAll(symbol) { if (this.dryRun) return { dryRun: true, symbol }; const q = symbol ? `?symbol=${encodeURIComponent(symbol)}` : ''; return this._request('DELETE', `/api/v3/orders${q}`, { symbol }); }
  async getOrder(orderId) { if (this.dryRun) return { dryRun: true, orderId, status: 'simulated' }; const ts = Date.now().toString(); const endpoint = `/api/v1/orders/${encodeURIComponent(orderId)}`; const s = this._sign(ts, 'GET', endpoint, ''); const res = await axios.get(`${this.baseUrl}${endpoint}`, { headers: { 'KC-API-KEY': this.apiKey, 'KC-API-SIGN': s.signature, 'KC-API-TIMESTAMP': ts, 'KC-API-PASSPHRASE': s.passphrase, 'KC-API-KEY-VERSION': '2' }, timeout: 15000 }); return res.data; }
}

class ExecutionRouter {
  constructor(adapters = []) { this.adapters = adapters; }
  async route(order) {
    const quotes = this.adapters.map(a => ({ adapter: a, quote: a.getQuote ? a.getQuote(order.symbol) : null })).filter(x => x.quote);
    if (!quotes.length) throw new Error('No execution venue with quote');
    const best = order.side === 'buy' ? quotes.reduce((a, b) => a.quote.ask < b.quote.ask ? a : b) : quotes.reduce((a, b) => a.quote.bid > b.quote.bid ? a : b);
    return best.adapter.placeOrder(order);
  }
}

module.exports = { ExecutionInterface, KuCoinFuturesExecution, ExecutionRouter, ExecutionHaltedError };
