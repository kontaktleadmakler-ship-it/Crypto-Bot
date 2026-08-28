'use strict';

export class AtomicIdempotency {
  constructor({ collection, logger = console } = {}) {
    if (!collection) throw new Error('IDEMPOTENCY_COLLECTION_REQUIRED');
    this.collection = collection;
    this.logger = logger;
  }

  async reserve(key, metadata = {}) {
    const id = String(key);
    const record = {
      _id: id,
      status: 'RESERVED',
      leaseId: crypto.randomUUID(),
      createdAt: new Date(),
      ...metadata
    };

    try {
      await this.collection.insertOne(record);
      return { acquired: true, record };
    } catch (err) {
      if (err?.code !== 11000) throw err;
      const existing = await this.collection.findOne({ _id: id });
      return { acquired: false, reason: 'DUPLICATE', record: existing };
    }
  }

  async setStatus(key, status, patch = {}) {
    return this.collection.updateOne(
      { _id: String(key) },
      { $set: { status, updatedAt: new Date(), ...patch } }
    );
  }
}

export default AtomicIdempotency;
