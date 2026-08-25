'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { DynamicTimeStopAgent } = require('../dynamic-time-stop-agent');

(async () => {
  const agent = new DynamicTimeStopAgent({ maxExtensionHours: 2, extensionStepHours: 1 });
  const noData = await agent.evaluate({ trade: { entry: 100, direction: 'LONG' }, candles: [], currentPrice: 99, hoursElapsed: 4, normalMaxHoldHours: 4, absoluteMaxHoldHours: 24 });
  assert.strictEqual(noData.decision, 'DEFER');

  const candles = Array.from({ length: 80 }, (_, i) => ({ open: 100+i*.2, high: 100+i*.2+.3, low: 100+i*.2-.1, close: 100+i*.2 }));
  const budgetExhausted = await agent.evaluate({ trade: { entry: 100, direction: 'LONG', timeStopExtensionUsedHours: 2 }, candles, currentPrice: 116, hoursElapsed: 6, normalMaxHoldHours: 4, absoluteMaxHoldHours: 24 });
  assert.strictEqual(budgetExhausted.decision, 'EXIT');

  const runtime = fs.readFileSync(path.join(__dirname, '..', 'trading-bot-v24.6-runtime.js'), 'utf8');
  assert.ok(runtime.includes("if (req.path === '/health') return next();"));
  assert.ok(runtime.includes("res.status(200).json({"));
  assert.ok(runtime.includes("app.get('/ready'"));
  assert.ok(runtime.includes("closeReason: 'absolute-time-limit'"));
  assert.ok(runtime.includes('timeStopExtensionUsedHours'));

  const adapter = fs.readFileSync(path.join(__dirname, '..', 'timesfm-forecast-agent.js'), 'utf8');
  assert.ok(adapter.includes('const id = `${process.pid}-${Date.now()}-${++this.requestSeq}`'));
  assert.ok(adapter.includes('this.pending.set(id, done)'));

  const service = fs.readFileSync(path.join(__dirname, '..', 'timesfm_forecast_service.py'), 'utf8');
  assert.ok(service.includes('p10ReturnPct'));
  assert.ok(service.includes('p50ReturnPct'));
  assert.ok(service.includes('p90ReturnPct'));

  const ml = fs.readFileSync(path.join(__dirname, '..', 'ml-engine.js'), 'utf8');
  assert.ok(ml.includes('.sort({ closeTime: -1 })'));
  assert.ok(ml.includes('validationBalancedAccuracy'));
  assert.ok(ml.includes('selectionScore'));

  console.log('Final fixes tests: OK');
})().catch(err => { console.error(err); process.exit(1); });
