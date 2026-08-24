'use strict';

function clamp(p) { return Math.min(1 - 1e-12, Math.max(1e-12, Number(p))); }
function logLoss(rows) { return rows.length ? -rows.reduce((s, r) => s + (Number(r.y) ? Math.log(clamp(r.p)) : Math.log(1 - clamp(r.p))), 0) / rows.length : null; }
function brier(rows) { return rows.length ? rows.reduce((s, r) => s + (clamp(r.p) - Number(r.y)) ** 2, 0) / rows.length : null; }
function calibration(rows, bins = 10) {
  const out = Array.from({ length: bins }, (_, i) => ({ bin: i, count: 0, predicted: 0, observed: 0 }));
  for (const r of rows) { const p = clamp(r.p); const i = Math.min(bins - 1, Math.floor(p * bins)); out[i].count++; out[i].predicted += p; out[i].observed += Number(r.y); }
  return out.map(b => ({ ...b, predicted: b.count ? b.predicted / b.count : null, observed: b.count ? b.observed / b.count : null }));
}
function evaluateProbabilities(rows) {
  const clean = (Array.isArray(rows) ? rows : []).filter(r => Number.isFinite(Number(r.p)) && (Number(r.y) === 0 || Number(r.y) === 1));
  return { samples: clean.length, logLoss: logLoss(clean), brierScore: brier(clean), calibration: calibration(clean), evaluatedAt: Date.now() };
}
module.exports = { evaluateProbabilities, logLoss, brier, calibration };
