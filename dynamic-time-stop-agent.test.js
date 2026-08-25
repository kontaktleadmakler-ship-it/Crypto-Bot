const assert = require('assert');
const { DynamicTimeStopAgent } = require('./dynamic-time-stop-agent');

(async () => {
  const agent = new DynamicTimeStopAgent({ maxExtensionHours: 2, extensionStepHours: 1 });
  const candles = Array.from({ length: 80 }, (_, i) => {
    const close = 100 + i * 0.15;
    return { open: close - 0.05, high: close + 0.2, low: close - 0.1, close };
  });
  const result = await agent.evaluate({
    trade: { entry: 111, direction: 'LONG' }, candles, currentPrice: 111.8,
    hoursElapsed: 4, normalMaxHoldHours: 4, absoluteMaxHoldHours: 24
  });
  assert.ok(['EXTEND', 'EXIT'].includes(result.decision));
  console.log('Dynamic Time Stop Agent tests: OK');
})().catch(err => { console.error(err); process.exit(1); });
