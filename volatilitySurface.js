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
}

module.exports = VolatilitySurface;
