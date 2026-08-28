/**
 * Makro-Filter Modul zur Trend- und Marktphasen-Prüfung
 */
'use strict';

class MacroFilter {
    constructor() {
        this.marketRegime = 'BULLISH';
    }

    evaluate() {
        // Hier können globale Marktindikatoren einfließen
        return {
            regime: this.marketRegime,
            allowedToTrade: true
        };
    }
}

module.exports = MacroFilter;
