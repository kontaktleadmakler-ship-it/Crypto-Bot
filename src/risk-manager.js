'use strict';

/** Compatibility adapter. Canonical runtime risk checks live in ../risk-engine. */
const { RiskEngine } = require('../risk-engine');
class RiskManager extends RiskEngine {
  constructor(config = {}, logger = console) { super({ config, logger }); }
  positionSize({ equityUSD, riskPercent, entryPrice, stopLossPrice, kellyFraction = 1, riskMultiplier = 1 }) {
    const equity=Number(equityUSD), riskPct=Number(riskPercent), entry=Number(entryPrice), stop=Number(stopLossPrice);
    if (![equity,riskPct,entry,stop].every(Number.isFinite) || equity<=0 || riskPct<=0 || entry<=0) throw new Error('Invalid risk sizing inputs');
    const distance=Math.abs(entry-stop); if (!(distance>0)) throw new Error('Stop distance must be > 0');
    const riskUSD=equity*(riskPct/100)*Math.max(0,Math.min(1,kellyFraction))*Math.max(0,Math.min(1,riskMultiplier));
    const units=riskUSD/distance;
    return { riskUSD, units, notionalUSD:units*entry, stopDistance:distance, stopPct:distance/entry };
  }
  kelly({ winRate, avgWin, avgLoss }) {
    const p=Number(winRate), w=Number(avgWin), l=Math.abs(Number(avgLoss));
    if(!(p>=0&&p<=1&&w>0&&l>0)) return 0;
    return Math.max(0,Math.min(1,p-(1-p)*(l/w)));
  }
}
module.exports={RiskManager};
