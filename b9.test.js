const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MarketDataRecorder } = require('../market-data-recorder');
const { MarketDataReplay } = require('../market-data-replay');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-b9-'));
  const recorder = new MarketDataRecorder({ dir, logger: { warn() {} } });
  recorder.record({ ts: 1000, type: 'ticker', symbol: 'BTC-USDT', payload: { price: 1 } });
  recorder.record({ ts: 2000, type: 'ticker', symbol: 'BTC-USDT', payload: { price: 2 } });
  const seen = [];
  const replay = new MarketDataReplay({ dir, speed: 0, logger: { warn() {} } });
  const result = await replay.run({ fromTs: 1000, toTs: 2000, onEvent: e => seen.push(e.ts) });
  assert.deepStrictEqual(seen, [1000, 2000]);
  assert.strictEqual(result.events, 2);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('Phase B9 tests: OK');
})().catch(err => { console.error(err); process.exit(1); });
