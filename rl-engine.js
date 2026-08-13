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
      this.logger.info('🤖 [RL-Engine] DQN Agent erfolgreich initialisiert.');
    } catch (e) {
      this.logger.error(`[RL-Engine Init Fehler]: ${e.message}`);
      this.isInitialized = true; // Fallback auf unternährtes Modell
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
  act(state) {
    // Exploration: Zufällige Aktion wählen, um neue Strategien zu testen
    if (Math.random() < this.epsilon) {
      return Math.floor(Math.random() * this.actionSize);
    }

    // Exploitation: Beste Aktion vom Modell vorhersagen lassen
    return tf.tidy(() => {
      const stateTensor = tf.tensor2d([state]);
      const prediction = this.model.predict(stateTensor);
      const actionTensor = prediction.argMax(1);
      return actionTensor.dataSync()[0];
    });
  }

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

    // Epsilon abbauen (weniger Exploration, mehr Fokus auf gelerntes Wissen)
    if (this.epsilon > this.epsilonMin) {
      this.epsilon *= this.epsilonDecay;
    }

    return { trained: true, epsilon: this.epsilon, memorySize: this.memory.length };
  }

  /**
   * Wandelt Closed Trades aus der MongoDB in RL-Erfahrungen um und trainiert das Netz
   * (Erweitert um Confluence-Score im State-Vektor und optimiertes Reward Shaping)
   */
  async trainFromClosedTrades(closedTradesCollection) {
    try {
      if (!closedTradesCollection) return { trained: false, reason: 'no-db-collection' };
      
      const trades = await closedTradesCollection.find({}).sort({ closeTime: -1 }).limit(500).toArray();
      if (trades.length < 10) return { trained: false, reason: 'not-enough-trades' };

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
        // Skalierte Basis-Belohnung mit Kappen bei +5 / -5 zur Stabilisierung
        let baseReward = pnlUSD > 0 ? Math.min(pnlUSD / 50, 5) : Math.max(pnlUSD / 50, -5);
        
        // Confluence-Faktor einbeziehen: Bestrafe schlechte Trades mit hohem Risiko härter, belohne saubere Setups
        const confluenceScore = t.confluenceScore || 60;
        let confluenceBonus = 0;
        if (pnlUSD > 0 && confluenceScore >= 70) {
          confluenceBonus = 1.0; // Starker Bonus für hochkonfluente Gewinne
        } else if (pnlUSD < 0 && confluenceScore >= 70) {
          confluenceBonus = -1.0; // Höhere Bestrafung, wenn trotz hohem Confluence ein Loss entsteht (Modell soll lernen, warum)
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

      this.logger.info(`🤖 [RL-Engine] DQN erfolgreich mit ${addedCount} Trades (inkl. optimiertem Reward-Shaping) trainiert.`);
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
    } catch (e) {}
  }

  async load() {
    try {
      const modelPath = path.resolve(path.join(this.modelDir, 'model.json'));
      if (fs.existsSync(modelPath)) {
        this.model = await tf.loadLayersModel(`file://${modelPath}`);
        this.model.compile({ optimizer: tf.train.adam(this.learningRate), loss: 'meanSquaredError' });
        this.updateTargetModel();
        this.logger.info('🤖 [RL-Engine] Gespeichertes DQN-Modell geladen.');
        return true;
      }
    } catch (e) {}
    return false;
  }

  getStats() {
    return {
      epsilon: Number(this.epsilon.toFixed(3)),
      memorySize: this.memory.length,
      isInitialized: this.isInitialized
    };
  }
}

module.exports = { DeepQTheTradingAgent };
