'use strict';

/**
 * TensorFlow.js Signal ML Engine
 *
 * Learns from completed trades only. The model predicts the probability that
 * a candidate setup would finish with positive net PnL under the bot's
 * existing execution/risk rules.
 */

const fs = require('fs');
const path = require('path');
const tf = require('@tensorflow/tfjs-node');

const FEATURE_NAMES = [
  'adx',
  'rsi',
  'relativeVolume',
  'signalScore',
  'atrPct',
  'hurst',
  'macdHistogramPct',
  'pocDistancePct',
  'vwapDistancePct',
  'fundingRate',
  'orderBookImbalance',
  'spreadPct',
  'volatilityRatio',
  'trend4h',
  'trend1h',
  'trend15m',
  'btcTrend',
  'direction',
  'marketPhase'
];

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function trendValue(value) {
  if (value === 'BULLISH') return 1;
  if (value === 'BEARISH') return -1;
  return 0;
}

function marketPhaseValue(value) {
  if (value === 'TRENDING') return 1;
  if (value === 'VOLATILE') return 0.5;
  return 0;
}

class TensorFlowSignalModel {
  constructor(options = {}) {
    this.modelDir = path.resolve(options.modelDir || './models/signal-model');
    this.minSamples = Number(options.minSamples || 40);
    this.maxSamples = Number(options.maxSamples || 2000);
    this.minPredictionProbability = Number(options.minPredictionProbability || 0.55);
    this.strongSignalProbability = Number(options.strongSignalProbability || 0.70);
    this.epochs = Number(options.epochs || 80);
    this.batchSize = Number(options.batchSize || 32);
    this.logger = options.logger || console;

    this.model = null;
    this.scaler = null;
    this.trained = false;
    this.training = false;
    this.stats = {
      trained: false,
      samples: 0,
      trainingSamples: 0,
      validationSamples: 0,
      positiveRate: 0,
      validationAccuracy: 0,
      validationLoss: 0,
      epochs: 0,
      trainedAt: null,
      modelVersion: null,
      featureCount: FEATURE_NAMES.length,
      featureNames: FEATURE_NAMES
    };
  }

  getStats() {
    return {
      ...this.stats,
      trained: this.trained,
      modelVersion: this.stats.modelVersion || null,
      featureNames: [...FEATURE_NAMES]
    };
  }

  buildFeatures(data = {}) {
    const orderBook = data.orderBookImbalance == null ? 1 : finite(data.orderBookImbalance, 1);
    const fundingRate = finite(data.fundingRate, 0);

    return [
      clamp(finite(data.adx, 20), 0, 100),
      clamp(finite(data.rsi, 50), 0, 100),
      clamp(finite(data.relativeVolume, 1), 0, 10),
      clamp(finite(data.signalScore, 50), 0, 100),
      clamp(finite(data.atrPct, 0), 0, 25),
      clamp(finite(data.hurst, 0.5), 0, 1),
      clamp(finite(data.macdHistogramPct, 0), -10, 10),
      clamp(finite(data.pocDistancePct, 0), -25, 25),
      clamp(finite(data.vwapDistancePct, 0), -25, 25),
      clamp(fundingRate, -0.05, 0.05),
      clamp(orderBook, 0.05, 20),
      clamp(finite(data.spreadPct, 0), 0, 5),
      clamp(finite(data.volatilityRatio, 1), 0.1, 10),
      trendValue(data.trend4h),
      trendValue(data.trend1h),
      trendValue(data.trend15m),
      trendValue(data.btcTrend),
      data.direction === 'LONG' ? 1 : -1,
      marketPhaseValue(data.marketPhase)
    ];
  }

  featuresFromTrade(trade) {
    const currentPrice = finite(trade.entry, 0);
    const atrPct = trade.atrPctAtEntry != null
      ? finite(trade.atrPctAtEntry, 0)
      : (currentPrice > 0 && trade.atrAtEntry ? (finite(trade.atrAtEntry) / currentPrice) * 100 : 0);

    const macdHistogramPct = trade.macdHistogramPctAtEntry != null
      ? finite(trade.macdHistogramPctAtEntry, 0)
      : (currentPrice > 0 ? (finite(trade.macdHistogramAtEntry, 0) / currentPrice) * 100 : 0);

    const pocDistancePct = trade.pocDistancePctAtEntry != null
      ? finite(trade.pocDistancePctAtEntry, 0)
      : finite(trade.pocDistancePct, 0);

    const vwapDistancePct = trade.vwapDistancePctAtEntry != null
      ? finite(trade.vwapDistancePctAtEntry, 0)
      : finite(trade.vwapDistancePct, 0);

    return this.buildFeatures({
      adx: trade.adxAtEntry,
      rsi: trade.rsiAtEntry,
      relativeVolume: trade.relativeVolumeAtEntry,
      signalScore: trade.signalScore,
      atrPct,
      hurst: trade.hurstAtEntry,
      macdHistogramPct,
      pocDistancePct,
      vwapDistancePct,
      fundingRate: trade.fundingRateAtEntry,
      orderBookImbalance: trade.orderBookImbalanceAtEntry,
      spreadPct: trade.spreadPctAtEntry,
      volatilityRatio: trade.volatilityRatioAtEntry,
      trend4h: trade.trend4hAtEntry,
      trend1h: trade.trend1hAtEntry,
      trend15m: trade.trend15mAtEntry,
      btcTrend: trade.btcTrendAtEntry,
      direction: trade.direction,
      marketPhase: trade.marketPhase
    });
  }

  makeScaler(matrix) {
    const means = new Array(FEATURE_NAMES.length).fill(0);
    const stds = new Array(FEATURE_NAMES.length).fill(1);

    for (let j = 0; j < FEATURE_NAMES.length; j++) {
      const values = matrix.map(row => finite(row[j], 0));
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / Math.max(1, values.length);
      const std = Math.sqrt(variance);
      means[j] = mean;
      stds[j] = std > 1e-8 ? std : 1;
    }

    return { means, stds, featureNames: [...FEATURE_NAMES] };
  }

  scaleMatrix(matrix, scaler = this.scaler) {
    return matrix.map(row => row.map((value, i) =>
      (finite(value, 0) - scaler.means[i]) / scaler.stds[i]
    ));
  }

  async trainFromTrades(collection, options = {}) {
    if (this.training) return { trained: false, reason: 'training-in-progress', ...this.getStats() };
    if (!collection) return { trained: false, reason: 'collection-unavailable' };

    this.training = true;
    try {
      const force = !!options.force;
      const trades = await collection.find({ isPartial: { $ne: true }, pnlUSD: { $exists: true } })
        .sort({ closeTime: 1 })
        .limit(this.maxSamples)
        .toArray();

      if (trades.length < this.minSamples) {
        this.logger.warn(`🧠 [TensorFlow.js] Zu wenige Trainingsdaten: ${trades.length}/${this.minSamples}`);
        return { trained: false, reason: 'not-enough-data', samples: trades.length };
      }

      const dataset = trades
        .map(trade => ({
          trade,
          features: this.featuresFromTrade(trade),
          label: finite(trade.pnlUSD, 0) > 0 ? 1 : 0
        }))
        .filter(item => item.features.every(Number.isFinite));

      if (dataset.length < this.minSamples) {
        return { trained: false, reason: 'not-enough-valid-data', samples: dataset.length };
      }

      const positives = dataset.filter(x => x.label === 1).length;
      const negatives = dataset.length - positives;
      if (positives < 5 || negatives < 5) {
        this.logger.warn(`🧠 [TensorFlow.js] Zu wenig Klassenvielfalt: wins=${positives}, losses=${negatives}`);
        return { trained: false, reason: 'insufficient-class-balance', samples: dataset.length };
      }

      const splitIndex = Math.max(1, Math.floor(dataset.length * 0.80));
      const trainSet = dataset.slice(0, splitIndex);
      const validationSet = dataset.slice(splitIndex);

      const scaler = this.makeScaler(trainSet.map(x => x.features));
      const xTrain = this.scaleMatrix(trainSet.map(x => x.features), scaler);
      const yTrain = trainSet.map(x => x.label);
      const xVal = this.scaleMatrix(validationSet.map(x => x.features), scaler);
      const yVal = validationSet.map(x => x.label);

      const model = tf.sequential();
      model.add(tf.layers.dense({ inputShape: [FEATURE_NAMES.length], units: 32, activation: 'relu', kernelInitializer: 'heNormal' }));
      model.add(tf.layers.dropout({ rate: 0.15 }));
      model.add(tf.layers.dense({ units: 16, activation: 'relu' }));
      model.add(tf.layers.dense({ units: 8, activation: 'relu' }));
      model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));

      model.compile({
        optimizer: tf.train.adam(0.001),
        loss: 'binaryCrossentropy',
        metrics: ['accuracy']
      });

      const xs = tf.tensor2d(xTrain, [xTrain.length, FEATURE_NAMES.length]);
      const ys = tf.tensor2d(yTrain, [yTrain.length, 1]);
      const vx = tf.tensor2d(xVal, [xVal.length, FEATURE_NAMES.length]);
      const vy = tf.tensor2d(yVal, [yVal.length, 1]);

      let history;
      try {
        history = await model.fit(xs, ys, {
          epochs: this.epochs,
          batchSize: Math.min(this.batchSize, xTrain.length),
          validationData: [vx, vy],
          shuffle: false,
          verbose: 0,
          callbacks: tf.callbacks.earlyStopping({ monitor: 'val_loss', patience: 10, restoreBestWeight: true })
        });
      } finally {
        xs.dispose(); ys.dispose(); vx.dispose(); vy.dispose();
      }

      const evalXs = tf.tensor2d(xVal, [xVal.length, FEATURE_NAMES.length]);
      const evalYs = tf.tensor2d(yVal, [yVal.length, 1]);
      const evalResult = model.evaluate(evalXs, evalYs, { verbose: 0 });
      const evalLoss = Array.isArray(evalResult) ? await evalResult[0].data() : await evalResult.data();
      const evalAcc = Array.isArray(evalResult) ? await evalResult[1].data() : [0];
      if (Array.isArray(evalResult)) evalResult.forEach(t => t.dispose()); else evalResult.dispose();
      evalXs.dispose(); evalYs.dispose();

      const validationAccuracy = finite(evalAcc[0], 0);
      const validationLoss = finite(evalLoss[0], 0);

      const oldAccuracy = finite(this.stats.validationAccuracy, 0);
      if (!force && this.trained && validationAccuracy + 0.02 < oldAccuracy) {
        this.logger.warn(`🧠 [TensorFlow.js] Neues Modell verworfen: Val-Accuracy ${(validationAccuracy * 100).toFixed(1)}% vs. aktuell ${(oldAccuracy * 100).toFixed(1)}%.`);
        model.dispose();
        return { trained: false, reason: 'candidate-model-worse', validationAccuracy, oldAccuracy };
      }

      this.model = model;
      this.scaler = scaler;
      this.trained = true;
      this.stats = {
        trained: true,
        samples: dataset.length,
        trainingSamples: trainSet.length,
        validationSamples: validationSet.length,
        positiveRate: positives / dataset.length,
        validationAccuracy,
        validationLoss,
        epochs: history?.epoch?.length || 0,
        trainedAt: new Date().toISOString(),
        modelVersion: `tfjs-${Date.now()}`,
        featureCount: FEATURE_NAMES.length,
        featureNames: [...FEATURE_NAMES]
      };

      await this.save();
      this.logger.info(`🧠 [TensorFlow.js] Modell trainiert: ${dataset.length} Trades | Val-Accuracy ${(validationAccuracy * 100).toFixed(1)}% | Val-Loss ${validationLoss.toFixed(4)} | Version ${this.stats.modelVersion}`);
      return { trained: true, ...this.getStats() };
    } catch (e) {
      this.logger.error(`🧠 [TensorFlow.js] Training fehlgeschlagen: ${e.stack || e.message}`);
      return { trained: false, reason: e.message };
    } finally {
      this.training = false;
    }
  }

  async save() {
    if (!this.model || !this.scaler) throw new Error('Kein Modell/Scaler zum Speichern vorhanden.');
    fs.mkdirSync(this.modelDir, { recursive: true });
    await this.model.save(`file://${this.modelDir}`);
    fs.writeFileSync(path.join(this.modelDir, 'metadata.json'), JSON.stringify({
      scaler: this.scaler,
      stats: this.stats,
      thresholds: {
        minPredictionProbability: this.minPredictionProbability,
        strongSignalProbability: this.strongSignalProbability
      }
    }, null, 2));
  }

  async load() {
    const modelPath = path.join(this.modelDir, 'model.json');
    const metadataPath = path.join(this.modelDir, 'metadata.json');
    if (!fs.existsSync(modelPath) || !fs.existsSync(metadataPath)) return false;

    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    if (!metadata.scaler || !Array.isArray(metadata.scaler.means) || metadata.scaler.means.length !== FEATURE_NAMES.length) {
      throw new Error('ML-Metadaten/Scaler sind inkompatibel.');
    }
    if (!metadata.stats || metadata.stats.featureCount !== FEATURE_NAMES.length) {
      throw new Error('ML-Modell-Version/Feature-Schema ist inkompatibel.');
    }

    this.model = await tf.loadLayersModel(`file://${modelPath}`);
    this.scaler = metadata.scaler;
    this.stats = metadata.stats;
    this.trained = true;
    return true;
  }

  predict(features) {
    if (!this.model || !this.scaler || !this.trained) {
      return { probability: 0.5, class: 'UNKNOWN', confidence: 0, trained: false };
    }
    if (!Array.isArray(features) || features.length !== FEATURE_NAMES.length) {
      throw new Error(`Ungültige ML-Features: erwartet ${FEATURE_NAMES.length}, erhalten ${features?.length}`);
    }

    const scaled = this.scaleMatrix([features], this.scaler)[0];
    const input = tf.tensor2d([scaled], [1, FEATURE_NAMES.length]);
    const output = this.model.predict(input);
    const probability = clamp(output.dataSync()[0], 0, 1);
    input.dispose();
    output.dispose();

    const confidence = Math.abs(probability - 0.5) * 2;
    const className = probability >= this.strongSignalProbability
      ? 'STRONG_LONG_SETUP'
      : probability >= this.minPredictionProbability
        ? 'LONG_SETUP'
        : probability <= (1 - this.strongSignalProbability)
          ? 'STRONG_NO_TRADE'
          : probability <= (1 - this.minPredictionProbability)
            ? 'NO_TRADE'
            : 'NEUTRAL';

    return { probability, class: className, confidence, trained: true };
  }
}

module.exports = { TensorFlowSignalModel, FEATURE_NAMES };
