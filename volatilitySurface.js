/**
 * Volatilitäts-Oberflächen Modul mit Null-Division-Schutz
 */
'use strict';

class VolatilitySurface {
    constructor() {
        this.baseVolatility = 0.02;
    }

    calculate(currentPrice) {
        if (!currentPrice || currentPrice <= 0) {
            return { status: 'NORMAL', volatility: this.baseVolatility };
        }
        // Simulierter Volatilitätswert
        const impliedVol = this.baseVolatility * (1 + (Math.random() * 0.1 - 0.05));
        return {
            status: impliedVol > 0.025 ? 'HIGH_VOLATILITY' : 'NORMAL',
            volatility: parseFloat(impliedVol.toFixed(4))
        };
    }
    // Compatibility API used by the v25 runtime. Keep volatility sizing
    // deterministic and side-effect free so it can never block the scanner.
    async evaluateVolatilityMultiplier(symbol, atr, price) {
        const atrPct = Number(price) > 0 ? Number(atr) / Number(price) : NaN;
        if (!Number.isFinite(atrPct) || atrPct <= 0) {
            return { valid: false, volFactor: 1, marketStress: 'INVALID', symbol };
        }
        let volFactor = 1;
        let marketStress = 'NORMAL';
        if (atrPct > 0.05) { volFactor = 1.25; marketStress = 'EXTREME'; }
        else if (atrPct > 0.03) { volFactor = 1.15; marketStress = 'HIGH'; }
        else if (atrPct < 0.008) { volFactor = 0.90; marketStress = 'LOW'; }
        return { valid: true, atrPct, volFactor, marketStress, symbol };
    }

}

module.exports = VolatilitySurface;
