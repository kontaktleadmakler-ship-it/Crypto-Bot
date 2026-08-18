'use strict';

/**
 * // FIX: bounded FIFO async queue; oldest queued jobs are dropped on overflow.
 */
class BoundedAsyncQueue {
  constructor({ maxSize = 100, worker, logger = console } = {}) {
    if (typeof worker !== 'function') throw new TypeError('worker must be a function');
    this.maxSize = Math.max(1, Number(maxSize) || 100);
    this.worker = worker; this.logger = logger; this.queue = []; this.running = false; this.dropped = 0;
  }
  get size() { return this.queue.length + (this.running ? 1 : 0); }
  push(item) {
    if (this.queue.length >= this.maxSize) {
      this.queue.shift(); this.dropped++;
      this.logger.warn?.(`[QUEUE] Überlauf: älteste Nachricht verworfen (${this.dropped} gesamt).`);
    }
    this.queue.push(item); this.#drain();
  }
  async #drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const item = this.queue.shift();
        try { await this.worker(item); } catch (e) { this.logger.error?.(`[QUEUE] Worker-Fehler: ${e.message}`); }
      }
    } finally { this.running = false; }
  }
}

class RetryQueue {
  constructor({ maxRetries = 3, maxSize = 500, worker, logger = console } = {}) {
    this.maxRetries = Math.max(0, Number(maxRetries) || 3);
    this.queue = new BoundedAsyncQueue({
      maxSize, logger,
      worker: async item => {
        try { await worker(item); }
        catch (e) {
          if (item.retries < this.maxRetries) {
            item.retries++;
            this.queue.queue.push(item);
          } else {
            logger.error?.(`[QUEUE] endgültig fehlgeschlagen nach ${this.maxRetries} Retries: ${e.message}`);
          }
        }
      }
    });
  }
  push(item) { this.queue.push({ ...item, retries: Number(item.retries) || 0 }); }
  get size() { return this.queue.size; }
}
module.exports = { BoundedAsyncQueue, RetryQueue };
