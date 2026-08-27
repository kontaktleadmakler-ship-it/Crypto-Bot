'use strict';
const assert = require('assert');
const { TensorFlowSignalModel, FEATURE_NAMES } = require('../ml-engine');
const m = new TensorFlowSignalModel({ minSamples: 2 });
const legacy = { entry: 100, pnlUSD: 10, direction: 'LONG', signalScore: 70, adxAtEntry: 25, rsiAtEntry: 55, relativeVolumeAtEntry: 1.5, atrAtEntry: 1, hurstAtEntry: 0.6, macdHistogramAtEntry: 0.2, pocDistancePctAtEntry: 0.1, vwapDistancePctAtEntry: 0.1, trend4hAtEntry: 'BULLISH', trend1hAtEntry: 'BULLISH', trend15mAtEntry: 'BULLISH', btcTrendAtEntry: 'BULLISH', marketPhase: 'TRENDING' };
const features = m.featuresFromTrade(legacy);
assert(Array.isArray(features));
assert.strictEqual(features.length, FEATURE_NAMES.length);
assert(features.every(Number.isFinite));
console.log('ML legacy training fallback test: OK');


const normalizedLegacy = {
  pnlUSD: -3,
  direction: 'SHORT',
  signalScore: 61,
  adxAtEntry: 24,
  rsiAtEntry: 47,
  relativeVolumeAtEntry: 1.2,
  atrPctAtEntry: 1.4,
  hurstAtEntry: 0.55,
  macdHistogramPctAtEntry: -0.02,
  pocDistancePctAtEntry: 0.2,
  vwapDistancePctAtEntry: -0.1,
  trend4hAtEntry: 'BEARISH',
  trend1hAtEntry: 'BEARISH',
  trend15mAtEntry: 'RANGING',
  btcTrendAtEntry: 'BEARISH',
  marketPhase: 'RANGING'
};
const normalizedFeatures = m.featuresFromTrade(normalizedLegacy);
assert(Array.isArray(normalizedFeatures));
assert.strictEqual(normalizedFeatures.length, FEATURE_NAMES.length);
assert(normalizedFeatures.every(Number.isFinite));
console.log('ML normalized legacy-without-price test: OK');
