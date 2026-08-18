'use strict';

/**
 * Paper-trade tracker.
 * // SAFETY: updates in-memory paper positions only; it contains no exchange
 * mutation API and never places/cancels/modifies orders.
 */
class PaperTradeTracker {
  constructor({ logger=console, fundingIntervalHours=8 }={}) {
    this.logger=logger; this.fundingIntervalMs=fundingIntervalHours*3600000;
  }
  markPrice(trade, price, now=Date.now()) {
    const entry=Number(trade.entry), current=Number(price), qty=Math.abs(Number(trade.units)||0);
    if(!(entry>0&&current>0&&qty>=0)) return {...trade, pnlUSD:0};
    const pnl=(trade.direction==='LONG' ? current-entry : entry-current)*qty;
    return {...trade, currentPrice:current, pnlUSD:pnl, updatedAt:new Date(now).toISOString()};
  }
  shouldStop(trade, price) {
    return trade.direction==='LONG' ? price<=trade.stopLoss : price>=trade.stopLoss;
  }
  reachedTarget(trade, price, target='tp1') {
    const p=Number(trade[target]); if(!Number.isFinite(p)) return false;
    return trade.direction==='LONG' ? price>=p : price<=p;
  }
}
module.exports={PaperTradeTracker};
