'use strict';
function finite(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}
function approximateFeatureImportance(predictor, features, baseline = null) {
  const keys = Object.keys(features || {}); if (!keys.length) return [];
  const baseInput = baseline || features; const base = finite(predictor(baseInput), 0.5); const out=[];
  for (const key of keys) { const copy = { ...features }; const original = features[key]; const n = Number(original); copy[key] = Number.isFinite(n) ? 0 : undefined; let p=base; try{p=finite(predictor(copy),base);}catch(_){} out.push({ feature:key, importance:Math.abs(base-p), direction:p<base?'positive':'negative', baseline:base, perturbed:p }); }
  return out.sort((a,b)=>b.importance-a.importance);
}
module.exports = { approximateFeatureImportance };
