/**
 * Makro-Filter Modul zur Trend- und Marktphasen-Prüfung
 */
'use strict';

class MacroFilter {
    constructor() {
        this.marketRegime = 'BULLISH';
    }

    evaluate() {
        // Hier können globale Marktindikatoren einfließen.
        return {
            regime: this.marketRegime,
            allowedToTrade: true
        };
    }

    /**
     * Backwards-compatible macro/sentiment API used by the production
     * scanner and JARVIS dashboard.
     *
     * The scanner expects this method to return { safe, sentimentClass,
     * sentimentValue, multiplier }.  The previous lightweight MacroFilter
     * only exposed evaluate(), which caused every scan/dashboard poll to
     * throw "evaluateMacroEnvironment is not a function".
     *
     * News-event blackouts are handled separately by the runtime's
     * isNewsBlackout() gate, so this method must not silently disable that
     * safety mechanism.
     */
    async evaluateMacroEnvironment() {
        const result = this.evaluate();
        const regime = String(result?.regime || 'NEUTRAL').toUpperCase();

        let sentimentClass = 'Neutral';
        let sentimentValue = 50;
        let multiplier = 1;
        let safe = result?.allowedToTrade !== false;

        if (regime === 'BULLISH') {
            sentimentClass = 'Bullish';
            sentimentValue = 65;
            multiplier = 1;
        } else if (regime === 'BEARISH') {
            sentimentClass = 'Bearish';
            sentimentValue = 35;
            multiplier = 1;
        } else if (regime === 'RISK_OFF' || regime === 'EXTREME_FEAR') {
            sentimentClass = 'Fear';
            sentimentValue = 20;
            multiplier = 0.5;
            safe = false;
        } else if (regime === 'RISK_ON' || regime === 'EXTREME_GREED') {
            sentimentClass = 'Greed';
            sentimentValue = 80;
            multiplier = 1;
        }

        return {
            safe,
            sentimentClass,
            sentimentValue,
            value: sentimentValue,
            classification: sentimentClass,
            multiplier,
            riskMultiplier: multiplier,
            regime,
            allowedToTrade: safe
        };
    }
}

module.exports = MacroFilter;
