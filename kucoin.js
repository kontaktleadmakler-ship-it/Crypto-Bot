'use strict';

const axios = require('axios');

/**
 * KuCoin market-data client.
 * // SAFETY: this module intentionally exposes GET-only methods. No order,
 * cancel, amend, or other trading endpoint exists here.
 */
class KucoinApi {
  constructor({ logger = console, baseUrl = 'https://api-futures.kucoin.com', maxRetries = 2, circuitThreshold = 8, cooldownMs = 15000 } = {}) {
    this.logger = logger; this.baseUrl = baseUrl.replace(/\/$/, '');
    this.maxRetries = maxRetries; this.circuitThreshold = circuitThreshold; this.cooldownMs = cooldownMs;
    this.errors = 0; this.openUntil = 0;
  }
  _assertCircuit() {
    if (Date.now() < this.openUntil) throw new Error('KuCoin market-data circuit breaker open');
  }
  async get(path, options = {}) {
    this._assertCircuit();
    let last;
    for (let attempt = 1; attempt <= this.maxRetries + 1; attempt++) {
      try {
        const response = await axios.get(`${this.baseUrl}${path}`, { timeout: options.timeout ?? 10000, params: options.params, headers: options.headers });
        this.errors = 0; this.openUntil = 0; return response;
      } catch (e) {
        last = e;
        // Do not trip a global market-data breaker on deterministic client
        // errors (4xx). Only transient network/rate/server failures count.
        const status = Number(e?.response?.status || 0);
        const transient = !status || status === 408 || status === 425 || status === 429 || status >= 500;
        if (transient) this.errors++;
        else this.errors = 0;
        if (transient && this.errors >= this.circuitThreshold) {
          this.openUntil = Date.now() + this.cooldownMs;
          this.logger?.warn?.(`[KuCoinApi] circuit opened for ${this.cooldownMs}ms after ${this.errors} transient failures`);
        }
        if (attempt <= this.maxRetries) await new Promise(r => setTimeout(r, Math.min(4000, 350 * 2 ** (attempt - 1))));
      }
    }
    throw last;
  }
  async health() { const r = await this.get('/api/v1/ticker?symbol=XBTUSDTM'); return r.data?.code === '200000'; }
  async klines({ symbol, granularity = 15, from, to, limit = 60 }) {
    const futuresSymbol = symbol === 'BTC-USDT' ? 'XBTUSDTM' : `${String(symbol).split('-')[0]}USDTM`;
    const r = await this.get('/api/v1/kline/query', { params: { symbol: futuresSymbol, granularity, from, to } });
    const rows = Array.isArray(r.data?.data) ? r.data.data : [];
    return rows.slice(0, -1).slice(-limit).map(c => ({
      time:Number(c[0]), open:Number(c[1]), high:Number(c[2]), low:Number(c[3]), close:Number(c[4]), volume:Number(c[5])
    }));
  }
  async fundingRates({ symbol, from, to }) {
    const futuresSymbol = symbol === 'BTC-USDT' ? 'XBTUSDTM' : `${String(symbol).split('-')[0]}USDTM`;
    const r = await this.get('/api/v1/contract/funding-rates', { params: { symbol:futuresSymbol, from, to } });
    return (r.data?.data || []).map(x => ({ time:Number(x.timepoint ?? x.fundingTime ?? x.time), fundingRate:Number(x.fundingRate) }))
      .filter(x => Number.isFinite(x.time) && Number.isFinite(x.fundingRate));
  }
}
module.exports = { KucoinApi };
