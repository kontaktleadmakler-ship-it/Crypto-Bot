'use strict';
class VolatilityRegimeManager {
  constructor({ logger = console } = {}) { this.logger = logger; }
  async evaluateVolatilityMultiplier(symbol, atr, price) {
    const atrPct = Number(price) > 0 ? Number(atr) / Number(price) : NaN;
    if (!Number.isFinite(atrPct) || atrPct <= 0) return { valid: false, volFactor: 1, marketStress: 'INVALID' };
    let volFactor = 1;
    let marketStress = 'NORMAL';
    if (atrPct > 0.05) { volFactor = 1.25; marketStress = 'EXTREME'; }
    else if (atrPct > 0.03) { volFactor = 1.15; marketStress = 'HIGH'; }
    else if (atrPct < 0.008) { volFactor = 0.90; marketStress = 'LOW'; }
    return { valid: true, atrPct, volFactor, marketStress };
  }
}
module.exports = { VolatilityRegimeManager };
