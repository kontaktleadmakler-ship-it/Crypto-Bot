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

function classificationMetrics(probabilities, labels, threshold = 0.5) {
  let tp = 0, tn = 0, fp = 0, fn = 0;
  for (let i = 0; i < probabilities.length; i++) {
    const pred = Number(probabilities[i]) >= threshold ? 1 : 0;
    const y = Number(labels[i]) ? 1 : 0;
    if (pred === 1 && y === 1) tp++;
    else if (pred === 0 && y === 0) tn++;
    else if (pred === 1) fp++;
    else fn++;
  }
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const specificity = tn + fp ? tn / (tn + fp) : 0;
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const predictedPositive = tp + fp;
  const predictedNegative = tn + fn;
  return { tp, tn, fp, fn, precision, recall, specificity, balancedAccuracy, predictedPositive, predictedNegative };
}

function probabilityMetrics(probabilities, labels, bins = 10) {
  if (!probabilities.length || probabilities.length !== labels.length) return { brierScore: 0, logLoss: 0, calibrationError: 0 };
  let brier = 0, logLoss = 0;
  const bucket = Array.from({ length: bins }, () => ({ n: 0, sumP: 0, sumY: 0 }));
  for (let i=0;i<probabilities.length;i++) {
    const p = clamp(Number(probabilities[i]), 1e-7, 1 - 1e-7);
    const y = Number(labels[i]) ? 1 : 0;
    brier += Math.pow(p-y, 2);
    logLoss += -(y*Math.log(p) + (1-y)*Math.log(1-p));
    const b = Math.min(bins-1, Math.floor(p*bins)); bucket[b].n++; bucket[b].sumP+=p; bucket[b].sumY+=y;
  }
  let ece = 0;
  for (const b of bucket) if (b.n) ece += (b.n/probabilities.length) * Math.abs(b.sumP/b.n - b.sumY/b.n);
  return { brierScore: brier/probabilities.length, logLoss: logLoss/probabilities.length, calibrationError: ece };
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
      validationBalancedAccuracy: 0,
      validationPrecision: 0,
      validationRecall: 0,
      selectionScore: 0,
      epochs: 0,
      trainedAt: null,
      modelVersion: null,
      featureCount: FEATURE_NAMES.length,
      featureNames: FEATURE_NAMES,
      bestHyperparameters: null,
      validationLabelCounts: { positive: 0, negative: 0 },
      validationPredictionCounts: { positive: 0, negative: 0 },
      validationQuality: 'UNTRAINED'
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
    // Neue Trades verwenden den echten Signalpreis. Legacy-Trades besitzen
    // dieses Feld ggf. noch nicht. Ein Preis ist für das Feature-Set aber
    // NICHT grundsätzlich erforderlich: wenn die bereits gespeicherten
    // Prozentwerte vorhanden sind, können wir die Zeile leak-frei trainieren.
    // Nur dort, wo ein Rohwert erst über den Entry-Preis normalisiert werden
    // müsste, verlangen wir einen belastbaren Preis.
    const signalPrice = Number(trade?.signalPriceAtEntry);
    const fillPrice = Number(trade?.entry);
    const legacyPrice = Number(
      trade?.entryPrice ?? trade?.paperEntryPrice ?? trade?.executionEntryPrice ??
      trade?.avgFillPrice ?? trade?.fillPrice
    );
    const currentPrice = Number.isFinite(signalPrice) && signalPrice > 0
      ? signalPrice
      : (Number.isFinite(fillPrice) && fillPrice > 0
        ? fillPrice
        : (Number.isFinite(legacyPrice) && legacyPrice > 0 ? legacyPrice : NaN));

    const hasAtrPct = trade?.atrPctAtEntry != null && Number.isFinite(Number(trade.atrPctAtEntry));
    const hasMacdPct = trade?.macdHistogramPctAtEntry != null && Number.isFinite(Number(trade.macdHistogramPctAtEntry));

    // Wenn nur bereits normalisierte Entry-Features vorliegen, darf die Zeile
    // auch ohne Entry-Preis verwendet werden. Das verhindert, dass alte,
    // ansonsten vollständige Datensätze fälschlich komplett verworfen werden.
    const needsPriceForDerivedFeature =
      (!hasAtrPct && Number.isFinite(Number(trade?.atrAtEntry)) && Number(trade.atrAtEntry) !== 0) ||
      (!hasMacdPct && Number.isFinite(Number(trade?.macdHistogramAtEntry)) && Number(trade.macdHistogramAtEntry) !== 0);
    if (!Number.isFinite(currentPrice) && needsPriceForDerivedFeature) return null;

    const atrPct = hasAtrPct
      ? finite(trade.atrPctAtEntry, 0)
      : (Number.isFinite(currentPrice) && currentPrice > 0 && trade?.atrAtEntry
        ? (finite(trade.atrAtEntry) / currentPrice) * 100
        : 0);

    const macdHistogramPct = hasMacdPct
      ? finite(trade.macdHistogramPctAtEntry, 0)
      : (Number.isFinite(currentPrice) && currentPrice > 0
        ? (finite(trade.macdHistogramAtEntry, 0) / currentPrice) * 100
        : 0);

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
      this.logger.info(`🧠 [TensorFlow.js] Training gestartet | backend=${tf.getBackend()} | force=${force}`);
      const trades = await collection.find({
        isPartial: { $ne: true },
        pnlUSD: { $exists: true, $ne: null }
      })
        // Use the newest completed trades, then restore chronological order.
        // Training on the oldest 2,000 trades caused severe regime staleness.
        .sort({ closeTime: -1 })
        .limit(this.maxSamples)
        .toArray();
      trades.reverse();

      const legacyWithoutSignalPrice = trades.filter(t => !(Number.isFinite(Number(t.signalPriceAtEntry)) && Number(t.signalPriceAtEntry) > 0)).length;
      this.logger.info(`🧠 [TensorFlow.js] Trainingsdaten geladen: raw=${trades.length}, min=${this.minSamples}, legacyEntryFallback=${legacyWithoutSignalPrice}`);

      if (trades.length < this.minSamples) {
        this.logger.warn(`🧠 [TensorFlow.js] Zu wenige Trainingsdaten: ${trades.length}/${this.minSamples}`);
        return { trained: false, reason: 'not-enough-data', samples: trades.length };
      }

      const mapped = trades.map(trade => ({
        trade,
        features: this.featuresFromTrade(trade),
        label: finite(trade.pnlUSD, 0) > 0 ? 1 : 0
      }));
      const dataset = mapped
        .filter(item => Array.isArray(item.features) && item.features.length === FEATURE_NAMES.length && item.features.every(Number.isFinite));

      if (dataset.length < this.minSamples) {
        const invalid = trades.length - dataset.length;
        const invalidReasons = {
          missingPriceForDerivedFeatures: 0,
          invalidFeatureVector: 0,
          missingPnl: 0
        };
        for (const item of mapped) {
          const t = item.trade || {};
          if (!Number.isFinite(Number(t.pnlUSD))) invalidReasons.missingPnl++;
          if (!item.features) {
            const hasPrice = [t.signalPriceAtEntry, t.entry, t.entryPrice, t.paperEntryPrice, t.executionEntryPrice, t.avgFillPrice, t.fillPrice]
              .some(v => Number.isFinite(Number(v)) && Number(v) > 0);
            const hasAtrPct = t.atrPctAtEntry != null && Number.isFinite(Number(t.atrPctAtEntry));
            const hasRawAtr = Number.isFinite(Number(t.atrAtEntry)) && Number(t.atrAtEntry) !== 0;
            const hasMacdPct = t.macdHistogramPctAtEntry != null && Number.isFinite(Number(t.macdHistogramPctAtEntry));
            const hasRawMacd = Number.isFinite(Number(t.macdHistogramAtEntry)) && Number(t.macdHistogramAtEntry) !== 0;
            if (!hasPrice && ((!hasAtrPct && hasRawAtr) || (!hasMacdPct && hasRawMacd))) invalidReasons.missingPriceForDerivedFeatures++;
            else invalidReasons.invalidFeatureVector++;
          }
        }
        this.logger.warn(`🧠 [TensorFlow.js] Zu wenige valide Trainingszeilen: valid=${dataset.length}/${this.minSamples}, invalid=${invalid} reasons=${JSON.stringify(invalidReasons)}`);
        return { trained: false, reason: 'not-enough-valid-data', samples: dataset.length, rawSamples: trades.length, invalidSamples: invalid, invalidReasons, legacyEntryFallback: legacyWithoutSignalPrice };
      }

      const positives = dataset.filter(x => x.label === 1).length;
      const negatives = dataset.length - positives;
      const positiveRate = positives / Math.max(1, dataset.length);
      this.logger.info(`🧠 [TensorFlow.js] Dataset-Qualität: samples=${dataset.length} wins=${positives} losses=${negatives} winRate=${(positiveRate * 100).toFixed(1)}%`);
      if (positives < 5 || negatives < 5) {
        this.logger.warn(`🧠 [TensorFlow.js] Zu wenig Klassenvielfalt: wins=${positives}, losses=${negatives}`);
        return { trained: false, reason: 'insufficient-class-balance', samples: dataset.length, positiveSamples: positives, negativeSamples: negatives };
      }

      const splitIndex = Math.max(1, Math.floor(dataset.length * 0.80));
      const trainSet = dataset.slice(0, splitIndex);
      const validationSet = dataset.slice(splitIndex);
      const validationPositiveLabels = validationSet.filter(x => x.label === 1).length;
      const validationNegativeLabels = validationSet.length - validationPositiveLabels;
      this.logger.info(`🧠 [TensorFlow.js] Validation-Set: samples=${validationSet.length} wins=${validationPositiveLabels} losses=${validationNegativeLabels}`);

      const scaler = this.makeScaler(trainSet.map(x => x.features));
      const xTrain = this.scaleMatrix(trainSet.map(x => x.features), scaler);
      const yTrain = trainSet.map(x => x.label);
      const xVal = this.scaleMatrix(validationSet.map(x => x.features), scaler);
      const yVal = validationSet.map(x => x.label);

      // --- HYPERPARAMETER TUNING SCHLEIFE ---
      const hyperparameterGrid = [
        { learningRate: 0.001, dropoutRate: 0.15, batchSize: 32, units: 32 },
        { learningRate: 0.0005, dropoutRate: 0.2, batchSize: 16, units: 64 },
        { learningRate: 0.003, dropoutRate: 0.1, batchSize: 32, units: 32 }
      ];

      let bestCandidate = null;
      let bestSelectionScore = -Infinity;
      let bestValAccuracy = -1;
      let bestValLoss = Infinity;
      let bestClassification = null;
      let bestHistory = null;
      let bestBestConfig = null;
      let lastFitError = null;

      this.logger.star?.(`🧠 [TensorFlow.js] Starte automatisches Hyperparameter-Tuning (${hyperparameterGrid.length} Kombinationen)...`) || 
      this.logger.info(`🧠 [TensorFlow.js] Starte automatisches Hyperparameter-Tuning (${hyperparameterGrid.length} Kombinationen)...`);

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
              callbacks: tf.callbacks.earlyStopping({ monitor: 'val_loss', patience: 6, restoreBestWeights: false })
            });
          } catch (fitErr) {
            lastFitError = fitErr;
            this.logger.error(`🧠 [TensorFlow.js] Fit-Fehler (lr=${config.learningRate}, units=${config.units}, batch=${config.batchSize}): ${fitErr.message}`);
            candidateModel.dispose();
            continue;
          }

          // Evaluiere Performance
          const evalResult = candidateModel.evaluate(vx, vy, { verbose: 0 });
          const evalLoss = Array.isArray(evalResult) ? await evalResult[0].data() : await evalResult.data();
          const evalAcc = Array.isArray(evalResult) ? await evalResult[1].data() : [0];
          if (Array.isArray(evalResult)) evalResult.forEach(t => t.dispose()); else evalResult.dispose();

          const acc = finite(evalAcc[0], 0);
          const loss = finite(evalLoss[0], 0);
          const candidateProbs = tf.tidy(() => Array.from(candidateModel.predict(tf.tensor2d(xVal, [xVal.length, FEATURE_NAMES.length])).dataSync()));
          const cls = classificationMetrics(candidateProbs, yVal);
          const prob = probabilityMetrics(candidateProbs, yVal);
          // Trading models should not win a tuning round merely by predicting
          // the majority class. Favor balanced accuracy and calibration while
          // retaining some weight for raw accuracy.
          const selectionScore = 0.45 * cls.balancedAccuracy + 0.20 * acc + 0.20 * (1 - prob.brierScore) + 0.15 * (1 - prob.calibrationError);

          if (selectionScore > bestSelectionScore || (Math.abs(selectionScore - bestSelectionScore) < 1e-9 && loss < bestValLoss)) {
            bestSelectionScore = selectionScore;
            bestValAccuracy = acc;
            bestValLoss = loss;
            bestClassification = cls;
            if (bestCandidate) bestCandidate.dispose();
            bestCandidate = candidateModel;
            bestHistory = history;
            bestBestConfig = config;
          } else {
            candidateModel.dispose();
          }
        }
      } finally {
        xs.dispose(); ys.dispose(); vx.dispose(); vy.dispose();
      }

      if (!bestCandidate) {
        const reason = lastFitError ? `tuning-failed: ${lastFitError.message}` : 'tuning-failed';
        this.logger.error(`🧠 [TensorFlow.js] Kein trainierbares Modell: ${reason}`);
        return { trained: false, reason, samples: dataset.length, positiveSamples: positives, negativeSamples: negatives };
      }

      let probabilityStats = { brierScore: 0, logLoss: 0, calibrationError: 0 };
      try {
        const probs = tf.tidy(() => Array.from(bestCandidate.predict(tf.tensor2d(xVal, [xVal.length, FEATURE_NAMES.length])).dataSync()));
        probabilityStats = probabilityMetrics(probs, yVal);
      } catch (metricErr) {
        this.logger.warn(`[TensorFlow.js] Probability-Metriken konnten nicht berechnet werden: ${metricErr.message}`);
      }

      const validationAccuracy = bestValAccuracy;
      const validationLoss = bestValLoss;
      const validationBalancedAccuracy = finite(bestClassification?.balancedAccuracy, 0);
      const validationPrecision = finite(bestClassification?.precision, 0);
      const validationRecall = finite(bestClassification?.recall, 0);
      const validationPredictedPositive = Number(bestClassification?.predictedPositive || 0);
      const validationPredictedNegative = Number(bestClassification?.predictedNegative || 0);
      const validationQuality = validationSet.length < 20
        ? 'LOW_SAMPLE'
        : (validationPredictedPositive === 0 || validationPrecision === 0 || validationRecall === 0
          ? 'WEAK_POSITIVE_DETECTION'
          : (validationBalancedAccuracy < 0.55 ? 'WEAK_DISCRIMINATION' : 'USABLE_SHADOW_ONLY'));

      this.logger.info(`🧠 [TensorFlow.js] Validation-Diagnose: labels=+${validationPositiveLabels}/-${validationNegativeLabels} predictions=+${validationPredictedPositive}/-${validationPredictedNegative} quality=${validationQuality}`);

      const oldAccuracy = finite(this.stats.validationAccuracy, 0);
      if (!force && this.trained && validationAccuracy + 0.02 < oldAccuracy) {
        this.logger.warn(`🧠 [TensorFlow.js] Neues getuntes Modell verworfen: Val-Accuracy ${(validationAccuracy * 100).toFixed(1)}% vs. aktuell ${(oldAccuracy * 100).toFixed(1)}%.`);
        bestCandidate.dispose();
        return { trained: false, reason: 'candidate-model-worse', validationAccuracy, oldAccuracy };
      }

      // Memory leak fix: without this, every successful retrain orphaned the
      // previous tf.LayersModel's tensors (weights, optimizer state) on the
      // heap - tf.js does not garbage-collect them automatically, and this
      // model is retrained repeatedly over the bot's lifetime, so the leak
      // was cumulative and eventually crashed the Node process.
      if (this.model && this.model !== bestCandidate) {
        this.model.dispose();
        this.model = null;
      }
      this.model = bestCandidate;
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
        validationBalancedAccuracy,
        validationPrecision,
        validationRecall,
        selectionScore: bestSelectionScore,
        brierScore: probabilityStats.brierScore,
        logLoss: probabilityStats.logLoss,
        calibrationError: probabilityStats.calibrationError,
        epochs: bestHistory?.epoch?.length || 0,
        trainedAt: new Date().toISOString(),
        modelVersion: `tfjs-${Date.now()}`,
        featureCount: FEATURE_NAMES.length,
        featureNames: [...FEATURE_NAMES],
        bestHyperparameters: bestBestConfig || null,
        validationLabelCounts: { positive: validationPositiveLabels, negative: validationNegativeLabels },
        validationPredictionCounts: { positive: validationPredictedPositive, negative: validationPredictedNegative },
        validationQuality
      };

      await this.save();
      this.logger.info(`🧠 [TensorFlow.js] Getuntes Modell erfolgreich trainiert: ${dataset.length} Trades | Val-Acc ${(validationAccuracy * 100).toFixed(1)}% | Balanced ${(validationBalancedAccuracy * 100).toFixed(1)}% | Precision ${(validationPrecision * 100).toFixed(1)}% | Recall ${(validationRecall * 100).toFixed(1)}% | Brier ${probabilityStats.brierScore.toFixed(4)} | ECE ${probabilityStats.calibrationError.toFixed(4)} | Quality ${validationQuality}`);
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
    const probability = clamp(rawProbability, 0, 1);

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
