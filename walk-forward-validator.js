'use strict';

/** B7: Chronological walk-forward splitter with purge + embargo. */
function splitWalkForward(items, { trainSize, testSize, purgeSize = 0, embargoSize = 0, stepSize = testSize } = {}) {
  const data = Array.isArray(items) ? items : [];
  const out = [];
  if (!(trainSize > 0) || !(testSize > 0)) return out;
  for (let trainEnd = trainSize; trainEnd + purgeSize + testSize <= data.length; trainEnd += Math.max(1, stepSize)) {
    const testStart = trainEnd + purgeSize;
    const testEnd = testStart + testSize;
    const embargoEnd = Math.min(data.length, testEnd + Math.max(0, embargoSize));
    out.push({ train: data.slice(0, trainEnd), purge: data.slice(trainEnd, testStart), test: data.slice(testStart, testEnd), embargo: data.slice(testEnd, embargoEnd), trainEnd, testStart, testEnd });
  }
  return out;
}
function chronologicalAssert(train, test) {
  if (!train?.length || !test?.length) throw new Error('EMPTY_WALK_FORWARD_SPLIT');
  const lastTrain = Number(train.at(-1)?.time ?? train.at(-1)?.timestamp);
  const firstTest = Number(test[0]?.time ?? test[0]?.timestamp);
  if (!Number.isFinite(lastTrain) || !Number.isFinite(firstTest) || firstTest <= lastTrain) throw new Error('NON_CHRONOLOGICAL_SPLIT');
  return true;
}
module.exports = { splitWalkForward, chronologicalAssert };
