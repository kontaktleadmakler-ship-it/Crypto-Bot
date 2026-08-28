/**
 * Order-Flow Analyse Modul
 */
'use strict';

class OrderFlowAnalyzer {
    analyze(indicators) {
        if (!indicators || !indicators.avgVolume || indicators.avgVolume === 0) {
            return 'NEUTRAL_FLOW';
        }
        return indicators.avgVolume > 5 ? 'STRONG_BUY_PRESSURE' : 'BALANCED_FLOW';
    }
}

module.exports = OrderFlowAnalyzer;
