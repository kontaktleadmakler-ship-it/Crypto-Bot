'use strict';
const tf = require('@tensorflow/tfjs-node');
const fs = require('fs');
const path = require('path');
const { PrioritizedReplayBuffer } = require('./prioritized-replay');
const { ModelRegistry } = require('./model-registry');

/**
 * RL 2.0: Double + Dueling DQN, Prioritized Experience Replay,
 * risk-adjusted rewards, 5 actions, versioned candidate/production models.
 * Safety: this module only produces an action recommendation; RiskEngine and
 * SignalArbitration remain authoritative and execution stays fail-closed.
 */
class DeepQTheTradingAgent {
  constructor(options = {}) {
    this.modelDir = options.modelDir || './models/rl-dqn-v2';
    this.stateSize = options.stateSize || 16;
    this.actionSize = options.actionSize || 5; // HOLD/LONG/SHORT/REDUCE/EXIT
    this.actions = ['HOLD','LONG','SHORT','REDUCE','EXIT'];
    this.gamma = options.gamma ?? 0.99;
    this.epsilon = options.epsilon ?? 1.0;
    this.epsilonMin = options.epsilonMin ?? 0.05;
    this.epsilonDecay = options.epsilonDecay ?? 0.995;
    this.learningRate = options.learningRate ?? 0.0005;
    this.batchSize = options.batchSize || 32;
    this.maxMemorySize = options.maxMemorySize || 10000;
    this.targetUpdateEvery = options.targetUpdateEvery || 100;
    this.trainingSteps = 0;
    this.modelVersion = options.modelVersion || process.env.DQN_MODEL_VERSION || 'dqn-v22.3.1-rl2-dueling-fixed';
    this.model = null;
    this.targetModel = null;
    this.isInitialized = false;
    this.logger = options.logger || console;
    this.replay = new PrioritizedReplayBuffer({
      capacity: this.maxMemorySize,
      alpha: Number(process.env.DQN_REPLAY_ALPHA || 0.6),
      beta: Number(process.env.DQN_REPLAY_BETA || 0.4)
    });
    this.registry = new ModelRegistry({ dir: process.env.DQN_REGISTRY_DIR || './models/registry', logger: this.logger });
  }

  _createModel() {
    const input = tf.input({ shape: [this.stateSize] });
    const h1 = tf.layers.dense({ units: 96, activation: 'relu' }).apply(input);
    const h2 = tf.layers.dense({ units: 64, activation: 'relu' }).apply(h1);
    const value = tf.layers.dense({ units: 32, activation: 'relu' }).apply(h2);
    const advantage = tf.layers.dense({ units: 32, activation: 'relu' }).apply(h2);
    const valueOut = tf.layers.dense({ units: 1, activation: 'linear' }).apply(value);
    const advOut = tf.layers.dense({ units: this.actionSize, activation: 'linear' }).apply(advantage);

    // TensorFlow.js does not provide tf.layers.lambda().
    // Center the advantage stream with fixed, non-trainable Dense layers:
    // mean(A) = A * (1/actionSize)
    // A_centered = A - mean(A)
    // V is replicated across all actions and added to A_centered.
    // TensorFlow.js: .apply() returns a symbolic Tensor. setWeights()
    // must be called on the Layer object itself.
    const meanLayer = tf.layers.dense({
      units: 1, useBias: false, trainable: false, kernelInitializer: 'zeros'
    });
    const meanKernel = tf.tensor2d(
      Array.from({ length: this.actionSize }, () => 1 / this.actionSize),
      [this.actionSize, 1]
    );
    meanLayer.setWeights([meanKernel]);
    meanKernel.dispose();
    const meanAdv = meanLayer.apply(advOut);

    const meanRepLayer = tf.layers.dense({
      units: this.actionSize, useBias: false, trainable: false, kernelInitializer: 'zeros'
    });
    const onesKernel = tf.tensor2d(
      Array.from({ length: this.actionSize }, () => 1), [1, this.actionSize]
    );
    meanRepLayer.setWeights([onesKernel]);
    onesKernel.dispose();
    const centeredAdv = tf.layers.subtract().apply([advOut, meanRepLayer.apply(meanAdv)]);

    const valueRepLayer = tf.layers.dense({
      units: this.actionSize, useBias: false, trainable: false, kernelInitializer: 'zeros'
    });
    const valueKernel = tf.tensor2d(
      Array.from({ length: this.actionSize }, () => 1), [1, this.actionSize]
    );
    valueRepLayer.setWeights([valueKernel]);
    valueKernel.dispose();
    const valueRep = valueRepLayer.apply(valueOut);

    const q = tf.layers.add().apply([valueRep, centeredAdv]);
    const model = tf.model({ inputs: input, outputs: q });
    model.compile({ optimizer: tf.train.adam(this.learningRate), loss: 'meanSquaredError' });
    return model;
  }

  async init() {
    if (this.isInitialized) return;
    fs.mkdirSync(this.modelDir, { recursive: true });
    try {
      const modelPath = path.join(this.modelDir, 'model.json');
      if (fs.existsSync(modelPath)) {
        try {
          this.model = await tf.loadLayersModel(`file://${path.resolve(modelPath)}`);
          const inputShape = this.model.inputs?.[0]?.shape || [];
          const outputShape = this.model.outputs?.[0]?.shape || [];
          if (inputShape[inputShape.length - 1] !== this.stateSize || outputShape[outputShape.length - 1] !== this.actionSize) {
            throw new Error(`DQN model shape mismatch: expected [${this.stateSize}] -> [${this.actionSize}], got ${JSON.stringify(inputShape)} -> ${JSON.stringify(outputShape)}`);
          }
          this.model.compile({ optimizer: tf.train.adam(this.learningRate), loss: 'meanSquaredError' });
          this.targetModel = this._createModel();
          this.updateTargetModel();
        } catch (loadError) {
          // Models created with the old tf.layers.lambda implementation are
          // incompatible with this TensorFlow.js runtime. Never crash the bot.
          // Preserve the legacy model on disk and start a clean compatible model.
          const legacyDir = `${this.modelDir}-legacy-${Date.now()}`;
          try {
            fs.renameSync(this.modelDir, legacyDir);
            fs.mkdirSync(this.modelDir, { recursive: true });
            this.logger.warn(`[RL-Engine] Altes/incompatibles DQN-Modell archiviert: ${legacyDir}`);
          } catch (archiveError) {
            this.logger.warn(`[RL-Engine] Legacy-Modell konnte nicht archiviert werden: ${archiveError.message}`);
          }

          this.logger.warn(`[RL-Engine] Gespeichertes Modell nicht kompatibel (${loadError.message}); starte neues kompatibles Dueling-DQN.`);
          this.model = this._createModel();
          this.targetModel = this._createModel();
          this.updateTargetModel();
        }
      } else {
        this.model = this._createModel();
        this.targetModel = this._createModel();
        this.updateTargetModel();
      }
      const statePath = path.join(this.modelDir, 'state.json');
      if (fs.existsSync(statePath)) {
        const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        if (Number.isFinite(s.epsilon)) this.epsilon = Math.max(this.epsilonMin, Math.min(1, s.epsilon));
        this.trainingSteps = Number(s.trainingSteps || 0);
      }
      this.isInitialized = true;
      this.registry.register({ modelId: this.modelVersion, modelType: 'dueling-double-dqn', features: ['market','agents','risk','microstructure'], status: this.registry.production() ? 'candidate' : 'production' });
      this.logger.info(`🤖 [RL-Engine] RL2 Agent initialisiert (${this.modelVersion}) | PER + Double DQN + Dueling DQN`);
    } catch (e) {
      this.logger.error(`[RL-Engine Init Fehler]: ${e.message}`);
      throw e;
    }
  }

  updateTargetModel() {
    if (!this.model || !this.targetModel) return;
    const weights = this.model.getWeights().map(w => w.clone());
    this.targetModel.setWeights(weights);
    weights.forEach(w => w.dispose());
  }

  actWithMetadata(state) {
    if (!Array.isArray(state) || state.length !== this.stateSize) throw new Error(`Invalid DQN state size: expected ${this.stateSize}`);
    if (!this.model) throw new Error('RL model not initialized');
    if (Math.random() < this.epsilon) return { action: Math.floor(Math.random() * this.actionSize), actionName: 'EXPLORATION', exploration: true, qValues: null, modelVersion: this.modelVersion };
    const qValues = tf.tidy(() => Array.from(this.model.predict(tf.tensor2d([state])).dataSync()));
    let action = 0;
    for (let i = 1; i < qValues.length; i++) if (qValues[i] > qValues[action]) action = i;
    return { action, actionName: this.actions[action], exploration: false, qValues, modelVersion: this.modelVersion };
  }

  act(state) { return this.actWithMetadata(state).action; }

  shouldVetoCandidate(action, direction) {
    const d = String(direction || '').toUpperCase();
    if (action === 0 || action === 3 || action === 4) return true;
    if (d === 'LONG' && action === 2) return true;
    if (d === 'SHORT' && action === 1) return true;
    return false;
  }

  static riskAdjustedReward({ pnlUSD = 0, drawdownPct = 0, slippagePct = 0, exposurePct = 0, goodExit = false } = {}) {
    const pnl = Math.max(-5, Math.min(5, pnlUSD / 50));
    const riskPenalty = Math.abs(drawdownPct) * 0.08 + Math.abs(slippagePct) * 0.12 + Math.abs(exposurePct) * 0.03;
    return pnl - riskPenalty + (goodExit ? 0.5 : 0);
  }

  remember(state, action, reward, nextState, done, meta = {}) {
    const item = { state, action, reward, nextState, done, meta, tdError: Math.abs(Number(reward || 0)) + 1 };
    this.replay.add(item, item.tdError);
  }

  async train() {
    if (this.replay.size < this.batchSize || !this.model || !this.targetModel) return { trained: false, reason: 'not-enough-memory' };
    const { items: batch, indices, weights } = this.replay.sample(this.batchSize);
    const states = batch.map(b => b.state);
    const nextStates = batch.map(b => b.nextState);
    const current = tf.tensor2d(states);
    const next = tf.tensor2d(nextStates);
    const currentQ = this.model.predict(current);
    const nextOnline = this.model.predict(next);
    const nextTarget = this.targetModel.predict(next);
    const cq = currentQ.arraySync();
    const no = nextOnline.arraySync();
    const nt = nextTarget.arraySync();
    const y = [];
    const errors = [];
    for (let i = 0; i < batch.length; i++) {
      const target = [...cq[i]];
      let bootstrap = 0;
      if (!batch[i].done) {
        let best = 0;
        for (let a = 1; a < this.actionSize; a++) if (no[i][a] > no[i][best]) best = a;
        bootstrap = nt[i][best];
      }
      const targetValue = batch[i].done ? batch[i].reward : batch[i].reward + this.gamma * bootstrap;
      errors.push(Math.abs(targetValue - cq[i][batch[i].action]))
      target[batch[i].action] = targetValue;
      y.push(target);
    }
    const xs = tf.tensor2d(states);
    const ys = tf.tensor2d(y);
    const sw = tf.tensor1d(weights);
    await this.model.fit(xs, ys, { epochs: 1, verbose: 0, sampleWeight: sw });
    [current,next,currentQ,nextOnline,nextTarget,xs,ys,sw].forEach(t => t && t.dispose());
    this.replay.updatePriorities(indices, errors);
    this.trainingSteps++;
    if (this.trainingSteps % this.targetUpdateEvery === 0) this.updateTargetModel();
    if (this.epsilon > this.epsilonMin) this.epsilon = Math.max(this.epsilonMin, this.epsilon * this.epsilonDecay);
    return { trained: true, epsilon: this.epsilon, memorySize: this.replay.size, trainingSteps: this.trainingSteps };
  }

  async learnFromTick(state, action, reward, nextState, done = false, meta = {}) {
    this.remember(state, action, reward, nextState, done, meta);
    return this.train();
  }

  adjustEpsilonBasedOnPerformance(recentTrades) {
    if (!Array.isArray(recentTrades) || recentTrades.length < 5) return;
    const last = recentTrades.slice(-5);
    const losses = last.filter(t => Number(t.pnlUSD || 0) < 0).length;
    if (losses >= 4) this.epsilon = Math.min(0.4, this.epsilon + 0.10);
  }

  async trainFromClosedTrades(collection) {
    if (!collection) return { trained: false, reason: 'no-db-collection' };
    const trades = await collection.find({ isPartial: { $ne: true }, closeTime: { $exists: true } }).sort({ closeTime: 1 }).limit(1000).toArray();
    if (trades.length < 10) return { trained: false, reason: 'not-enough-trades', samples: trades.length };
    this.adjustEpsilonBasedOnPerformance(trades);
    for (let i = 0; i < trades.length - 1; i++) {
      const t = trades[i], n = trades[i + 1];
      const state = this.tradeToState(t), nextState = this.tradeToState(n);
      const action = t.direction === 'LONG' ? 1 : t.direction === 'SHORT' ? 2 : 0;
      const reward = DeepQTheTradingAgent.riskAdjustedReward({ pnlUSD: t.pnlUSD, drawdownPct: t.drawdownPct || 0, slippagePct: t.slippagePct || 0, exposurePct: t.exposurePct || 0, goodExit: Boolean(t.goodExit) });
      this.remember(state, action, reward, nextState, i === trades.length - 2, { symbol: t.symbol, regime: t.marketPhase });
    }
    let result = { trained: false };
    for (let i = 0; i < 10; i++) result = await this.train();
    await this.save();
    this.logger.info(`🤖 [RL-Engine] RL2 trainiert: ${trades.length - 1} Experiences | PER | Double DQN | Dueling DQN`);
    return { trained: true, samples: trades.length - 1, ...result };
  }

  tradeToState(t) {
    return [
      Number(t.adxAtEntry || 25) / 50,
      Number(t.rsiAtEntry || 50) / 100,
      Number(t.hurstAtEntry || 0.5),
      Math.min(Number(t.relativeVolumeAtEntry || 1) / 5, 1),
      Number(t.signalScore || 50) / 100,
      t.direction === 'LONG' ? 1 : 0,
      t.marketPhase === 'TRENDING' ? 1 : 0,
      t.marketPhase === 'RANGING' ? 0.5 : 0,
      Number(t.atrPctAtEntry || 0.02),
      Number(t.pocDistancePctAtEntry || 0),
      Number(t.vwapDistancePctAtEntry || 0),
      Number(t.orderBookImbalanceAtEntry || 1),
      Number(t.spreadPctAtEntry || 0.1),
      Number(t.volatilityRatioAtEntry || 1),
      Number(t.mlProbabilityAtEntry || 0.5),
      Number(t.confluenceScore || 60) / 100
    ];
  }

  async save() {
    if (!this.model) return;
    fs.mkdirSync(this.modelDir, { recursive: true });
    await this.model.save(`file://${path.resolve(this.modelDir)}`);
    fs.writeFileSync(path.join(this.modelDir, 'state.json'), JSON.stringify({ epsilon: this.epsilon, trainingSteps: this.trainingSteps, modelVersion: this.modelVersion, algorithm: 'Double-Dueling-DQN', replay: 'PER', actions: this.actions }, null, 2));
  }

  getStats() {
    return { epsilon: Number(this.epsilon.toFixed(3)), memorySize: this.replay.size, isInitialized: this.isInitialized, modelVersion: this.modelVersion, trainingSteps: this.trainingSteps, algorithm: 'Double-Dueling-DQN', prioritizedReplay: true, actions: this.actions };
  }
}
module.exports = { DeepQTheTradingAgent };
