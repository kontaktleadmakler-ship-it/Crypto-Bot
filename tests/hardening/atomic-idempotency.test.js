import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AtomicIdempotency } from '../../execution-core/atomic-idempotency.js';

test('duplicate insert is treated as already reserved', async () => {
  const rows = new Map();
  const collection = {
    async insertOne(doc) {
      if (rows.has(doc._id)) {
        const e = new Error('duplicate');
        e.code = 11000;
        throw e;
      }
      rows.set(doc._id, doc);
    },
    async findOne(q) { return rows.get(q._id) || null; },
    async updateOne() { return { modifiedCount: 1 }; }
  };

  const repo = new AtomicIdempotency({ collection });
  assert.equal((await repo.reserve('x')).acquired, true);
  assert.equal((await repo.reserve('x')).acquired, false);
});
