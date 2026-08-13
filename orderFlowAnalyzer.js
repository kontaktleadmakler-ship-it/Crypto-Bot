/**
 * ============================================================================
 * ORDER FLOW & CVD ANALYZER MODULE
 * Analysiert das Kauf-/Verkaufs-Volumenverhältnis und Orderbuch-Druck
 * ============================================================================
 */

class OrderFlowAnalyzer {
  constructor({ logger }) {
    this.logger = logger;
  }

  /**
   * Berechnet den Order-Flow-Druck basierend auf Kerzen-Volumen und Preis-Delta
   * @param {Array} candles - Array von Kerzen (15m)
   * @param {Object} orderBook - Orderbuch-Daten (Bids/Asks Snapshot)
   * @returns {Object} Analyseergebnis mit Score und Empfehlung
   */
  evaluateOrderFlow(candles, orderBook) {
    if (!candles || candles.length < 10) {
      return { score: 50, pressure: 'NEUTRAL', reliable: false };
    }

    let buyingVolumeSum = 0;
    let sellingVolumeSum = 0;

    // Analysiere die letzten 10 Kerzen auf aggressives Kaufen/Verkaufen
    const recentCandles = candles.slice(-10);
    recentCandles.forEach(c => {
      const bodySize = c.close - c.open;
      const totalRange = c.high - c.low;
      if (totalRange === 0) return;

      // Verhältnis von Kerzenkörper zur Gesamtlänge als Indiz für Dominanz
      const dominance = bodySize / totalRange;
      const weightedVol = c.volume * Math.abs(dominance);

      if (bodySize > 0) {
        buyingVolumeSum += weightedVol;
      } else {
        sellingVolumeSum += weightedVol;
      }
    });

    const totalVol = buyingVolumeSum + sellingVolumeSum;
    const cvdRatio = totalVol > 0 ? buyingVolumeSum / totalVol : 0.5; // 0 = voll auf Sell, 1 = voll auf Buy

    // Orderbuch Imbalance einbeziehen (falls vorhanden)
    let obScore = 50;
    if (orderBook && orderBook.bidAskRatio) {
      // ratio > 1 bedeutet mehr Bids (Käufer), ratio < 1 mehr Asks (Verkäufer)
      obScore = Math.min(100, Math.max(0, orderBook.bidAskRatio * 50));
    }

    // Kombinierter Order-Flow Score (0 bis 100)
    // CVD macht 70% aus, Orderbuch-Imbalance 30%
    const combinedScore = Math.round((cvdRatio * 100) * 0.7 + obScore * 0.3);

    let pressure = 'NEUTRAL';
    if (combinedScore > 60) pressure = 'BULLISH_DOMINANT';
    else if (combinedScore < 40) pressure = 'BEARISH_DOMINANT';

    return {
      score: combinedScore,
      cvdRatio: Number(cvdRatio.toFixed(2)),
      pressure,
      reliable: true
    };
  }
}

module.exports = { OrderFlowAnalyzer };
