/**
 * v22.5 B9 - Deterministic market-data replay.
 * Replays recorded events in timestamp order. No future event is exposed early.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

class MarketDataReplay {
  constructor({ dir = process.env.MARKET_DATA_DIR || './data/market-replay', speed = 0, logger = console } = {}) {
    this.dir = dir;
    this.speed = Number(speed) || 0;
    this.logger = logger;
    this.stopped = false;
  }

  stop() { this.stopped = true; }

  _files(fromTs, toTs) {
    if (!fs.existsSync(this.dir)) return [];
    return fs.readdirSync(this.dir)
      .filter(f => f.endsWith('.jsonl'))
      .sort()
      .map(f => path.join(this.dir, f))
      .filter(f => {
        const day = path.basename(f, '.jsonl');
        const ts = Date.parse(day + 'T00:00:00.000Z');
        return (!Number.isFinite(fromTs) || ts <= toTs) && (!Number.isFinite(toTs) || ts >= fromTs - 86400000);
      });
  }

  async run({ fromTs = -Infinity, toTs = Infinity, onEvent } = {}) {
    if (typeof onEvent !== 'function') throw new Error('REPLAY_CALLBACK_REQUIRED');
    this.stopped = false;
    const events = [];

    for (const file of this._files(fromTs, toTs)) {
      const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
      for await (const line of rl) {
        if (this.stopped || !line.trim()) continue;
        try {
          const e = JSON.parse(line);
          if (e.ts >= fromTs && e.ts <= toTs) events.push(e);
        } catch (err) {
          this.logger.warn?.(`[REPLAY] invalid row in ${file}: ${err.message}`);
        }
      }
    }

    events.sort((a, b) => a.ts - b.ts);
    let previousTs = null;
    for (const event of events) {
      if (this.stopped) break;
      if (this.speed > 0 && previousTs !== null) {
        await new Promise(r => setTimeout(r, Math.max(0, (event.ts - previousTs) / this.speed)));
      }
      previousTs = event.ts;
      await onEvent(event);
    }
    return { events: events.length, stopped: this.stopped };
  }
}

module.exports = { MarketDataReplay };
