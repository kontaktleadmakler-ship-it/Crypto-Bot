'use strict';

/**
 * Fencing token repository.
 * A new lease gets a monotonically increasing token.
 */
export class FencingLease {
  constructor({ collection, instanceId, leaseMs = 15000 } = {}) {
    if (!collection || !instanceId) throw new Error('FENCING_LEASE_CONFIG_REQUIRED');
    this.collection = collection;
    this.instanceId = instanceId;
    this.leaseMs = leaseMs;
    this.token = 0;
  }

  async acquire() {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.leaseMs);

    const result = await this.collection.findOneAndUpdate(
      {
        _id: 'trading-instance',
        $or: [
          { expiresAt: { $lt: now } },
          { instanceId: this.instanceId }
        ]
      },
      {
        $set: {
          instanceId: this.instanceId,
          expiresAt,
          updatedAt: now
        },
        $inc: { fencingToken: 1 }
      },
      {
        upsert: true,
        returnDocument: 'after'
      }
    );

    const doc = result?.value || result;
    this.token = Number(doc?.fencingToken || 0);
    return {
      acquired: doc?.instanceId === this.instanceId,
      fencingToken: this.token,
      expiresAt: doc?.expiresAt
    };
  }

  async renew() {
    if (!this.token) return { renewed: false };
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.leaseMs);

    const result = await this.collection.updateOne(
      {
        _id: 'trading-instance',
        instanceId: this.instanceId,
        fencingToken: this.token
      },
      { $set: { expiresAt, updatedAt: now } }
    );

    return { renewed: result.modifiedCount === 1, fencingToken: this.token, expiresAt };
  }

  async release() {
    if (!this.token) return;
    await this.collection.updateOne(
      {
        _id: 'trading-instance',
        instanceId: this.instanceId,
        fencingToken: this.token
      },
      { $set: { expiresAt: new Date(0), updatedAt: new Date() } }
    );
  }
}

export default FencingLease;
