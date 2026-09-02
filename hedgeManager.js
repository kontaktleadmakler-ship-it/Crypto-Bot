/**
 * Hedge Manager Modul für Risikosteuerung.
 * Tracker-safe: evaluateHedgeNeed is pure/read-only and never submits orders.
 */
'use strict';

class HedgeManager {
    calculateHedge(signal) {
        if (!signal || !signal.price) return { action: 'NONE', ratio: 0.0 };
        return { action: signal.type === 'SELL_SIGNAL' ? 'INCREASE_HEDGE' : 'MAINTAIN', ratio: 0.25 };
    }

    evaluateHedgeNeed(activeTrades, btcMarkPrice, thresholdPct = -2.5) {
        const btc = Number(btcMarkPrice);
        if (!Number.isFinite(btc) || btc <= 0 || !activeTrades || typeof activeTrades.values !== 'function') {
            return { shouldHedge:false, dropPct:0, reason:'INSUFFICIENT_DATA' };
        }
        let longExposure = 0;
        for (const trade of activeTrades.values()) {
            if (String(trade.direction || '').toUpperCase() === 'LONG') longExposure += Math.abs(Number(trade.notionalUSD || 0));
        }
        // Without a prior BTC reference this method must remain neutral rather
        // than inventing a price move. The runtime may supply btcReferencePrice.
        const ref = Number(this.btcReferencePrice || btc);
        const dropPct = ref > 0 ? (btc / ref - 1) * 100 : 0;
        const shouldHedge = longExposure > 0 && dropPct <= thresholdPct;
        return { shouldHedge, dropPct, longExposureUSD: longExposure, reason: shouldHedge ? 'BTC_DROP_THRESHOLD' : 'NO_HEDGE' };
    }

    setReferencePrice(price) {
        const p = Number(price);
        if (Number.isFinite(p) && p > 0) this.btcReferencePrice = p;
    }
}

module.exports = HedgeManager;
