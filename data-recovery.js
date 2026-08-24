'use strict';

class DataRecovery {
  constructor({ fetcher, logger = console, retries = 3, backoffMs = 500, limits = [100, 200, 300] } = {}) {
    this.fetcher = fetcher; this.logger = logger; this.retries = retries; this.backoffMs = backoffMs; this.limits = limits;
  }
  async get(symbol, timeframe, preferredLimit = 100) {
    let lastReason = 'missing-data';
    const limits = [...new Set([preferredLimit, ...this.limits])];
    for (let attempt = 0; attempt < Math.max(this.retries, limits.length); attempt++) {
      const limit = limits[Math.min(attempt, limits.length - 1)];
      try {
        const rows = await this.fetcher(symbol, timeframe, limit);
        if (Array.isArray(rows) && rows.length >= Math.min(20, preferredLimit)) return { rows, recovered: attempt > 0, attempts: attempt + 1 };
        lastReason = rows?.length ? 'insufficient-candles' : 'missing-data';
      } catch (e) { lastReason = e.message || 'fetch-error'; }
      if (attempt < Math.max(this.retries, limits.length) - 1) await new Promise(r => setTimeout(r, this.backoffMs * (attempt + 1)));
    }
    this.logger.warn?.(`[DATA-RECOVERY] ${symbol}/${timeframe} recovery failed: ${lastReason}`);
    return { rows: null, recovered: false, attempts: Math.max(this.retries, limits.length), reason: lastReason };
  }
}
module.exports = { DataRecovery };
