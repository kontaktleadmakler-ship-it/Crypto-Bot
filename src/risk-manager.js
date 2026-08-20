'use strict';

/**
 * // IMPROVED: centralized paper-risk calculations only.
 * No exchange order placement is performed here.
 */
class RiskManager {
  constructor(config, logger = console) { this.config = config; this.logger = logger; this.killSwitch = false; this.killReason = null; }
  setKillSwitch(reason='manual') { this.killSwitch = true; this.killReason = reason; }
  clearKillSwitch() { this.killSwitch = false; this.killReason = null; }

  positionSize({ equityUSD, riskPercent, entryPrice, stopLossPrice, kellyFraction = 1, riskMultiplier = 1 }) {
    const equity=Number(equityUSD), riskPct=Number(riskPercent), entry=Number(entryPrice), stop=Number(stopLossPrice);
    if (![equity,riskPct,entry,stop].every(Number.isFinite) || equity<=0 || riskPct<=0 || entry<=0) throw new Error('Invalid risk sizing inputs');
    const distance=Math.abs(entry-stop); if (!(distance>0)) throw new Error('Stop distance must be > 0');
    const riskUSD=equity*(riskPct/100)*Math.max(0,Math.min(1,kellyFraction))*Math.max(0,Math.min(1,riskMultiplier));
    const units=riskUSD/distance;
    return { riskUSD, units, notionalUSD:units*entry, stopDistance:distance, stopPct:distance/entry };
  }

  evaluate({ equityUSD,dailyPnL,peakEquityUSD,activeTrades=[],direction,notionalUSD=0,maxConcurrent=this.config.MAX_CONCURRENT_TRADES,
    maxSameDirection=this.config.MAX_SAME_DIRECTION,maxExposureRatio=this.config.MAX_EXPOSURE_RATIO,maxDailyLossUSD=this.config.MAX_DAILY_LOSS_USD,
    maxDrawdownPercent=this.config.MAX_DRAWDOWN_PERCENT }) {
    if (this.killSwitch) return { allowed:false, reason:`kill-switch:${this.killReason}` };
    if (!Number.isFinite(equityUSD)||equityUSD<=0) return {allowed:false,reason:'invalid-equity'};
    if (dailyPnL <= -Math.abs(maxDailyLossUSD)) return {allowed:false,reason:'daily-loss-limit'};
    const dd=peakEquityUSD>0?(peakEquityUSD-equityUSD)/peakEquityUSD*100:0;
    if(dd>=maxDrawdownPercent)return {allowed:false,reason:'max-drawdown',drawdownPercent:dd};
    if(activeTrades.length>=maxConcurrent)return {allowed:false,reason:'max-concurrent-trades'};
    if(direction && activeTrades.filter(t=>t.direction===direction).length>=maxSameDirection)return {allowed:false,reason:'max-same-direction'};
    const exposure=activeTrades.reduce((s,t)=>s+Math.abs(Number(t.notionalUSD)||0),0);
    if(exposure+Math.abs(notionalUSD)>equityUSD*maxExposureRatio)return {allowed:false,reason:'max-exposure'};
    return {allowed:true,reason:null,drawdownPercent:dd};
  }

  kelly({ winRate, avgWin, avgLoss }) {
    const p=Number(winRate), w=Number(avgWin), l=Math.abs(Number(avgLoss));
    if(!(p>=0&&p<=1&&w>0&&l>0)) return 0;
    return Math.max(0,Math.min(1,p-(1-p)*(l/w)));
  }
}
module.exports={RiskManager};
