'use strict';

/**
 * Step 3 - Exchange/ledger reconciliation.
 *
 * Reconciliation is fail-closed.  It is deliberately read-only: this module
 * never creates, retries, cancels or replaces orders.
 *
 * Startup contract:
 *   DB -> UNKNOWN/SUBMITTING -> remote snapshot -> ledger comparison -> RESUME/HALT
 */
export class ReconciliationEngine {
  constructor({ exchange, executionStore, logger = console, tolerance = 1e-12 } = {}) {
    if (!exchange) throw new Error('EXCHANGE_REQUIRED');
    this.exchange = exchange;
    this.executionStore = executionStore;
    this.logger = logger;
    this.tolerance = Number(tolerance) > 0 ? Number(tolerance) : 1e-12;
    this.healthy = false;
    this.phase = 'NOT_STARTED';
    this.lastResult = null;
  }

  _number(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  _sameQty(a, b) {
    return Math.abs(this._number(a) - this._number(b)) <= this.tolerance;
  }

  _normalizePositions(positions = []) {
    const out = new Map();
    for (const p of positions || []) {
      if (!p?.symbol) continue;
      const quantity = this._number(p.quantity ?? p.qty ?? p.size);
      if (Math.abs(quantity) <= this.tolerance) continue;
      out.set(p.symbol, {
        symbol: p.symbol,
        quantity: Math.abs(quantity),
        direction: String(p.direction || (quantity < 0 ? 'SHORT' : 'LONG')).toUpperCase(),
        raw: p
      });
    }
    return out;
  }

  _normalizeInternalPositions(positions = []) {
    const out = new Map();
    for (const p of positions || []) {
      if (!p?.symbol) continue;
      const rawQty = this._number(p.quantity ?? p.positionSizeUnits ?? p.qty);
      if (Math.abs(rawQty) <= this.tolerance) continue;
      const direction = String(p.direction || (rawQty < 0 ? 'SHORT' : 'LONG')).toUpperCase();
      out.set(p.symbol, {
        symbol: p.symbol,
        quantity: Math.abs(rawQty),
        direction,
        raw: p
      });
    }
    return out;
  }

  async _loadRemoteSnapshot() {
    if (typeof this.exchange.getReconciliationSnapshot === 'function') {
      const snapshot = await this.exchange.getReconciliationSnapshot();
      if (!snapshot || snapshot.ok === false) throw new Error(snapshot?.reason || 'REMOTE_RECONCILIATION_UNAVAILABLE');
      return {
        openOrders: Array.isArray(snapshot.openOrders) ? snapshot.openOrders : [],
        fills: Array.isArray(snapshot.fills) ? snapshot.fills : [],
        positions: Array.isArray(snapshot.positions) ? snapshot.positions : [],
        balances: Array.isArray(snapshot.balances) ? snapshot.balances : [],
        source: snapshot.source || this.exchange.name || 'exchange'
      };
    }

    const required = ['getOpenOrders', 'getFills', 'getPositions', 'getBalances'];
    const missing = required.filter(method => typeof this.exchange[method] !== 'function');
    if (missing.length) {
      throw new Error(`REMOTE_RECONCILIATION_API_UNAVAILABLE:${missing.join(',')}`);
    }

    const [openOrders, fills, positions, balances] = await Promise.all([
      this.exchange.getOpenOrders(),
      this.exchange.getFills(),
      this.exchange.getPositions(),
      this.exchange.getBalances()
    ]);

    return { openOrders: openOrders || [], fills: fills || [], positions: positions || [], balances: balances || [], source: this.exchange.name || 'exchange' };
  }

  async reconcileExecution(execution) {
    if (!execution?.executionId) throw new Error('EXECUTION_ID_REQUIRED');
    if (typeof this.exchange.getOrderStatus !== 'function') {
      throw new Error('REMOTE_ORDER_STATUS_API_UNAVAILABLE');
    }

    const remote = await this.exchange.getOrderStatus({
      symbol: execution.symbol,
      clientOrderId: execution.clientOrderId,
      exchangeOrderId: execution.exchangeOrderId
    });

    if (!remote) {
      return { executionId: execution.executionId, status: 'NOT_FOUND', action: 'TRADING_HALT' };
    }

    const mapped = this.mapRemoteState(remote.status);
    if (this.executionStore?.setState) {
      await this.executionStore.setState(execution.executionId, mapped, remote);
    }
    return { executionId: execution.executionId, status: mapped, remote };
  }

  mapRemoteState(status) {
    const s = String(status || '').toUpperCase();
    if (s === 'FILLED') return 'FILLED';
    if (s === 'PARTIALLY_FILLED' || s === 'PARTIAL') return 'PARTIALLY_FILLED';
    if (s === 'CANCELED' || s === 'CANCELLED') return 'CANCELLED';
    if (s === 'REJECTED' || s === 'EXPIRED') return 'REJECTED';
    return 'ACKNOWLEDGED';
  }

  async startupReconcile({ internalPositions = [], unknownExecutions = [] } = {}) {
    this.phase = 'REMOTE_SNAPSHOT';
    const startedAt = Date.now();

    try {
      const remote = await this._loadRemoteSnapshot();
      this.phase = 'LEDGER_COMPARE';

      const internal = this._normalizeInternalPositions(internalPositions);
      const external = this._normalizePositions(remote.positions);
      const mismatches = [];

      const symbols = new Set([...internal.keys(), ...external.keys()]);
      for (const symbol of symbols) {
        const a = internal.get(symbol);
        const b = external.get(symbol);
        if (!a && b) {
          mismatches.push({ type: 'REMOTE_POSITION_WITHOUT_INTERNAL', symbol, internal: null, remote: b.raw });
          continue;
        }
        if (a && !b) {
          mismatches.push({ type: 'INTERNAL_POSITION_MISSING_REMOTE', symbol, internal: a.raw, remote: null });
          continue;
        }
        if (a && b && (a.direction !== b.direction || !this._sameQty(a.quantity, b.quantity))) {
          mismatches.push({
            type: 'POSITION_MISMATCH',
            symbol,
            internal: { direction: a.direction, quantity: a.quantity },
            remote: { direction: b.direction, quantity: b.quantity }
          });
        }
      }

      const unresolvedExecutions = [];
      for (const execution of unknownExecutions) {
        const result = await this.reconcileExecution(execution);
        if (['NOT_FOUND', 'UNKNOWN', 'REQUIRES_MANUAL_REVIEW'].includes(result.status)) {
          unresolvedExecutions.push({ executionId: execution.executionId, result });
        }
      }

      const healthy = mismatches.length === 0 && unresolvedExecutions.length === 0;
      this.healthy = healthy;
      this.phase = healthy ? 'RESUME' : 'HALT';
      this.lastResult = {
        ok: healthy,
        healthy,
        phase: this.phase,
        checkedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        source: remote.source,
        openOrders: remote.openOrders,
        fills: remote.fills,
        balances: remote.balances,
        internalPositionCount: internal.size,
        remotePositionCount: external.size,
        mismatches,
        unresolvedExecutions
      };

      if (!healthy) {
        this.logger.error?.(`[RECONCILIATION] TRADING HALT: ${JSON.stringify({ mismatches, unresolvedExecutions })}`);
      } else {
        this.logger.info?.('[RECONCILIATION] PASS – ledger consistent; trading may resume');
      }
      return this.lastResult;
    } catch (error) {
      this.healthy = false;
      this.phase = 'HALT';
      this.lastResult = {
        ok: false,
        healthy: false,
        phase: 'HALT',
        checkedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        reason: error.message,
        error: error.message
      };
      this.logger.error?.(`[RECONCILIATION] FAIL-CLOSED: ${error.message}`);
      return this.lastResult;
    }
  }

  isHealthy() { return this.healthy === true; }
  getStatus() { return this.lastResult || { ok: false, healthy: false, phase: this.phase }; }
}

export default ReconciliationEngine;
