'use strict';

/**
 * Exchange Adapter Layer – v22.3
 *
 * Production-oriented abstraction for exchange market data.
 * IMPORTANT: This bot is signal-only/paper-trading. Order execution is
 * intentionally NOT implemented here. Any execution call fails closed.
 */

class ExchangeAdapter {
  constructor({ name, logger }) {
    if (!name) throw new Error('ExchangeAdapter requires name');
    this.name = name;
    this.logger = logger || console;
  }

  getCapabilities() {
    return {
      marketData: false,
      accountData: false,
      execution: false,
      websocket: false,
    };
  }

  async healthCheck() {
    throw new Error(`${this.name}: healthCheck not implemented`);
  }

  async getKlines() { throw new Error(`${this.name}: getKlines not implemented`); }
  async getTicker() { throw new Error(`${this.name}: getTicker not implemented`); }
  async getMarkPrice() { throw new Error(`${this.name}: getMarkPrice not implemented`); }
  async getContract() { throw new Error(`${this.name}: getContract not implemented`); }
  async getOrderBook() { throw new Error(`${this.name}: getOrderBook not implemented`); }
  async getActiveContracts() { throw new Error(`${this.name}: getActiveContracts not implemented`); }
  async getTopSpotPairs() { throw new Error(`${this.name}: getTopSpotPairs not implemented`); }

  // Explicitly disabled for this signal-only system.
  async placeOrder() { throw new Error('ORDER_EXECUTION_DISABLED: signal-only/paper-trading bot'); }
  async cancelOrder() { throw new Error('ORDER_EXECUTION_DISABLED: signal-only/paper-trading bot'); }
  async getOrders() { throw new Error('ORDER_EXECUTION_DISABLED: account/order endpoints disabled'); }
}

class KuCoinFuturesAdapter extends ExchangeAdapter {
  constructor({ logger, request, futuresRequest, getFuturesSymbol, parseFloatSafe, config }) {
    super({ name: 'kucoin-futures', logger });
    this.request = request;
    this.futuresRequest = futuresRequest;
    this.getFuturesSymbol = getFuturesSymbol;
    this.parseFloatSafe = parseFloatSafe;
    this.config = config || {};
    this.marketDataTimeoutMs = Number(this.config.KUCOIN_MARKET_DATA_TIMEOUT_MS || 7000);
    this.marketDataRetries = Number.isInteger(Number(this.config.KUCOIN_MARKET_DATA_RETRIES)) ? Number(this.config.KUCOIN_MARKET_DATA_RETRIES) : 0;
    this.granularityMinutes = { '1d': 1440, '4h': 240, '1h': 60, '15m': 15, '5m': 5, '1m': 1 };
  }

  getCapabilities() {
    return {
      marketData: true,
      accountData: false,
      execution: false,
      websocket: false,
      futures: true,
      orderBook: true,
    };
  }

  async healthCheck() {
    const started = Date.now();
    const url = 'https://api-futures.kucoin.com/api/v1/contracts/active';
    const res = await this.futuresRequest(url, { timeout: this.marketDataTimeoutMs, retryCount: this.marketDataRetries });
    if (res?.data?.code !== '200000' || !Array.isArray(res.data.data)) {
      throw new Error('KuCoin Futures health check returned invalid response');
    }
    return { ok: true, latencyMs: Date.now() - started, contracts: res.data.data.length };
  }

  async getKlines(symbol, timeframe = '15m', limit = 100) {
    const granularity = this.granularityMinutes[timeframe];
    const futuresSymbol = this.getFuturesSymbol(symbol);
    if (!granularity || !futuresSymbol) return null;

    const now = Date.now();
    const timeframeMs = granularity * 60_000;
    const from = now - (limit + 10) * timeframeMs;
    const to = now;
    const url = `https://api-futures.kucoin.com/api/v1/kline/query?symbol=${futuresSymbol}&granularity=${granularity}&from=${from}&to=${to}`;
    const res = await this.futuresRequest(url, { timeout: this.marketDataTimeoutMs, retryCount: this.marketDataRetries });
    if (res?.data?.code !== '200000' || !Array.isArray(res.data.data)) return null;

    const context = `${futuresSymbol}/${timeframe}`;
    return res.data.data.map(c => {
      const time = parseInt(c[0], 10);
      const open = this.parseFloatSafe(c[1], 'open', context);
      const high = this.parseFloatSafe(c[2], 'high', context);
      const low = this.parseFloatSafe(c[3], 'low', context);
      const close = this.parseFloatSafe(c[4], 'close', context);
      const volume = this.parseFloatSafe(c[5], 'volume', context);
      if (!Number.isFinite(time) || [open, high, low, close, volume].some(v => v === null || !Number.isFinite(v))) return null;
      return { time, open, high, low, close, volume };
    }).filter(Boolean)
      .sort((a, b) => a.time - b.time)
      // KuCoin timestamps are candle OPEN timestamps. Never use a forming candle.
      .filter(c => c.time + timeframeMs <= now)
      .slice(-limit);
  }

  async getTicker(symbol) {
    const futuresSymbol = this.getFuturesSymbol(symbol);
    if (!futuresSymbol) return null;
    const url = `https://api-futures.kucoin.com/api/v1/ticker?symbol=${futuresSymbol}`;
    const res = await this.futuresRequest(url, { timeout: Math.min(this.marketDataTimeoutMs, 4000), retryCount: this.marketDataRetries });
    if (res?.data?.code === '200000' && res.data.data?.price != null) {
      return this.parseFloatSafe(res.data.data.price, 'tickerPrice', futuresSymbol);
    }
    return null;
  }

  async getMarkPrice(symbol) {
    const futuresSymbol = this.getFuturesSymbol(symbol);
    if (!futuresSymbol) return null;
    const url = `https://api-futures.kucoin.com/api/v1/mark-price/${futuresSymbol}/current`;
    const res = await this.futuresRequest(url, { timeout: Math.min(this.marketDataTimeoutMs, 4000), retryCount: this.marketDataRetries });
    if (res?.data?.code === '200000' && res.data.data?.value != null) {
      return this.parseFloatSafe(res.data.data.value, 'markPrice', futuresSymbol);
    }
    return null;
  }

  async getContract(symbol) {
    const futuresSymbol = this.getFuturesSymbol(symbol);
    if (!futuresSymbol) return null;
    const url = `https://api-futures.kucoin.com/api/v1/contracts/${futuresSymbol}`;
    const res = await this.futuresRequest(url, { timeout: Math.min(this.marketDataTimeoutMs, 4000), retryCount: this.marketDataRetries });
    if (res?.data?.code !== '200000' || !res.data.data) return null;
    const oi = this.parseFloatSafe(res.data.data.openInterestVal ?? res.data.data.openInterest, 'openInterest', symbol);
    const funding = this.parseFloatSafe(res.data.data.fundingFeeRate, 'fundingRate', symbol);
    return { openInterest: oi ?? 0, fundingRate: funding ?? 0 };
  }

  async getOrderBook(symbol) {
    const futuresSymbol = this.getFuturesSymbol(symbol);
    if (!futuresSymbol) return null;
    const url = `https://api-futures.kucoin.com/api/v1/level2/snapshot?symbol=${futuresSymbol}`;
    const res = await this.futuresRequest(url, { timeout: Math.min(this.marketDataTimeoutMs, 3000), retryCount: this.marketDataRetries });
    if (res?.data?.code !== '200000' || !res.data.data) return null;
    const bids = res.data.data.bids || [];
    const asks = res.data.data.asks || [];
    if (!bids.length || !asks.length) return null;

    const bestBid = Number(bids[0][0]);
    const bestAsk = Number(asks[0][0]);
    if (!(bestBid > 0) || !(bestAsk > 0) || bestAsk < bestBid) return null;
    const depth = Number(this.config.ORDERBOOK_DEPTH_LEVELS) || 10;
    const bidVolume = bids.slice(0, depth).reduce((s, [, size]) => s + Number(size || 0), 0);
    const askVolume = asks.slice(0, depth).reduce((s, [, size]) => s + Number(size || 0), 0);
    return {
      bestBid,
      bestAsk,
      spreadPct: ((bestAsk - bestBid) / bestBid) * 100,
      bidAskRatio: askVolume > 0 ? bidVolume / askVolume : null,
      bidVolume,
      askVolume,
    };
  }

  async getActiveContracts() {
    const url = 'https://api-futures.kucoin.com/api/v1/contracts/active';
    const res = await this.futuresRequest(url, { timeout: Math.max(this.marketDataTimeoutMs, 8000), retryCount: this.marketDataRetries });
    if (res?.data?.code !== '200000' || !Array.isArray(res.data.data)) return [];
    return res.data.data;
  }

  async getTopSpotPairs(limit = 100) {
    const url = 'https://api.kucoin.com/api/v1/market/allTickers';
    const res = await this.request(url, { timeout: 6000 });
    if (res?.data?.code !== '200000' || !Array.isArray(res.data.data?.ticker)) return [];
    const blacklist = ['USDC-USDT', 'FDUSD-USDT', 'TUSD-USDT', 'EUR-USDT', 'DAI-USDT', 'USDP-USDT', 'KCS-USDT', 'WBTC-USDT'];
    return res.data.data.ticker
      .filter(x => x.symbol?.endsWith('-USDT') && !blacklist.includes(x.symbol) && !x.symbol.includes('3L') && !x.symbol.includes('3S'))
      .sort((a, b) => Number(b.volValue || 0) - Number(a.volValue || 0))
      .slice(0, limit)
      .map(x => x.symbol);
  }
}

module.exports = { ExchangeAdapter, KuCoinFuturesAdapter };
