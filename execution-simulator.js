'use strict';

/**
 * Paper Execution Simulator – v22.3
 *
 * Deterministic, paper-only execution model.
 * Models spread, configurable slippage, market-impact approximation,
 * fees and latency without ever contacting an order endpoint.
 */
class ExecutionSimulator {
  constructor({ config = {}, logger = console } = {}) {
    this.config = config;
    this.logger = logger;
  }

  _num(v, fallback = 0) {
    return Number.isFinite(Number(v)) ? Number(v) : fallback;
  }

  estimateLatencyMs() {
    return Math.max(0, this._num(this.config.PAPER_EXECUTION_LATENCY_MS, 150));
  }

  estimateFee(notionalUSD, liquidity = 'taker') {
    const rate = liquidity === 'maker'
      ? this._num(this.config.PAPER_MAKER_FEE_PERCENT, this._num(this.config.FEE_PERCENT, 0.1))
      : this._num(this.config.PAPER_TAKER_FEE_PERCENT, this._num(this.config.FEE_PERCENT, 0.1));
    return Math.abs(this._num(notionalUSD)) * rate / 100;
  }

  estimateFillPrice({ side, referencePrice, quantity = 0, orderBook = null, liquidity = 'taker' } = {}) {
    const ref = this._num(referencePrice);
    if (!(ref > 0)) throw new Error('INVALID_REFERENCE_PRICE');

    const isBuy = String(side).toUpperCase() === 'BUY';
    let base = ref;
    let spreadPct = this._num(this.config.PAPER_SPREAD_PERCENT, 0);
    let impactPct = 0;

    if (orderBook && Number.isFinite(orderBook.bestBid) && Number.isFinite(orderBook.bestAsk)) {
      const bid = Number(orderBook.bestBid);
      const ask = Number(orderBook.bestAsk);
      if (bid > 0 && ask >= bid) {
        spreadPct = ((ask - bid) / ((ask + bid) / 2)) * 100;
        base = isBuy ? ask : bid;
        const depth = isBuy ? this._num(orderBook.askVolume) : this._num(orderBook.bidVolume);
        const participation = depth > 0 ? Math.min(1, Math.abs(quantity) / depth) : 1;
        const impactBps = this._num(this.config.PAPER_IMPACT_BPS, 5);
        impactPct = impactBps * participation / 100;
      }
    }

    const configuredSlip = this._num(this.config.PAPER_SLIPPAGE_PERCENT,
      this._num(this.config.SLIPPAGE_PERCENT, 0.05));

    // Use half-spread only when no explicit orderbook is available.
    const spreadComponent = orderBook ? 0 : spreadPct / 2;
    const totalPct = spreadComponent + configuredSlip + impactPct;

    return base * (isBuy ? 1 + totalPct / 100 : 1 - totalPct / 100);
  }

  simulateMarketOrder({ symbol, direction, referencePrice, quantity, orderBook = null, liquidity = 'taker' } = {}) {
    const side = String(direction).toUpperCase() === 'SHORT' ? 'SELL' : 'BUY';
    const fillPrice = this.estimateFillPrice({ side, referencePrice, quantity, orderBook, liquidity });
    const notionalUSD = Math.abs(fillPrice * this._num(quantity));
    const feeUSD = this.estimateFee(notionalUSD, liquidity);
    const requestedQty = Math.abs(this._num(quantity));
    const partialRatio = Math.min(1, Math.max(0.000001,
      this._num(this.config.PAPER_FILL_RATIO, 1)));
    const filledQty = requestedQty * partialRatio;
    const filledNotionalUSD = Math.abs(fillPrice * filledQty);

    return {
      fillPrice,
      requestedPrice: referencePrice,
      requestedQuantity: requestedQty,
      quantity: filledQty,
      fillRatio: partialRatio,
      notionalUSD: filledNotionalUSD,
      feeUSD,
      latencyMs: this.estimateLatencyMs(),
      liquidity,
      side,
      simulatedAt: Date.now()
    };
  }
}

module.exports = { ExecutionSimulator };
