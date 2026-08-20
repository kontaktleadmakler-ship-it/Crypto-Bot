'use strict';
function empty() { return { samples: 0, accepted: 0, blocked: 0, wins: 0, losses: 0, pnl: 0, avgPnl: 0, winRate: 0 }; }
class PerformanceAttribution {
  constructor({ collection = null } = {}) { this.collection = collection; this.byFilter = new Map(); }
  record(filter, result) {
    if (!this.byFilter.has(filter)) this.byFilter.set(filter, empty());
    const m = this.byFilter.get(filter); m.samples += 1; m.accepted += result.accepted ? 1 : 0; m.blocked += result.accepted ? 0 : 1;
    if (result.accepted) { m.pnl += Number(result.pnlUSD || 0); if (Number(result.pnlUSD || 0) > 0) m.wins += 1; else if (Number(result.pnlUSD || 0) < 0) m.losses += 1; m.avgPnl = m.pnl / m.accepted; m.winRate = m.accepted ? m.wins / m.accepted * 100 : 0; }
    if (this.collection) this.collection.updateOne({ filter, day: new Date().toISOString().slice(0,10) }, { $set: { filter, day: new Date().toISOString().slice(0,10), ...m, updatedAt: new Date() } }, { upsert: true }).catch(() => {});
  }
  report() { return [...this.byFilter.entries()].map(([filter, metrics]) => ({ filter, ...metrics })); }
}
module.exports = { PerformanceAttribution };
