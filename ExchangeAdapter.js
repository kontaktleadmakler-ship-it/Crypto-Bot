// ExchangeAdapter.js / ExchangeAdapter.ts Hotfix
// Problem: 'ReferenceError: resolve is not defined' in fetchKlines/getKlines Promise wrapper.

export class ExchangeAdapter {
  constructor(client) {
    self.client = client;
  }

  /**
   * Fetches Kline / Candle data for a symbol and timeframe
   * @param {string} symbol - e.g. 'BTC-USDT'
   * @param {string} timeframe - e.g. '15m'
   * @returns {Promise<Array>}
   */
  async fetchKlines(symbol, timeframe = '15m', limit = 100) {
    return new Promise((resolve, reject) => { // FIX: Ensure (resolve, reject) are properly declared in Promise callback
      try {
        this.client.getKlines(symbol, timeframe, limit, (err, data) => {
          if (err) {
            return reject(err);
          }
          if (!data) {
            return resolve([]);
          }
          return resolve(data); // FIX: resolve is now defined in scope
        });
      } catch (error) {
        reject(error);
      }
    });
  }
}
