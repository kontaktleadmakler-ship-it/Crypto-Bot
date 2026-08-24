/**
 * ============================================================================
 * TRADING SIGNAL BOT - DYNAMIC VOLATILITY SURFACE & IV TRACKER
 * (Echtzeit-Analyse von Marktspannung und erwarteter Volatilität)
 * ============================================================================
 */

class VolatilitySurfaceManager {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.ivCache = new Map();
  }

  /**
   * Berechnet einen Volatilitäts-Faktor basierend auf Orderbuch-Spread und Kurs-Varianz
   */
  async evaluateVolatilityMultiplier(symbol, currentAtr, currentPrice) {
    try {
      // Bugfix: previously returned a bare number here while every other
      // branch returns { volFactor, atrPercent, marketStress }. Callers do
      // `volEvaluation.volFactor` unconditionally (e.g. atrStopDistance =
      // atr * adaptiveATR * volEvaluation.volFactor), so the bare-number
      // shape silently produced NaN stop distances whenever price/ATR data
      // was momentarily missing. Always return the full object shape.
      if (!currentPrice || currentPrice === 0 || !currentAtr) {
        return { volFactor: 1.0, atrPercent: 0, marketStress: 'UNKNOWN' };
      }

      const atrPercent = (currentAtr / currentPrice) * 100;

      // Basis-Multiplikator aus historischer ATR-Volatilität
      let volFactor = 1.0;

      if (atrPercent > 4.0) {
        // Extrem hohe Volatilität -> Risiko drastisch drosseln
        volFactor = 1.5; 
      } else if (atrPercent < 1.0) {
        // Sehr ruhiger Markt -> Positionen können enger gefahren werden
        volFactor = 0.8;
      }

      return {
        volFactor,
        atrPercent,
        marketStress: atrPercent > 4.0 ? 'HIGH_STRESS' : 'NORMAL'
      };
    } catch (e) {
      this.logger.error(`[VolatilitySurface] Fehler bei der Berechnung für ${symbol}: ${e.message}`);
      return { volFactor: 1.0, atrPercent: 0, marketStress: 'UNKNOWN' };
    }
  }
}

module.exports = { VolatilitySurfaceManager };
