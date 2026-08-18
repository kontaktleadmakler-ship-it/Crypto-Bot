'use strict';

/**
 * TensorFlow.js Signal ML Engine (mit automatischem Hyperparameter-Tuning)
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


function fitIsotonic(probabilities, labels) {
  const pairs = probabilities.map((p, i) => ({ p: clamp(Number(p), 0, 1), y: Number(labels[i]) ? 1 : 0 })).sort((a,b) => a.p - b.p);
  const blocks = [];
  for (const item of pairs) {
    blocks.push({ sum: item.y, n: 1, minP: item.p, maxP: item.p });
    while (blocks.length >= 2) {
      const a = blocks[blocks.length - 2], b = blocks[blocks.length - 1];
      if (a.sum / a.n <= b.sum / b.n) break;
      const merged = { sum: a.sum + b.sum, n: a.n + b.n, minP: a.minP, maxP: b.maxP };
      blocks.splice(blocks.length - 2, 2, merged);
    }
  }
  return blocks.map(b => ({ minP: b.minP, maxP: b.maxP, value: b.sum / b.n }));
}
function applyIsotonic(probability, calibration) {
  if (!Array.isArray(calibration) || !calibration.length) return probability;
  let best = calibration[0];
  for (const b of calibration) { if (probability >= b.minP) best = b; else break; }
  return clamp(best.value, 0, 1);
}
function brierScore(probs, labels) { return probs.length ? probs.reduce((s,p,i) => s + Math.pow(p - labels[i], 2), 0) / probs.length : 0; }
function logLoss(probs, labels) { const eps = 1e-7; return probs.length ? -probs.reduce((s,p,i) => s + labels[i]*Math.log(clamp(p,eps,1-eps)) + (1-labels[i])*Math.log(clamp(1-p,eps,1-eps)), 0) / probs.length : 0; }

function disposeModelSafely(model) {
  if (!model) return;
  try { model.optimizer?.dispose?.(); } catch (_) {}
  try { model.dispose(); } catch (_) {}
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
    this.calibration = null;

    this.model = null;
    this.scaler = null;
    this.trained = false;
    this.training = false;
// IMPROVED: tune only once per day or every Nth retrain instead of every retrain.
this.retrainCount = 0;
this.hyperparameterSearchEvery = Number(options.hyperparameterSearchEvery || process.env.ML_HYPERPARAM_SEARCH_EVERY || 5);
this.lastHyperparameterSearchAt = null;
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
      featureNames: FEATURE_NAMES,
      bestHyperparameters: null,
      validationBrier: 0,
      validationLogLoss: 0,
      calibrationMethod: 'isotonic',
      hyperparameterSearchAt: null,
      retrainCount: 0
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
    // Bug fix (Punkt 6 - ML-Feature-Leakage): trade.entry ist der tatsächliche
    // Fill-Preis, der erst NACH Signalentscheidung und Slippage feststeht.
    // Für die Normalisierung von ATR%/MACD%/POC%/VWAP% muss stattdessen der
    // Preis zum Zeitpunkt der Signalgenerierung (signalPriceAtEntry) verwendet
    // werden, sonst lernt das Modell auf leicht verschobenen, zum
    // Entscheidungszeitpunkt nicht verfügbaren Werten. Fällt auf trade.entry
    // zurück, falls ältere Trade-Datensätze das Feld noch nicht besitzen.
    const currentPrice = trade.signalPriceAtEntry != null
      ? finite(trade.signalPriceAtEntry, 0)
      : finite(trade.entry, 0);
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
      const cutoffTime = options.cutoffTime != null ? Number(options.cutoffTime) : null;
      const query = { isPartial: { $ne: true }, pnlUSD: { $exists: true } };
      if (Number.isFinite(cutoffTime)) query.closeTime = { $lt: cutoffTime };
      const trades = await collection.find(query)
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

      // IMPROVED: hyperparameter search is throttled to once daily or every Nth retrain.
      this.retrainCount += 1;
      const nowDay = new Date().toISOString().slice(0, 10);
      const lastSearchDay = this.lastHyperparameterSearchAt ? String(this.lastHyperparameterSearchAt).slice(0, 10) : null;
      const shouldTune = !!force || !this.stats.bestHyperparameters ||
        this.retrainCount % this.hyperparameterSearchEvery === 0 || nowDay !== lastSearchDay;

      const hyperparameterGrid = shouldTune
        ? [
            { learningRate: 0.001, dropoutRate: 0.15, batchSize: 32, units: 32 },
            { learningRate: 0.0005, dropoutRate: 0.2, batchSize: 16, units: 64 },
            { learningRate: 0.003, dropoutRate: 0.1, batchSize: 32, units: 32 }
          ]
        : [this.stats.bestHyperparameters];

      let bestCandidate = null;
      let bestValAccuracy = -1;
      let bestValLoss = Infinity;
      let bestHistory = null;
      let bestBestConfig = null;

      if (shouldTune) {
        this.logger.star?.(`🧠 [TensorFlow.js] Starte Hyperparameter-Tuning (${hyperparameterGrid.length} Kombinationen)...`) ||
        this.logger.info(`🧠 [TensorFlow.js] Starte Hyperparameter-Tuning (${hyperparameterGrid.length} Kombinationen)...`);
      } else {
        this.logger.info('🧠 [TensorFlow.js] Verwende gespeicherte Hyperparameter; Suche wird übersprungen.');
      }

      const xs = tf.tensor2d(xTrain, [xTrain.length, FEATURE_NAMES.length]);
      const ys = tf.tensor2d(yTrain, [yTrain.length, 1]);
      const vx = tf.tensor2d(xVal, [xVal.length, FEATURE_NAMES.length]);
      const vy = tf.tensor2d(yVal, [yVal.length, 1]);

      try {
        for (const config of hyperparameterGrid) {
          const candidateModel = tf.sequential();
          candidateModel.add(tf.layers.dense({ inputShape: [FEATURE_NAMES.length], units: config.units, activation: 'relu', kernelInitializer: 'heNormal' }));
          candidateModel.add(tf.layers.dropout({ rate: config.dropoutRate }));
          candidateModel.add(tf.layers.dense({ units: Math.max(8, config.units / 2), activation: 'relu' }));
          candidateModel.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));

          candidateModel.compile({
            optimizer: tf.train.adam(config.learningRate),
            loss: 'binaryCrossentropy',
            metrics: ['accuracy']
          });

          let history;
          try {
            history = await candidateModel.fit(xs, ys, {
              epochs: Math.min(this.epochs, 50), // Kürzerer Testlauf fürs Tuning
              batchSize: Math.min(config.batchSize, xTrain.length),
              validationData: [vx, vy],
              shuffle: false,
              verbose: 0,
              callbacks: tf.callbacks.earlyStopping({ monitor: 'val_loss', patience: 6, restoreBestWeight: true })
            });
          } catch (fitErr) {
            disposeModelSafely(candidateModel);
            continue;
          }

          // Evaluiere Performance
          const evalResult = candidateModel.evaluate(vx, vy, { verbose: 0 });
          const evalLoss = Array.isArray(evalResult) ? await evalResult[0].data() : await evalResult.data();
          const evalAcc = Array.isArray(evalResult) ? await evalResult[1].data() : [0];
          if (Array.isArray(evalResult)) evalResult.forEach(t => t.dispose()); else evalResult.dispose();

          const acc = finite(evalAcc[0], 0);
          const loss = finite(evalLoss[0], 0);

          // Prio 1: Accuracy, Prio 2: Loss bei gleicher Accuracy
          if (acc > bestValAccuracy || (acc === bestValAccuracy && loss < bestValLoss)) {
            bestValAccuracy = acc;
            bestValLoss = loss;
            if (bestCandidate) disposeModelSafely(bestCandidate);
            bestCandidate = candidateModel;
            bestHistory = history;
            bestBestConfig = config;
          } else {
            disposeModelSafely(candidateModel);
          }
        }
      } finally {
        xs.dispose(); ys.dispose(); vx.dispose(); vy.dispose();
      }

      if (!bestCandidate) {
        return { trained: false, reason: 'tuning-failed' };
      }

      const validationAccuracy = bestValAccuracy;
      const validationLoss = bestValLoss;
      const validationProbabilities = tf.tidy(() => {
        const t = tf.tensor2d(xVal, [xVal.length, FEATURE_NAMES.length]);
        const out = bestCandidate.predict(t);
        return Array.from(out.dataSync());
      });
      const calibration = fitIsotonic(validationProbabilities, yVal);
      const calibratedProbabilities = validationProbabilities.map(p => applyIsotonic(p, calibration));
      const validationBrier = brierScore(calibratedProbabilities, yVal);
      const validationLogLoss = logLoss(calibratedProbabilities, yVal);

      const oldAccuracy = finite(this.stats.validationAccuracy, 0);
      if (!force && this.trained && validationAccuracy + 0.02 < oldAccuracy) {
        this.logger.warn(`🧠 [TensorFlow.js] Neues getuntes Modell verworfen: Val-Accuracy ${(validationAccuracy * 100).toFixed(1)}% vs. aktuell ${(oldAccuracy * 100).toFixed(1)}%.`);
        disposeModelSafely(bestCandidate);
        return { trained: false, reason: 'candidate-model-worse', validationAccuracy, oldAccuracy };
      }

      // Memory leak fix: without this, every successful retrain orphaned the
      // previous tf.LayersModel's tensors (weights, optimizer state) on the
      // heap - tf.js does not garbage-collect them automatically, and this
      // model is retrained repeatedly over the bot's lifetime, so the leak
      // was cumulative and eventually crashed the Node process.
      if (this.model && this.model !== bestCandidate) {
        disposeModelSafely(this.model);
        this.model = null;
      }
      this.model = bestCandidate;
      this.scaler = scaler;
      this.calibration = calibration;
      this.trained = true;
      if (shouldTune) {
        this.lastHyperparameterSearchAt = new Date().toISOString();
      }
      this.stats = {
        trained: true,
        samples: dataset.length,
        trainingSamples: trainSet.length,
        validationSamples: validationSet.length,
        positiveRate: positives / dataset.length,
        validationAccuracy,
        validationLoss,
        validationBrier,
        validationLogLoss,
        calibrationMethod: 'isotonic',
        epochs: bestHistory?.epoch?.length || 0,
        trainedAt: new Date().toISOString(),
        modelVersion: `tfjs-${Date.now()}`,
        featureCount: FEATURE_NAMES.length,
        featureNames: [...FEATURE_NAMES],
        bestHyperparameters: bestBestConfig || this.stats.bestHyperparameters || null,
        hyperparameterSearchAt: this.lastHyperparameterSearchAt,
        retrainCount: this.retrainCount
      };

      await this.save();
      this.logger.info(`🧠 [TensorFlow.js] Getuntes Modell erfolgreich trainiert: ${dataset.length} Trades | Val-Accuracy ${(validationAccuracy * 100).toFixed(1)}% | Val-Loss ${validationLoss.toFixed(4)}`);
      return { trained: true, ...this.getStats() };
    } catch (e) {
      this.logger.error(`🧠 [TensorFlow.js] Training fehlgeschlagen: ${e.stack || e.message}`);
      return { trained: false, reason: e.message };
    } finally {
      this.training = false;
      try { await tf.nextFrame(); } catch (_) {}
    }
  }

  async save() {
    if (!this.model || !this.scaler) throw new Error('Kein Modell/Scaler zum Speichern vorhanden.');
    fs.mkdirSync(this.modelDir, { recursive: true });
    await this.model.save(`file://${this.modelDir}`);
    fs.writeFileSync(path.join(this.modelDir, 'metadata.json'), JSON.stringify({
      scaler: this.scaler,
      stats: this.stats,
      calibration: this.calibration,
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
    this.retrainCount = Number(this.stats.retrainCount || 0);
    this.lastHyperparameterSearchAt = this.stats.hyperparameterSearchAt || null;
    this.calibration = metadata.calibration || null;
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

    // tf.tidy() disposes every tensor allocated inside the callback (the
    // input tensor, whatever model.predict() allocates internally, and the
    // output tensor) as soon as it returns, except the plain JS value we
    // return out of it - this is stricter than manually tracking
    // input/output handles, since it also catches any intermediate
    // tensors a future model architecture might allocate that we don't
    // hold a direct reference to.
    const rawProbability = tf.tidy(() => {
      const input = tf.tensor2d([scaled], [1, FEATURE_NAMES.length]);
      const output = this.model.predict(input);
      return output.dataSync()[0];
    });
    const raw = clamp(rawProbability, 0, 1);
    const probability = applyIsotonic(raw, this.calibration);

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

  /**
   * Explicitly releases the current model's tensors. Not part of the
   * normal retrain cycle (trainFromTrades() already disposes the previous
   * model before assigning the new one) - call this on process shutdown or
   * before discarding a TensorFlowSignalModel instance entirely.
   */
  cleanup() {
    if (this.model) {
      try { this.model.dispose(); } catch (_) {}
      this.model = null;
    }
    this.trained = false;
  }
}

module.exports = { TensorFlowSignalModel, FEATURE_NAMES };
