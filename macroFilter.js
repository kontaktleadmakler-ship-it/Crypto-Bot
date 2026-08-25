/**
 * ============================================================================
 * TRADING SIGNAL BOT - MACRO & SENTIMENT FILTER ENGINE
 * (Echtzeit-Analyse von Marktstimmung und Makro-Risiken)
 * ============================================================================
 */

const axios = require('axios');

class MacroFilterEngine {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.cacheExpiryMs = options.cacheExpiryMs || 30 * 60 * 1000; // 30 Minuten Cache
    this.lastChecked = 0;
    this.cachedSentiment = {
      value: 50,
      classification: 'Neutral',
      safe: true,
      multiplier: 1.0
    };
  }

  /**
   * Holt den aktuellen Crypto Fear & Greed Index von alternative.me
   */
  async fetchFearAndGreedIndex() {
    const now = Date.now();
    if (now - this.lastChecked < this.cacheExpiryMs && this.cachedSentiment) {
      return this.cachedSentiment;
    }

    try {
      const response = await axios.get('https://api.alternative.me/fng/?limit=1', { timeout: 5000 });
      if (response.data && response.data.data && response.data.data.length > 0) {
        const item = response.data.data[0];
        const value = parseInt(item.value, 10);
        const classification = item.value_classification;

        let safe = true;
        let multiplier = 1.0;

        // Risiko-Logik basierend auf Sentiment
        if (value <= 15) {
          // Extreme Panik -> Gefahr von Krypto-Crashes / Liquidationskaskaden
          this.logger.warn(`⚠️ [MacroFilter] Extreme Panik im Markt erkannt (Fear & Greed: ${value} - ${classification}).`);
          safe = true; // Bot läuft weiter, aber drosselt das Risiko
          multiplier = 0.5; // Positionsgröße halbieren
        } else if (value >= 90) {
          // Extreme Gier -> Überhitzter Markt, Trendumkehr-Gefahr
          this.logger.warn(`⚠️ [MacroFilter] Extreme Gier im Markt erkannt (Fear & Greed: ${value} - ${classification}).`);
          safe = true;
          multiplier = 0.75;
        }

        this.cachedSentiment = { value, classification, safe, multiplier };
        this.lastChecked = now;
        return this.cachedSentiment;
      }
    } catch (e) {
      this.logger.error(`[MacroFilter Fehler] Konnte Fear & Greed Index nicht abrufen: ${e.message}`);
    }

    return this.cachedSentiment; // Fallback auf letzten gültigen Wert
  }

  /**
   * Überprüft das Gesamt-Makro-Umfeld vor einem Scan
   */
  async evaluateMacroEnvironment() {
    const sentiment = await this.fetchFearAndGreedIndex();
    
    return {
      safe: sentiment.safe,
      sentimentValue: sentiment.value,
      sentimentClass: sentiment.classification,
      riskMultiplier: sentiment.multiplier
    };
  }
}

module.exports = { MacroFilterEngine };


// Hardened freshness guard: stale/unavailable macro data must fail closed.
function isSentimentFresh(sentiment, maxStaleMs = 30 * 60 * 1000) {
  if (!sentiment || !Number.isFinite(sentiment.fetchedAt)) return false;
  return Date.now() - sentiment.fetchedAt <= maxStaleMs;
}

module.exports = module.exports || {};
module.exports.isSentimentFresh = isSentimentFresh;
