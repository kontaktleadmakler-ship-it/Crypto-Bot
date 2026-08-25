'use strict';

/**
 * Every critical state write should include the current fencing token.
 */
export async function fencedWrite(collection, {
  filter = {},
  fencingToken,
  update,
  upsert = false
} = {}) {
  if (!Number.isInteger(fencingToken) || fencingToken <= 0) {
    throw new Error('INVALID_FENCING_TOKEN');
  }

  const result = await collection.updateOne(
    { ...filter, fencingToken: { $lte: fencingToken } },
    {
      ...update,
      $set: {
        ...(update.$set || {}),
        fencingToken,
        updatedAt: new Date()
      }
    },
    { upsert }
  );

  if (result.matchedCount === 0 && !result.upsertedCount) {
    throw new Error('STALE_FENCING_TOKEN');
  }

  return result;
}

export default fencedWrite;
