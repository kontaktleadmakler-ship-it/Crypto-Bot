/**
 * Hedge Manager Modul für Risikosteuerung
 */
'use strict';

class HedgeManager {
    constructor(options = {}) {
        this.logger = options.logger || console;
        this.thresholdDropPct = Number.isFinite(options.thresholdDropPct) ? options.thresholdDropPct : -2.5;
        this.referencePrice = null;
    }

    calculateHedge(signal) {
        if (!signal || !signal.price) {
            return { action: 'NONE', ratio: 0.0 };
        }
        return {
            action: signal.type === 'SELL_SIGNAL' ? 'INCREASE_HEDGE' : 'MAINTAIN',
            ratio: 0.25
        };
    }

    // Compatibility API used by the active-trade tracker.
    // This method is intentionally pure/read-only: it does not place orders,
    // acquire runtime locks, or call market-data APIs.
    async evaluateHedgeNeed(activeTrades, btcMarkPrice) {
        const price = Number(btcMarkPrice);
        if (!Number.isFinite(price) || price <= 0) {
            return { shouldHedge: false, dropPct: 0, reason: 'INVALID_BTC_PRICE' };
        }

        if (!Number.isFinite(this.referencePrice) || this.referencePrice <= 0) {
            this.referencePrice = price;
            return { shouldHedge: false, dropPct: 0, reason: 'REFERENCE_INITIALIZED' };
        }

        const dropPct = ((price - this.referencePrice) / this.referencePrice) * 100;
        // Track the latest/high-water reference so normal upward movement
        // does not trigger a false hedge after a later decline.
        if (price > this.referencePrice) this.referencePrice = price;

        const hasLongExposure = activeTrades instanceof Map
            ? [...activeTrades.values()].some(t => String(t?.direction || '').toUpperCase() === 'LONG')
            : Array.isArray(activeTrades)
                ? activeTrades.some(t => String(t?.direction || '').toUpperCase() === 'LONG')
                : false;

        return {
            shouldHedge: hasLongExposure && dropPct <= this.thresholdDropPct,
            dropPct,
            thresholdDropPct: this.thresholdDropPct,
            hasLongExposure
        };
    }
}

module.exports = HedgeManager;
