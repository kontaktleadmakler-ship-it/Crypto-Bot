/**
 * v22.6 B10 - Shadow Trading Engine
 *
 * Real market-data observation + simulated fills only.
 * NEVER submits exchange orders.
 */
'use strict';

const crypto = require('crypto');
const EventEmitter = require('events');

class ShadowTradingEngine extends EventEmitter {
  constructor({
    simulator,
    riskEngine = null,
    logger = console,
    config = {},
    stateStore = null
  } = {}) {
    super();
    if (!simulator) throw new Error('SHADOW_SIMULATOR_REQUIRED');
    this.simulator = simulator;
    this.riskEngine = riskEngine;
    this.logger = logger;
    this.stateStore = stateStore;
    this.config = {
      enabled: false,
      haltOnRiskFailure: true,
      ...config
    };
    this.positions = new Map();
    this.signals = new Map();
    this.halted = false;
  }

  status() {
    return {
      mode: this.config.enabled ? 'SHADOW' : 'DISABLED',
      halted: this.halted,
      openPositions: this.positions.size,
      trackedSignals: this.signals.size
    };
  }

  setEnabled(enabled) {
    this.config.enabled = Boolean(enabled);
    if (!this.config.enabled) this.halted = false;
    this.emit('mode', this.status());
  }

  halt(reason = 'manual') {
    this.halted = true;
    this.logger.warn?.(`[SHADOW] HALTED: ${reason}`);
    this.emit('halted', { reason, ts: Date.now() });
  }

  resume() {
    this.halted = false;
    this.emit('resumed', { ts: Date.now() });
  }

  _identity(signal) {
    const raw = [
      signal.signalId || '',
      signal.symbol || '',
      signal.side || '',
      signal.timestamp || signal.ts || '',
      signal.strategyVersion || '',
      signal.featureVersion || '',
      signal.modelVersion || '',
      signal.configHash || ''
    ].join('|');
    return signal.signalId || crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
  }

  _riskAllowed(signal) {
    if (!this.riskEngine) return true;
    try {
      if (typeof this.riskEngine.allowSignal === 'function') {
        return Boolean(this.riskEngine.allowSignal(signal));
      }
      if (typeof this.riskEngine.checkSignal === 'function') {
        const result = this.riskEngine.checkSignal(signal);
        return result === true || result?.allowed === true;
      }
      return true;
    } catch (err) {
      this.logger.error?.(`[SHADOW-RISK] ${err.message}`);
      if (this.config.haltOnRiskFailure) this.halt('risk-engine-error');
      return false;
    }
  }

  async onSignal(signal, market) {
    if (!this.config.enabled || this.halted) return { accepted: false, reason: 'shadow-disabled-or-halted' };
    if (!signal || !market) return { accepted: false, reason: 'invalid-input' };

    const id = this._identity(signal);
    if (this.signals.has(id)) return { accepted: false, duplicate: true, signalId: id };

    if (!this._riskAllowed(signal)) {
      this.signals.set(id, { signalId: id, status: 'RISK_REJECTED', ts: Date.now() });
      return { accepted: false, reason: 'risk-rejected', signalId: id };
    }

    const intent = {
      signalId: id,
      symbol: signal.symbol,
      side: signal.side,
      quantity: Number(signal.quantity ?? signal.positionSize ?? 0),
      signalPrice: Number(signal.signalPrice ?? signal.signalPriceAtEntry ?? market.price),
      timestamp: Number(signal.timestamp ?? signal.ts ?? Date.now()),
      strategyVersion: signal.strategyVersion || 'unknown',
      featureVersion: signal.featureVersion || 'unknown',
      modelVersion: signal.modelVersion || 'unknown',
      configHash: signal.configHash || 'unknown'
    };

    if (!intent.symbol || !['BUY', 'SELL', 'LONG', 'SHORT'].includes(String(intent.side).toUpperCase())) {
      this.signals.set(id, { signalId: id, status: 'INVALID', ts: Date.now() });
      return { accepted: false, reason: 'invalid-signal', signalId: id };
    }

    const fill = await this.simulator.simulateFill({
      ...intent,
      market,
      mode: 'SHADOW'
    });

    const record = {
      ...intent,
      status: 'SHADOW_FILLED',
      fill,
      acceptedAt: Date.now()
    };

    this.signals.set(id, record);
    this.positions.set(id, record);
    this.emit('fill', record);
    return { accepted: true, signalId: id, fill };
  }

  async onMarketUpdate(market) {
    if (!this.config.enabled || this.halted || !market) return;
    this.emit('market', market);
  }

  async closePosition(signalId, market, reason = 'signal') {
    const position = this.positions.get(signalId);
    if (!position) return { closed: false, reason: 'position-not-found' };

    const exit = await this.simulator.simulateFill({
      ...position,
      market,
      mode: 'SHADOW',
      close: true,
      closeReason: reason
    });

    const result = {
      signalId,
      entry: position.fill,
      exit,
      reason,
      closedAt: Date.now()
    };

    this.positions.delete(signalId);
    this.signals.set(signalId, { ...position, status: 'SHADOW_CLOSED', close: result });
    this.emit('close', result);
    return { closed: true, ...result };
  }

  snapshot() {
    return {
      version: 1,
      status: this.status(),
      positions: [...this.positions.values()],
      signals: [...this.signals.values()]
    };
  }

  async persist() {
    if (!this.stateStore) return;
    if (typeof this.stateStore.save === 'function') await this.stateStore.save(this.snapshot());
  }
}

module.exports = { ShadowTradingEngine };
