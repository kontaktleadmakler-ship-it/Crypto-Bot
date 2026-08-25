'use strict';
class PaperValidation {
  constructor(){this.samples=[];}
  record(x={}){this.samples.push({...x,timestamp:Date.now()}); if(this.samples.length>10000)this.samples.shift();}
  summary(){const avg=k=>{const a=this.samples.map(x=>Number(x[k])).filter(Number.isFinite);return a.length?a.reduce((s,v)=>s+v,0)/a.length:0;}; return {samples:this.samples.length,signalDecisionLatencyMs:avg('signalDecisionLatencyMs'),executionLatencyMs:avg('executionLatencyMs'),modelLatencyMs:avg('modelLatencyMs'),eventLoopLagMs:avg('eventLoopLagMs'),simulatedSlippageBps:avg('simulatedSlippageBps'),reconciliationCorrect:this.samples.filter(x=>x.reconciliationCorrect===true).length, reconciliationRate:this.samples.length?this.samples.filter(x=>x.reconciliationCorrect===true).length/this.samples.length:0};}
}
module.exports={PaperValidation};
