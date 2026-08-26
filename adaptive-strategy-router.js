'use strict';

/**
 * JARVIS 6.0 — Adaptive Strategy Router
 * Read-only governance recommendation layer.
 * It never submits orders, changes model weights in production, or opens execution.
 */

const DEFAULT_AGENTS = [
  'RISK SUPERVISOR','PORTFOLIO','ANOMALY','LIQUIDITY','EXIT EVALUATOR',
  'STRATEGY','DQN / RL CORE','META SUPERVISOR'
];

const clamp = (v, a=0, b=1) => Math.max(a, Math.min(b, Number(v) || 0));

function regimeKey(phase) {
  const p = String(phase || 'RANGING').toUpperCase().replace(/\s+/g, '_');
  return ['BULL_TREND','BEAR_TREND','RANGING','HIGH_VOLATILITY','CRISIS'].includes(p) ? p : 'RANGING';
}

function scoreAgent(agentRow, currentNode) {
  const hist = agentRow || {};
  const hit = clamp((Number(hist.hitRate) || 50) / 100);
  const ret = Math.tanh((Number(hist.avgReturn) || 0) / 2) * 0.5 + 0.5;
  const sampleConfidence = clamp((Number(hist.samples) || 0) / 50);
  const live = clamp(Number(currentNode?.score) || 0.5);
  return clamp(hit * 0.35 + ret * 0.25 + sampleConfidence * 0.10 + live * 0.30);
}

function route({ regime, agents=[], historicalAgents=[], action='MONITOR', governance={} }={}) {
  const r = regimeKey(regime);
  const rows = historicalAgents.filter(x => regimeKey(x.regime) === r);
  const byName = new Map(rows.map(x => [String(x.agent).toUpperCase(), x]));
  const current = new Map(agents.map(x => [String(x.label || x.id || '').toUpperCase(), x]));
  const names = [...new Set([...DEFAULT_AGENTS, ...agents.map(x => String(x.label || x.id || '').toUpperCase())])];
  const weights = names.map(name => {
    const node = current.get(name);
    const hist = byName.get(name);
    return { agent:name, weight:scoreAgent(hist,node), samples:Number(hist?.samples||0), hitRate:Number(hist?.hitRate||0), avgReturn:Number(hist?.avgReturn||0), liveScore:Number(node?.score||0), status:String(node?.status||'UNKNOWN') };
  });
  const sum = weights.reduce((s,x)=>s+x.weight,0) || 1;
  for (const w of weights) w.weightPct = +(w.weight/sum*100).toFixed(2);
  weights.sort((a,b)=>b.weight-b.weight);

  const vetoes = agents.filter(n => /VETO|BLOCK/i.test(String(n.status||'')));
  const dqn = agents.find(n => /DQN/i.test(String(n.label||'')));
  const hardBlock = vetoes.length > 0;
  const recommendation = hardBlock ? 'BLOCK' : action || 'MONITOR';
  const confidence = Math.round(clamp(weights.reduce((s,w)=>s+w.weight*w.weightPct/100,0))*100);
  const conflicts = [];
  if (dqn && /BUY|LONG/i.test(String(dqn.decision)) && /SELL|SHORT|VERKAUF/i.test(String(action))) conflicts.push('DQN_BULLISH_VS_FINAL');
  if (dqn && /SELL|SHORT/i.test(String(dqn.decision)) && /BUY|LONG|KAUF/i.test(String(action))) conflicts.push('DQN_BEARISH_VS_FINAL');
  return {
    mode:'READ_ONLY_ADAPTIVE_ROUTER', timestamp:Date.now(), regime:r,
    recommendation, confidence, hardBlock, conflicts,
    weights, topAgents:weights.slice(0,5),
    governance:{executionAllowed:false, liveOrders:false, modelPromotionAllowed:false, ...governance},
    rationale: hardBlock ? 'One or more live agent vetoes override adaptive weighting.' : `Weights are regime-conditioned from recorded outcomes plus current agent scores. Regime=${r}.`,
    note:'Adaptive weights are recommendations only. They do not mutate strategy configuration or execution state.'
  };
}

module.exports = { route, regimeKey };
