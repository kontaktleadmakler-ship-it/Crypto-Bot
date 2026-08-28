/**
 * Hedge Manager Modul für Risikosteuerung
 */
'use strict';

class HedgeManager {
    calculateHedge(signal) {
        if (!signal || !signal.price) {
            return { action: 'NONE', ratio: 0.0 };
        }
        return {
            action: signal.type === 'SELL_SIGNAL' ? 'INCREASE_HEDGE' : 'MAINTAIN',
            ratio: 0.25
        };
    }
}

module.exports = HedgeManager;
