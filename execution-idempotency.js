'use strict';

const crypto = require('crypto');

/**
 * Idempotency store for signal/order intents.
 * The MongoDB-backed path is optional; the in-memory map protects the current
 * process while the persistent collection protects restart/retry duplicates.
 */
class ExecutionIdempotency {
  constructor({ collection = null, logger = console, ttlMs = 7 * 24 * 3600 * 1000 } = {}) {
    this.collection = collection;
    this.logger = logger;
    this.ttlMs = ttlMs;
    this.memory = new Map();
    this.inFlight = new Map();
  }

  static makeKey({ signalId, symbol, direction, strategyVersion = 'unknown', configHash = 'unknown' }) {
    if (signalId) return String(signalId);
    return crypto.createHash('sha256')
      .update(JSON.stringify({ symbol, direction, strategyVersion, configHash }))
      .digest('hex');
  }

  async acquire(key, metadata = {}) {
    const k = String(key);
    if (this.inFlight.has(k)) return { acquired: false, reason: 'in-flight', record: this.inFlight.get(k) };

    const existingMemory = this.memory.get(k);
    if (existingMemory && Date.now() - existingMemory.createdAt < this.ttlMs) {
      return { acquired: false, reason: 'duplicate', record: existingMemory };
    }

    if (this.collection) {
      try {
        const now = new Date();
        const existing = await this.collection.findOne({ _id: k });
        if (existing && now.getTime() - new Date(existing.createdAt).getTime() < this.ttlMs) {
          this.memory.set(k, existing);
          return { acquired: false, reason: 'duplicate', record: existing };
        }
        const record = { _id: k, createdAt: now, status: 'reserved', ...metadata };
        await this.collection.updateOne({ _id: k }, { $setOnInsert: record }, { upsert: true });
        const stored = await this.collection.findOne({ _id: k });
        if (stored && stored.createdAt && new Date(stored.createdAt).getTime() !== now.getTime()) {
          this.memory.set(k, stored);
          return { acquired: false, reason: 'duplicate', record: stored };
        }
        this.memory.set(k, record);
        this.inFlight.set(k, record);
        return { acquired: true, record };
      } catch (e) {
        // Fail closed: no new execution when idempotency persistence is unavailable.
        this.logger.error(`[IDEMPOTENCY] Persistenzfehler: ${e.message}`);
        return { acquired: false, reason: 'persistence-error' };
      }
    }

    const record = { _id: k, createdAt: new Date(), status: 'reserved', ...metadata };
    this.memory.set(k, record);
    this.inFlight.set(k, record);
    return { acquired: true, record };
  }

  async commit(key, patch = {}) {
    const k = String(key);
    const record = { ...(this.memory.get(k) || {}), ...patch, status: 'committed', updatedAt: new Date() };
    this.memory.set(k, record);
    this.inFlight.delete(k);
    if (this.collection) {
      await this.collection.updateOne({ _id: k }, { $set: record }, { upsert: true });
    }
    return record;
  }

  async release(key, reason = 'released') {
    const k = String(key);
    this.inFlight.delete(k);
    const record = this.memory.get(k);
    if (record) {
      record.status = reason;
      record.updatedAt = new Date();
      this.memory.set(k, record);
      if (this.collection) await this.collection.updateOne({ _id: k }, { $set: record }, { upsert: true });
    }
  }
}

module.exports = { ExecutionIdempotency };
