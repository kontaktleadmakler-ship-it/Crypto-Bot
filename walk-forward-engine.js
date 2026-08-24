'use strict';

/**
 * Deterministic walk-forward splitter. Supports both the legacy
 * trainBars/testBars/stepBars names and trainSize/testSize/step.
 */
class WalkForwardEngine {
  constructor(options = {}) {
    this.trainSize = Number(options.trainSize ?? options.trainBars ?? 500);
    this.testSize = Number(options.testSize ?? options.testBars ?? 100);
    this.step = Number(options.step ?? options.stepBars ?? this.testSize);
    if (![this.trainSize, this.testSize, this.step].every(Number.isInteger) || this.trainSize < 1 || this.testSize < 1 || this.step < 1) {
      throw new Error('INVALID_WALK_FORWARD_CONFIGURATION');
    }
  }

  windows(dataOrLength) {
    const length = Array.isArray(dataOrLength) ? dataOrLength.length : Number(dataOrLength);
    if (!Number.isInteger(length) || length < 0) return [];
    const out = [];
    for (let start = 0; start + this.trainSize + this.testSize <= length; start += this.step) {
      out.push({
        start,
        trainStart: start,
        trainEnd: start + this.trainSize,
        testStart: start + this.trainSize,
        testEnd: start + this.trainSize + this.testSize
      });
    }
    return out;
  }

  run(data, { trainFn, testFn, scoreFn = x => x?.metrics?.totalPnl ?? x?.totalPnl ?? 0 } = {}) {
    if (!Array.isArray(data)) throw new Error('WALK_FORWARD_DATA_MUST_BE_ARRAY');
    const windows = [];
    for (const w of this.windows(data)) {
      const train = data.slice(w.trainStart, w.trainEnd);
      const test = data.slice(w.testStart, w.testEnd);
      const model = trainFn ? trainFn(train, w) : null;
      const result = testFn ? testFn(test, model, w) : model;
      windows.push({ ...w, score: Number(scoreFn(result)) || 0, result });
    }
    return { windows, aggregate: windows.reduce((a, w) => a + w.score, 0), count: windows.length };
  }
}

module.exports = { WalkForwardEngine };
