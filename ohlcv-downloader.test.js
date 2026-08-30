'use strict';
const assert = require('assert');
const { GRANULARITY, kucoinSymbol, normalizeRow, validateBars, parseArgs } = require('../scripts/download-ohlcv');

assert.strictEqual(kucoinSymbol('BTC-USDT'), 'XBTUSDTM');
assert.strictEqual(kucoinSymbol('ETH-USDT'), 'ETHUSDTM');
assert.strictEqual(GRANULARITY['15m'], 15);
assert.deepStrictEqual(normalizeRow([1000, 10, 12, 13, 9, 100]), { time:1000, open:10, high:13, low:9, close:12, volume:100 });
assert.strictEqual(normalizeRow([1000, 10]), null);

const bars = [
  {time:0,open:10,high:12,low:9,close:11,volume:10},
  {time:900000,open:11,high:13,low:10,close:12,volume:11},
  {time:2700000,open:12,high:14,low:11,close:13,volume:12},
  {time:2700000,open:12,high:14,low:11,close:13,volume:12}
];
const quality = validateBars(bars, '15m');
assert.strictEqual(quality.duplicates, 1);
assert.strictEqual(quality.missingBars, 1);
assert.strictEqual(quality.invalid, 0);

assert.deepStrictEqual(parseArgs(['--symbol','BTC-USDT','--timeframe','15m','--from','2025-01-01']), {symbol:'BTC-USDT',timeframe:'15m',from:'2025-01-01'});
console.log('ohlcv-downloader.test.js: PASS');
