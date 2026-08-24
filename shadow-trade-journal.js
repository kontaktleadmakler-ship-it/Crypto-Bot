/**
 * v22.6 B10 - Append-only shadow journal.
 */
'use strict';

const fs = require('fs');
const path = require('path');

class ShadowTradeJournal {
  constructor({ file = process.env.SHADOW_JOURNAL_FILE || './data/shadow/shadow-trades.jsonl' } = {}) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  append(event) {
    if (!event || typeof event !== 'object') throw new Error('INVALID_SHADOW_EVENT');
    fs.appendFileSync(this.file, JSON.stringify({
      schemaVersion: 1,
      ts: Date.now(),
      ...event
    }) + '\n', 'utf8');
  }
}

module.exports = { ShadowTradeJournal };
