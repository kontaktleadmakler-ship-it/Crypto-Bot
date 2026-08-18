/**
 * ============================================================================
 * TRADING SIGNAL BOT - CROSS-HEDGING RISK MANAGER
 * (Automatisches Hedging bei Markt-Crashs und Portfolio-Absicherung)
 * ============================================================================
 */

class HedgeManager {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.hedgeActive = false;
    this.lastBtcPrice = 0;
    this.thresholdDropPct = options.thresholdDropPct || -2.5; // -2.5% BTC-Drop löst Hedge aus
  }

  /**
   * Überwacht das Portfolio und den Bitcoin-Kurs auf Crash-Gefahr
   */
  async evaluateHedgeNeed(activeTrades, btcCurrentPrice) {
    if (!activeTrades || activeTrades.size === 0) return { shouldHedge: false };

    // Prüfen, ob überhaupt Long-Positionen offen sind, die geschützt werden müssen
    const longTrades = [...activeTrades.values()].filter(t => t.direction === 'LONG');
    if (longTrades.length === 0) return { shouldHedge: false };

    if (this.lastBtcPrice === 0) {
      this.lastBtcPrice = btcCurrentPrice;
      return { shouldHedge: false };
    }

    // Kursänderung von BTC berechnen
    const btcChangePct = ((btcCurrentPrice - this.lastBtcPrice) / this.lastBtcPrice) * 100;

    // Wenn Bitcoin stark fällt und noch kein Hedge aktiv ist
    if (btcChangePct <= this.thresholdDropPct && !this.hedgeActive) {
      this.logger.warn(`⚠️ [HedgeManager] Starker BTC-Abfall erkannt (${btcChangePct.toFixed(2)}%). Aktiviere Notfall-Absicherung!`);
      this.hedgeActive = true;
      
      return {
        shouldHedge: true,
        reason: 'BTC_FLASH_CRASH',
        dropPct: btcChangePct,
        recommendedAction: 'SHORT_BTC_HEDGE'
      };
    }

    // Wenn sich der Markt wieder beruhigt hat, Hedge-Status zurücksetzen
    if (btcChangePct >= 1.0 && this.hedgeActive) {
      this.logger.info(`✅ [HedgeManager] Markt stabilisiert sich. Deaktiviere Hedge-Modus.`);
      this.hedgeActive = false;
    }

    this.lastBtcPrice = btcCurrentPrice;
    return { shouldHedge: false };
  }
}

module.exports = { HedgeManager };
