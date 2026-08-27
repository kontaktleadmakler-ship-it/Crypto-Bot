'use strict';
const assert = require('assert');
const { lastBarIndexAtOrBefore } = require('../backtest-time-utils');

const btcBars = [
  { time: 0 }, { time: 15 }, { time: 45 }, { time: 60 }, { time: 105 }
];
assert.strictEqual(lastBarIndexAtOrBefore(btcBars, 0), 0);
assert.strictEqual(lastBarIndexAtOrBefore(btcBars, 14), 0);
assert.strictEqual(lastBarIndexAtOrBefore(btcBars, 15), 1);
assert.strictEqual(lastBarIndexAtOrBefore(btcBars, 30), 1, 'gap must not advance the BTC reference');
assert.strictEqual(lastBarIndexAtOrBefore(btcBars, 59), 2);
assert.strictEqual(lastBarIndexAtOrBefore(btcBars, 105), 4);
assert.strictEqual(lastBarIndexAtOrBefore(btcBars, 200), 4);
assert.strictEqual(lastBarIndexAtOrBefore(btcBars, -1), -1);
console.log('BTC timestamp alignment: PASS');
