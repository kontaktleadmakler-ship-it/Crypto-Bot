'use strict';

/** B8: DQN evaluation helpers. Training remains paper/offline only. */
function evaluateActions(rows) {
  const clean = (Array.isArray(rows) ? rows : []).filter(r => Number.isFinite(Number(r.reward)));
  const rewards = clean.map(r => Number(r.reward));
  const mean = rewards.length ? rewards.reduce((a,b)=>a+b,0)/rewards.length : 0;
  const variance = rewards.length > 1 ? rewards.reduce((s,x)=>s+(x-mean)**2,0)/(rewards.length-1) : 0;
  const std = Math.sqrt(variance);
  return { samples: clean.length, meanReward: mean, rewardStd: std, rewardSharpe: std > 0 ? mean / std * Math.sqrt(252) : 0, positiveRate: rewards.length ? rewards.filter(x=>x>0).length/rewards.length : 0, evaluatedAt: Date.now() };
}
function ablationSummary({ baseline = {}, candidate = {} } = {}) {
  const fields = ['netPnL','profitFactor','sharpe','sortino','maxDrawdown','winRate'];
  return Object.fromEntries(fields.map(k => [k, { baseline: baseline[k] ?? null, candidate: candidate[k] ?? null, delta: Number.isFinite(Number(candidate[k])) && Number.isFinite(Number(baseline[k])) ? Number(candidate[k])-Number(baseline[k]) : null }]));
}
module.exports = { evaluateActions, ablationSummary };
