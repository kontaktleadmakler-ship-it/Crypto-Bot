/**
 * ============================================================================
 * TRADING SIGNAL BOT - DEEP REINFORCEMENT LEARNING ENGINE (DQN)
 * (TensorFlow.js basierter RL-Agent für adaptive Handlungsentscheidungen)
 * ============================================================================
 */

const tf = require('@tensorflow/tfjs-node');
const fs = require('fs');
const path = require('path');

class DeepQTheTradingAgent {
  constructor(options = {}) {
    this.modelDir = options.modelDir || './models/rl-dqn-model';
    this.stateSize = options.stateSize || 16; // Anzahl der Markt-Features (inkl. Confluence-Score)
    this.actionSize = options.actionSize || 3; // 0: Nichts tun, 1: Long, 2: Short
    
    // RL Hyperparameter
    this.gamma = options.gamma || 0.99;          // Diskontierungsfaktor für zukünftige Rewards
    this.epsilon = options.epsilon || 1.0;       // Start-Epsilon für Exploration (Erforschritt)
    this.epsilonMin = options.epsilonMin || 0.05; // Minimales Epsilon
    this.epsilonDecay = options.epsilonDecay || 0.995;
    this.learningRate = options.learningRate || 0.001;
    
    this.memory = [];
    this.maxMemorySize = options.maxMemorySize || 2000;
    this.batchSize = options.batchSize || 32;
    
    this.model = null;
    this.targetModel = null;
    this.isInitialized = false;
    this.logger = options.logger || console;
    this.modelVersion = options.modelVersion || process.env.DQN_MODEL_VERSION || 'dqn-v22.2';
    this.trainingSteps = 0;
  }

  /**
   * Erstellt das neuronale Netzwerk für das DQN
   */
  _createModel() {
    const model = tf.sequential();
    
    model.add(tf.layers.dense({
      inputShape: [this.stateSize],
      units: 64,
      activation: 'relu'
    }));
    model.add(tf.layers.dropout({ rate: 0.2 }));
    
    model.add(tf.layers.dense({
      units: 32,
      activation: 'relu'
    }));
    
    model.add(tf.layers.dense({
      units: this.actionSize,
      activation: 'linear' // Gibt die Q-Werte für jede Aktion aus
    }));

    model.compile({
      optimizer: tf.train.adam(this.learningRate),
      loss: 'meanSquaredError'
    });

    return model;
  }

  /**
   * Initialisiert das Haupt- und das Target-Netzwerk
   */
  async init() {
    if (this.isInitialized) return;
    
    try {
      this.model = this._createModel();
      this.targetModel = this._createModel();
      this.updateTargetModel();
      
      if (!fs.existsSync(this.modelDir)) {
        fs.mkdirSync(this.modelDir, { recursive: true });
      }

      const modelPath = path.join(this.modelDir, 'model.json');
      if (fs.existsSync(modelPath)) {
        await this.load();
      }
      
      this.isInitialized = true;
      this.logger.info(`🤖 [RL-Engine] DQN Agent initialisiert (${this.modelVersion}).`);
    } catch (e) {
      this.logger.error(`[RL-Engine Init Fehler]: ${e.message}`);
      this.isInitialized = false;
      throw e;
    }
  }

  /**
   * Synchronisiert die Gewichte des Hauptmodells mit dem Target-Modell
   */
  updateTargetModel() {
    if (!this.model || !this.targetModel) return;
    const weights = this.model.getWeights();
    const targetWeights = weights.map(w => w.clone());
    this.targetModel.setWeights(targetWeights);
  }

  /**
   * Wählt eine Aktion aus basierend auf Epsilon-Greedy-Policy
   * @param {number[]} state 
   * @returns {number} 0: Hold, 1: Long, 2: Short
   */
  actWithMetadata(state) {
    if (!Array.isArray(state) || state.length !== this.stateSize) throw new Error(`Invalid DQN state size: expected ${this.stateSize}`);
    const explore = Math.random() < this.epsilon;
    if (explore) return { action: Math.floor(Math.random() * this.actionSize), exploration: true, qValues: null, modelVersion: this.modelVersion };
    const qValues = tf.tidy(() => {
      const t = tf.tensor2d([state]);
      const pred = this.model.predict(t);
      return Array.from(pred.dataSync());
    });
    let action = 0;
    for (let i = 1; i < qValues.length; i++) if (qValues[i] > qValues[action]) action = i;
    return { action, exploration: false, qValues, modelVersion: this.modelVersion };
  }

  act(state) { return this.actWithMetadata(state).action; }

  /**
   * Speichert eine Erfahrung im Replay Memory
   */
  remember(state, action, reward, nextState, done) {
    if (this.memory.length >= this.maxMemorySize) {
      this.memory.shift();
    }
    this.memory.push({ state, action, reward, nextState, done });
  }

  /**
   * Trainiert das DQN mit einem Mini-Batch aus dem Memory (Experience Replay)
   */
  async train() {
    if (this.memory.length < this.batchSize) return { trained: false, reason: 'not-enough-memory' };

    // Zufällige Samples aus dem Memory ziehen
    const batch = [];
    for (let i = 0; i < this.batchSize; i++) {
      const index = Math.floor(Math.random() * this.memory.length);
      batch.push(this.memory[index]);
    }

    const states = batch.map(b => b.state);
    const nextStates = batch.map(b => b.nextState);

    const statesTensor = tf.tensor2d(states);
    const nextStatesTensor = tf.tensor2d(nextStates);

    const currentQs = this.model.predict(statesTensor);
    const nextQs = this.targetModel.predict(nextStatesTensor);

    const currentQsData = currentQs.arraySync();
    const nextQsData = nextQs.arraySync();

    const X = [];
    const Y = [];

    for (let i = 0; i < batch.length; i++) {
      const { action, reward, done } = batch[i];
      const targetQ = [...currentQsData[i]];

      if (done) {
        targetQ[action] = reward;
      } else {
        const maxNextQ = Math.max(...nextQsData[i]);
        targetQ[action] = reward + this.gamma * maxNextQ;
      }

      X.push(states[i]);
      Y.push(targetQ);
    }

    const xTensor = tf.tensor2d(X);
    const yTensor = tf.tensor2d(Y);

    await this.model.fit(xTensor, yTensor, {
      epochs: 1,
      verbose: 0
    });

    // Aufräumen im Tensor-Speicher, um Memory Leaks zu verhindern
    statesTensor.dispose();
    nextStatesTensor.dispose();
    currentQs.dispose();
    nextQs.dispose();
    xTensor.dispose();
    yTensor.dispose();

    this.trainingSteps++;

    // Epsilon abbauen (weniger Exploration, mehr Fokus auf gelerntes Wissen)
    if (this.epsilon > this.epsilonMin) {
      this.epsilon *= this.epsilonDecay;
    }

    return { trained: true, epsilon: this.epsilon, memorySize: this.memory.length };
  }

  /**
   * NEU: Kontinuierliches Online-Lernen im Hintergrund (nach jeder neuen Marktbewegung/Tick)
   */
  async learnFromTick(state, action, reward, nextState) {
    this.remember(state, action, reward, nextState, false);
    return await this.train();
  }

  /**
   * NEU: Adaptives Epsilon – prüft die Performance der letzten Trades und erhöht
   * die Neugier (Epsilon) automatisch, wenn der Bot in eine Verlustphase gerät.
   */
  adjustEpsilonBasedOnPerformance(recentTrades) {
    if (!recentTrades || recentTrades.length < 5) return;
    
    // Prüfen, ob die letzten Trades überwiegend Verluste waren
    const lastFew = recentTrades.slice(0, 5);
    const lossesCount = lastFew.filter(t => (t.pnlUSD || 0) < 0).length;

    if (lossesCount >= 4) {
      // Performance bricht ein -> Epsilon anheben, damit der Agent wieder aktiver experimentiert
      this.epsilon = Math.min(0.4, this.epsilon + 0.15);
      this.logger.info(`🔄 [RL-Engine] Schlechte Performance erkannt. Adaptives Epsilon auf ${this.epsilon.toFixed(2)} erhöht, um neue Strategien zu testen.`);
    }
  }

  /**
   * Wandelt Closed Trades aus der MongoDB in RL-Erfahrungen um und trainiert das Netz
   * (Erweitert um Confluence-Score, optimiertes Reward Shaping und adaptives Epsilon)
   */
  async trainFromClosedTrades(closedTradesCollection) {
    try {
      if (!closedTradesCollection) return { trained: false, reason: 'no-db-collection' };
      
      const trades = await closedTradesCollection.find({ isPartial: { $ne: true }, closeTime: { $exists: true } }).sort({ closeTime: 1 }).limit(500).toArray();
      if (trades.length < 10) return { trained: false, reason: 'not-enough-trades' };

      // Adaptives Epsilon basierend auf den jüngsten Trades anpassen
      this.adjustEpsilonBasedOnPerformance(trades);

      let addedCount = 0;
      for (let i = 0; i < trades.length - 1; i++) {
        const t = trades[i];
        
        // Zustand aus den Entry-Parametern rekonstruieren (inkl. Confluence-Score Feature am Ende)
        const state = [
          t.adxAtEntry ? t.adxAtEntry / 50 : 0.5,
          t.rsiAtEntry ? t.rsiAtEntry / 100 : 0.5,
          t.hurstAtEntry || 0.5,
          t.relativeVolumeAtEntry ? Math.min(t.relativeVolumeAtEntry / 5, 1) : 0.2,
          t.signalScore ? t.signalScore / 100 : 0.5,
          t.direction === 'LONG' ? 1 : 0,
          t.marketPhase === 'TRENDING' ? 1 : 0,
          t.marketPhase === 'RANGING' ? 0.5 : 0,
          t.atrPctAtEntry || 0.02,
          t.pocDistancePctAtEntry || 0,
          t.vwapDistancePctAtEntry || 0,
          t.orderBookImbalanceAtEntry || 1,
          t.spreadPctAtEntry || 0.1,
          t.volatilityRatioAtEntry || 1,
          t.mlProbabilityAtEntry || 0.5,
          t.confluenceScore ? t.confluenceScore / 100 : 0.6 // Confluence-Score als 16. Feature
        ];

        const action = t.direction === 'LONG' ? 1 : 2;
        
        // ---- VERBESSERTES REWARD SHAPING ----
        const pnlUSD = t.pnlUSD || 0;
        let baseReward = pnlUSD > 0 ? Math.min(pnlUSD / 50, 5) : Math.max(pnlUSD / 50, -5);
        
        const confluenceScore = t.confluenceScore || 60;
        let confluenceBonus = 0;
        if (pnlUSD > 0 && confluenceScore >= 70) {
          confluenceBonus = 1.0; 
        } else if (pnlUSD < 0 && confluenceScore >= 70) {
          confluenceBonus = -1.0; 
        }
        
        const reward = baseReward + confluenceBonus;
        // -------------------------------------
        
        const nextT = trades[i + 1];
        const nextState = [
          nextT.adxAtEntry ? nextT.adxAtEntry / 50 : 0.5,
          nextT.rsiAtEntry ? nextT.rsiAtEntry / 100 : 0.5,
          nextT.hurstAtEntry || 0.5,
          nextT.relativeVolumeAtEntry ? Math.min(nextT.relativeVolumeAtEntry / 5, 1) : 0.2,
          nextT.signalScore ? nextT.signalScore / 100 : 0.5,
          nextT.direction === 'LONG' ? 1 : 0,
          nextT.marketPhase === 'TRENDING' ? 1 : 0,
          nextT.marketPhase === 'RANGING' ? 0.5 : 0,
          nextT.atrPctAtEntry || 0.02,
          nextT.pocDistancePctAtEntry || 0,
          nextT.vwapDistancePctAtEntry || 0,
          nextT.orderBookImbalanceAtEntry || 1,
          nextT.spreadPctAtEntry || 0.1,
          nextT.volatilityRatioAtEntry || 1,
          nextT.mlProbabilityAtEntry || 0.5,
          nextT.confluenceScore ? nextT.confluenceScore / 100 : 0.6
        ];

        this.remember(state, action, reward, nextState, false);
        addedCount++;
      }

      // Mehrere Durchläufe mit dem Memory machen, um das DQN anzulernen
      let trainResult = { trained: false };
      for (let epoch = 0; epoch < 5; epoch++) {
        trainResult = await this.train();
      }

      this.updateTargetModel();
      await this.save();

      this.logger.info(`🤖 [RL-Engine] DQN erfolgreich mit ${addedCount} Trades (inkl. adaptivem Epsilon & Reward-Shaping) trainiert.`);
      return { trained: true, samples: addedCount, epsilon: this.epsilon };
    } catch (e) {
      this.logger.error(`[RL-Engine Training Fehler]: ${e.message}`);
      return { trained: false, reason: e.message };
    }
  }

  async save() {
    try {
      if (!this.model) return;
      await this.model.save(`file://${path.resolve(this.modelDir)}`);
      fs.writeFileSync(path.join(this.modelDir, 'state.json'), JSON.stringify({ epsilon: this.epsilon, trainingSteps: this.trainingSteps, modelVersion: this.modelVersion }, null, 2));
    } catch (e) {}
  }

  async load() {
    try {
      const modelPath = path.resolve(path.join(this.modelDir, 'model.json'));
      if (fs.existsSync(modelPath)) {
        this.model = await tf.loadLayersModel(`file://${modelPath}`);
        this.model.compile({ optimizer: tf.train.adam(this.learningRate), loss: 'meanSquaredError' });
        this.updateTargetModel();
        const stateFile = path.join(this.modelDir, 'state.json');
        if (fs.existsSync(stateFile)) { try { const st = JSON.parse(fs.readFileSync(stateFile, 'utf8')); if (Number.isFinite(st.epsilon)) this.epsilon = Math.max(this.epsilonMin, Math.min(1, st.epsilon)); this.trainingSteps = Number(st.trainingSteps || 0); } catch {} }
        this.logger.info(`🤖 [RL-Engine] Gespeichertes DQN-Modell geladen (${this.modelVersion}).`);
        return true;
      }
    } catch (e) {}
    return false;
  }

  getStats() {
    return {
      epsilon: Number(this.epsilon.toFixed(3)),
      memorySize: this.memory.length,
      isInitialized: this.isInitialized,
      modelVersion: this.modelVersion,
      trainingSteps: this.trainingSteps
    };
  }
}

module.exports = { DeepQTheTradingAgent };
