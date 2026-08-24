/**
 * v22.5 B9 - Append-only market-data recorder.
 * Stores normalized events as JSONL. Raw payload is retained for replay/audit.
 */
'use strict';

const fs = require('fs');
const path = require('path');

class MarketDataRecorder {
  constructor({ dir = process.env.MARKET_DATA_DIR || './data/market-replay', logger = console } = {}) {
    this.dir = dir;
    this.logger = logger;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  _fileFor(ts = Date.now()) {
    const d = new Date(ts);
    const day = d.toISOString().slice(0, 10);
    return path.join(this.dir, `${day}.jsonl`);
  }

  record(event) {
    if (!event || typeof event !== 'object') throw new Error('INVALID_MARKET_EVENT');
    const ts = Number(event.ts ?? event.timestamp ?? Date.now());
    if (!Number.isFinite(ts)) throw new Error('INVALID_EVENT_TIMESTAMP');

    const row = {
      schemaVersion: 1,
      recordedAt: Date.now(),
      ts,
      type: String(event.type || 'market'),
      symbol: event.symbol ? String(event.symbol) : undefined,
      timeframe: event.timeframe ? String(event.timeframe) : undefined,
      payload: event.payload ?? event.data ?? event
    };
    fs.appendFileSync(this._fileFor(ts), JSON.stringify(row) + '\n', 'utf8');
  }
}

module.exports = { MarketDataRecorder };
