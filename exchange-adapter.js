// ExchangeAdapter.js - Vollständiger Hotfix für alle Klines- & OrderBook-Requests

export class ExchangeAdapter {
  constructor(client) {
    this.client = client;
  }

  /**
   * Zentraler Request-Wrapper (Behebt 'resolve is not defined' global)
   */
  async _safeRequest(apiMethod, ...args) {
    return new Promise((resolve, reject) => { // Beachte: 'resolve' und 'reject' explizit benannt
      try {
        if (typeof this.client[apiMethod] !== 'function') {
          return reject(new Error(`Methode ${apiMethod} existiert nicht auf Exchange-Client.`));
        }

        this.client[apiMethod](...args, (err, data) => {
          if (err) {
            return reject(err);
          }
          return resolve(data); // 'resolve' ist jetzt im gesamten Scope definiert
        });
      } catch (error) {
        return reject(error);
      }
    });
  }

  /**
   * Holen von Klines / Candlestick Daten
   */
  async fetchKlines(symbol, timeframe = '15m', limit = 100) {
    try {
      const data = await this._safeRequest('getKlines', symbol, timeframe, limit);
      return data || [];
    } catch (error) {
      console.warn(`[ExchangeAdapter] Klines ${symbol}/${timeframe} fehlgeschlagen:`, error.message);
      return [];
    }
  }

  /**
   * Holen von Orderbuch-Daten
   */
  async fetchOrderBook(symbol, limit = 20) {
    try {
      const data = await this._safeRequest('getOrderBook', symbol, limit);
      return data || { bids: [], asks: [] };
    } catch (error) {
      console.warn(`[ExchangeAdapter] OrderBook ${symbol} fehlgeschlagen:`, error.message);
      return { bids: [], asks: [], fallback: true };
    }
  }
}

/**
   Globaler Promise-Helper (falls in utils/promisify.js oder runtime.js genutzt)
 */
export const promisify = (fn, context = null) => {
  return (...args) => {
    return new Promise((resolve, reject) => { // 'resolve' explizit deklariert
      fn.call(context, ...args, (err, result) => {
        if (err) {
          return reject(err);
        }
        return resolve(result);
      });
    });
  };
};
