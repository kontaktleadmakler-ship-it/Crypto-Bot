'use strict';
class WalkForwardEngine {
  constructor({ trainBars=500, testBars=150, stepBars=150 }={}) { this.trainBars=trainBars; this.testBars=testBars; this.stepBars=stepBars; }
  windows(totalBars) {
    const out=[]; for(let start=0; start+this.trainBars+this.testBars<=totalBars; start+=this.stepBars) out.push({train:[start,start+this.trainBars],test:[start+this.trainBars,start+this.trainBars+this.testBars]}); return out;
  }
  summarize(results=[]) {
    const valid=results.filter(r=>Number.isFinite(Number(r.profitFactor)));
    return { windows:valid.length, avgProfitFactor:valid.length?valid.reduce((s,r)=>s+Number(r.profitFactor),0)/valid.length:0, passRate:valid.length?valid.filter(r=>Number(r.profitFactor)>=1.5 && Number(r.maxDrawdown||100)<10).length/valid.length:0, passed:valid.length>0 && valid.every(r=>Number(r.profitFactor)>=1.5 && Number(r.maxDrawdown||100)<10) };
  }
}
module.exports={WalkForwardEngine};
