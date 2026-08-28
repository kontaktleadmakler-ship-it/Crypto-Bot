/**
 * Order-Flow Analyse Modul
 *
 * Evaluates buy/sell pressure (CVD - Cumulative Volume Delta) from real
 * trade prints when available, falling back to a candle-based proxy when
 * they are not. Also flags large resting orders ("walls") on the order
 * book and refuses to treat a wall alone as a tradeable signal unless
 * real trade flow confirms it - a lone wall can be spoofed or pulled a
 * moment later, so it must never drive a decision by itself.
 */
'use strict';

const WALL_RATIO = 5; // top level size must be >= 5x the average of the rest
const DOMINANT_SCORE_HIGH = 65;
const DOMINANT_SCORE_LOW = 35;

class OrderFlowAnalyzer {
    constructor({ logger = console } = {}) {
        this.logger = logger;
    }

    analyze(indicators) {
        if (!indicators || !indicators.avgVolume || indicators.avgVolume === 0) {
            return 'NEUTRAL_FLOW';
        }
        return indicators.avgVolume > 5 ? 'STRONG_BUY_PRESSURE' : 'BALANCED_FLOW';
    }

    _detectWall(bids, asks) {
        const sizes = [...bids, ...asks].map(l => Number(l && l[1])).filter(Number.isFinite);
        if (sizes.length < 2) return { wallDetected: false };
        let maxIdx = 0;
        for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[maxIdx]) maxIdx = i;
        const maxSize = sizes[maxIdx];
        const rest = sizes.filter((_, i) => i !== maxIdx);
        const avgRest = rest.reduce((a, b) => a + b, 0) / rest.length;
        const wallDetected = avgRest > 0 && maxSize >= avgRest * WALL_RATIO;
        return { wallDetected, maxSize, avgRest };
    }

    _scoreFromVolumes(buyVol, sellVol) {
        const total = buyVol + sellVol;
        if (!(total > 0)) return 50;
        return 50 + ((buyVol - sellVol) / total) * 50;
    }

    _pressureFromScore(score) {
        if (score > DOMINANT_SCORE_HIGH) return 'BULLISH_DOMINANT';
        if (score < DOMINANT_SCORE_LOW) return 'BEARISH_DOMINANT';
        return 'NEUTRAL';
    }

    /**
     * @param {Array} candles - recent OHLCV candles, used as a fallback CVD
     *   proxy when no real trade prints are available.
     * @param {Object} orderBook - { bids: [[price, size], ...], asks: [...] }
     * @param {Array} trades - recent real trade prints: [{ side: 'BUY'|'SELL', qty }]
     */
    evaluateOrderFlow(candles = [], orderBook = {}, trades = []) {
        const bids = Array.isArray(orderBook?.bids) ? orderBook.bids : [];
        const asks = Array.isArray(orderBook?.asks) ? orderBook.asks : [];
        const safeCandles = Array.isArray(candles) ? candles : [];
        const safeTrades = Array.isArray(trades) ? trades : [];

        const valid = (bids.length > 0 && asks.length > 0) || safeTrades.length > 0 || safeCandles.length > 0;

        const realTrades = safeTrades.filter(t => t && (t.side === 'BUY' || t.side === 'SELL') && Number.isFinite(Number(t.qty)));
        const isTrueCVD = realTrades.length > 0;

        let buyVol = 0;
        let sellVol = 0;
        if (isTrueCVD) {
            for (const t of realTrades) {
                const qty = Number(t.qty);
                if (t.side === 'BUY') buyVol += qty; else sellVol += qty;
            }
        } else {
            for (const c of safeCandles) {
                const vol = Number(c?.volume) || 0;
                if (!vol) continue;
                if (c.close > c.open) buyVol += vol;
                else if (c.close < c.open) sellVol += vol;
                else { buyVol += vol / 2; sellVol += vol / 2; }
            }
        }

        const score = this._scoreFromVolumes(buyVol, sellVol);
        const pressure = this._pressureFromScore(score);
        const { wallDetected } = this._detectWall(bids, asks);
        // A wall with no confirming real trade flow must never stand alone
        // as a signal - it can be spoofed or pulled before it ever fills.
        const wallOnlySignalBlocked = wallDetected && !isTrueCVD;

        return {
            valid,
            isTrueCVD,
            score,
            pressure,
            wallDetected,
            wallOnlySignalBlocked,
            buyVol,
            sellVol
        };
    }
}

module.exports = { OrderFlowAnalyzer };
