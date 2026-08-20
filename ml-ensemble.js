'use strict';
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
class EnsembleModel {
  constructor(models = [], weights = []) { this.models = models; this.weights = weights.length === models.length ? weights : models.map(() => 1 / Math.max(models.length,1)); }
  predict(features) { if (!this.models.length) return { probability: 0.5, members: [] }; let denom = this.weights.reduce((a,b)=>a+b,0)||1; let p=0; const members=[]; for(let i=0;i<this.models.length;i++){ let prob=.5; try{ const r=this.models[i]?.predict?.(features); prob=typeof r==='number'?r:Number(r?.probability ?? .5); }catch(_){ } prob=clamp(prob,0,1); p += prob*this.weights[i]; members.push({ index:i, probability:prob, weight:this.weights[i] }); } return { probability:p/denom, members }; }
  calibrate(validationRows) { const scores=this.models.map((_,i)=>{const rows=validationRows.filter(r=>Number.isFinite(r.members?.[i]?.probability)); if(!rows.length)return 0.34; let brier=0;for(const r of rows)brier+=Math.pow(r.members[i].probability-r.outcome,2);return 1/(brier/rows.length+1e-6);});const s=scores.reduce((a,b)=>a+b,0)||1;this.weights=scores.map(x=>x/s);return this.weights; }
}
module.exports = { EnsembleModel };
