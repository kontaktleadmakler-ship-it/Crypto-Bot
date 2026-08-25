'use strict';

/**
 * Per-symbol async serialization.
 * Prevents concurrent close/reduce/entry operations in a single process.
 * Distributed execution still requires persistent idempotency/fencing.
 */
export class SymbolExecutionLock {
  constructor() {
    this.locks = new Map();
  }

  async run(symbol, fn) {
    const key = String(symbol);
    const previous = this.locks.get(key) || Promise.resolve();

    let release;
    const current = new Promise(resolve => { release = resolve; });
    this.locks.set(key, current);

    await previous;

    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === current) {
        this.locks.delete(key);
      }
    }
  }

  clear() {
    this.locks.clear();
  }
}

export default SymbolExecutionLock;
