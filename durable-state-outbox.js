'use strict';

/**
 * Durable outbox abstraction.
 *
 * Queue every state mutation even while Mongo is disconnected.
 * When a collection is available, the caller can drain in order.
 */
export class DurableStateOutbox {
  constructor({ logger = console, maxMemoryItems = 10000 } = {}) {
    this.logger = logger;
    this.maxMemoryItems = maxMemoryItems;
    this.queue = [];
    this.sequence = 0;
  }

  append(event) {
    if (this.queue.length >= this.maxMemoryItems) {
      throw new Error('STATE_OUTBOX_OVERFLOW');
    }

    const item = {
      id: `${Date.now()}-${process.pid}-${++this.sequence}`,
      queuedAt: new Date().toISOString(),
      ...event
    };

    this.queue.push(item);
    return item;
  }

  drain(maxItems = 1000) {
    return this.queue.splice(0, maxItems);
  }

  get size() {
    return this.queue.length;
  }
}

export default DurableStateOutbox;
