'use strict';

/**
 * Critical state queue.
 *
 * Unlike a best-effort in-memory queue, this queue is fail-closed:
 * - callers await persistence before their in-memory state is considered committed;
 * - DB-unhealthy enqueue is rejected immediately;
 * - a failed write is never silently dropped;
 * - queued writes are serialized to preserve state ordering.
 *
 * This is intentionally not a durable cross-process buffer. Cross-process
 * durability belongs to MongoDB. If MongoDB is unavailable, new execution
 * is blocked by the pre-trade gate instead of pretending the state is safe.
 */
export class CriticalStateQueue {
  constructor({ isHealthy, logger = console } = {}) {
    if (typeof isHealthy !== 'function') throw new TypeError('STATE_QUEUE_HEALTH_CHECK_REQUIRED');
    this.isHealthy = isHealthy;
    this.logger = logger;
    this.tail = Promise.resolve();
    this.pending = 0;
  }

  get size() {
    return this.pending;
  }

  enqueue(operation, label = 'critical-state') {
    if (typeof operation !== 'function') {
      return Promise.reject(new TypeError('STATE_QUEUE_OPERATION_REQUIRED'));
    }

    if (!this.isHealthy()) {
      return Promise.reject(new Error('CRITICAL_STATE_DB_UNHEALTHY'));
    }

    this.pending += 1;

    const run = this.tail.then(async () => {
      if (!this.isHealthy()) {
        throw new Error('CRITICAL_STATE_DB_UNHEALTHY');
      }
      try {
        return await operation();
      } catch (err) {
        this.logger.error?.(`[STATE-QUEUE] ${label} persistence failed: ${err.message}`);
        throw err;
      }
    });

    // Keep the serialization chain alive after an error. The caller still
    // receives the rejection, but later independent state writes can proceed.
    this.tail = run.catch(() => undefined).finally(() => {
      this.pending = Math.max(0, this.pending - 1);
    });

    return run;
  }

  async flush() {
    await this.tail;
  }
}

export default CriticalStateQueue;
