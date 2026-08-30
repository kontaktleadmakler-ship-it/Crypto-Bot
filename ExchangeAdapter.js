'use strict';

/**
 * Compatibility adapter for legacy imports.
 * The live runtime uses ./exchange-adapter.js (KuCoinFuturesAdapter).
 * Keep this module CommonJS-compatible so dashboard/runtime helper imports
 * cannot fail with ESM/CJS or Promise-scope errors.
 */

class ExchangeAdapter {
  constructor(client) {
    this.client = client;
  }

  _promisifyMethod(methodName, ...args) {
    return new Promise((resolve, reject) => {
      try {
        if (!this.client || typeof this.client[methodName] !== 'function') {
          return reject(new Error(`Methode '${methodName}' existiert nicht auf dem ExchangeClient.`));
        }
        this.client[methodName](...args, (err, data) => {
          if (err) return reject(err);
          resolve(data);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  async fetchKlines(symbol, timeframe = '15m', limit = 100) {
    try {
      const data = await this._promisifyMethod('getKlines', symbol, timeframe, limit);
      return Array.isArray(data) ? data : [];
    } catch (err) {
      return [];
    }
  }

  async fetchOrderBook(symbol, limit = 20) {
    try {
      const data = await this._promisifyMethod('getOrderBook', symbol, limit);
      return {
        bids: Array.isArray(data?.bids) ? data.bids : [],
        asks: Array.isArray(data?.asks) ? data.asks : [],
        isDefault: false
      };
    } catch (err) {
      return { bids: [], asks: [], isDefault: true };
    }
  }
}

function safePromisify(fn, context = null) {
  if (typeof fn !== 'function') throw new TypeError('safePromisify requires a function');
  return (...args) => new Promise((resolve, reject) => {
    try {
      fn.call(context, ...args, (err, result) => {
        if (err) return reject(err);
        resolve(result);
      });
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { ExchangeAdapter, safePromisify };
