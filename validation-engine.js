'use strict';
class ValidationEngine {
  constructor(opts={}) { this.thresholds={minProfitFactor:opts.minProfitFactor??1.5,minSharpe:opts.minSharpe??1,maxDrawdown:opts.maxDrawdown??0.10,minOosPassRate:opts.minOosPassRate??0.70,minRobustness:opts.minRobustness??0.70}; }
  evaluate(m={}) { const checks={profitFactor:+m.profitFactor>=this.thresholds.minProfitFactor,sharpe:+m.sharpe>=this.thresholds.minSharpe,maxDrawdown:+m.maxDrawdown<=this.thresholds.maxDrawdown,oos:+m.oosPassRate>=this.thresholds.minOosPassRate,robustness:+m.robustnessScore>=this.thresholds.minRobustness}; return {approved:Object.values(checks).every(Boolean),checks,thresholds:this.thresholds}; }
}
class ModelPromotion {
  constructor(registry){ this.registry=registry; }
  promote(candidate,validation){ if(!validation?.approved)return {promoted:false,reason:'validation-failed'}; if(this.registry?.promote) return this.registry.promote(candidate,validation); return {promoted:false,reason:'registry-promotion-not-available'}; }
}
module.exports={ValidationEngine,ModelPromotion};
