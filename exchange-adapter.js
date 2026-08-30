/**
 * ExchangeAdapter.js
 * Vollständige, fehlerfreie Implementierung zur sicheren Ausführung von 
 * Klines- und Orderbook-Abfragen ohne ReferenceErrors ('resolve is not defined').
 */

export class ExchangeAdapter {
  constructor(client) {
    this.client = client;
  }

  /**
   * Zentraler Wrapper für Callback-basierte Client-Methoden.
   * Stellt sicher, dass 'resolve' und 'reject' in jedem Scope vorhanden sind.
   */
  _promisifyMethod(methodName, ...args) {
    return new Promise((resolve, reject) => {
      try {
        if (!this.client || typeof this.client[methodName] !== 'function') {
          return reject(new Error(`Methode '${methodName}' existiert nicht auf dem ExchangeClient.`));
        }

        this.client[methodName](...args, (err, data) => {
          if (err) {
            return reject(err);
          }
          return resolve(data);
        });
      } catch (err) {
        return reject(err);
      }
    });
  }

  /**
   * Sichere Ausführung einer Best-Effort Operation.
   * Fängt alle Rejections ab und verhindert den Abbruch des Scans.
   */
  async _bestEffort(asyncFn, fallbackValue) {
    return new Promise((resolve) => {
      try {
        asyncFn()
          .then((result) => resolve(result !== undefined ? result : fallbackValue))
          .catch((err) => {
            console.warn(`[RUNTIME] Best-effort operation failed: ${err.message}`);
            resolve(fallbackValue);
          });
      } catch (err) {
        console.warn(`[RUNTIME] Best-effort execution error: ${err.message}`);
        resolve(fallbackValue);
      }
    });
  }

  /**
   * Abrufen von Klines / Candlestick-Daten
   */
  async fetchKlines(symbol, timeframe = '15m', limit = 100) {
    return this._bestEffort(async () => {
      const data = await this._promisifyMethod('getKlines', symbol, timeframe, limit);
      if (!data || !Array.isArray(data) || data.length === 0) {
        throw new Error(`Keine Klines für ${symbol}/${timeframe} verfügbar.`);
      }
      return data;
    }, []);
  }

  /**
   * Abrufen von Orderbuch-Daten
   */
  async fetchOrderBook(symbol, limit = 20) {
    const defaultOrderBook = { bids: [], asks: [], isDefault: true };

    return this._bestEffort(async () => {
      const data = await this._promisifyMethod('getOrderBook', symbol, limit);
      if (!data || (!data.bids && !data.asks)) {
        throw new Error(`Orderbuch-Daten für ${symbol} unvollständig.`);
      }
      return {
        bids: data.bids || [],
        asks: data.asks || [],
        isDefault: false
      };
    }, defaultOrderBook);
  }
}

/**
 * Universal-Promisify Helper zur Behebung des 'resolve is not defined'-Fehlers 
 * in externen Modulen (z.B. utils/runtime.js oder Best-Effort Wrappern)
 */
export function safePromisify(fn, context = null) {
  return (...args) => {
    return new Promise((resolve, reject) => {
      try {
        fn.call(context, ...args, (err, res) => {
          if (err) {
            return reject(err);
          }
          return resolve(res);
        });
      } catch (err) {
        return reject(err);
      }
    });
  };
}
