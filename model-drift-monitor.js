'use strict';
class ModelDriftMonitor {
  constructor({ windowSize=200, threshold=0.35 }={}) { this.windowSize=windowSize; this.threshold=threshold; this.baseline=null; this.recent=[]; }
  setBaseline(features) { this.baseline=this._stats(features); }
  observe(features) { this.recent.push(features); if(this.recent.length>this.windowSize)this.recent.shift(); if(!this.baseline && this.recent.length >= Math.min(30, this.windowSize)) { this.setBaseline(this.recent.slice()); } return this.status(); }
  _stats(rows) { if(!rows?.length)return {}; const keys=Object.keys(rows[0]||{}); return Object.fromEntries(keys.map(k=>{const v=rows.map(r=>Number(r[k])).filter(Number.isFinite); return [k,v.length?v.reduce((a,b)=>a+b,0)/v.length:0];})); }
  status() { if(!this.baseline||this.recent.length<Math.min(30,this.windowSize))return {drift:false,score:0,reason:'insufficient-observations'}; const now=this._stats(this.recent); const keys=Object.keys(this.baseline); const score=keys.length?keys.reduce((s,k)=>s+Math.min(1,Math.abs((now[k]||0)-(this.baseline[k]||0))/(Math.abs(this.baseline[k]||1)+1e-9)),0)/keys.length:0; return {drift:score>=this.threshold,score,reason:score>=this.threshold?'concept-or-feature-drift':'stable'}; }
}
module.exports={ModelDriftMonitor};
