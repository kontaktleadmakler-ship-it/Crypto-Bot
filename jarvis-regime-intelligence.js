'use strict';

/** JARVIS 5.5 — Regime-Aware Intelligence (read-only analytics). */

function mean(a){ return a.length ? a.reduce((s,x)=>s+x,0)/a.length : 0; }
function stdev(a){ if(a.length<2) return 0; const m=mean(a); return Math.sqrt(mean(a.map(x=>(x-m)**2))); }
function classify(returns, adx=0){
  const vol=stdev(returns);
  const avg=mean(returns);
  const absVol=vol*Math.sqrt(Math.max(1,returns.length));
  if(absVol >= 0.035) return 'CRISIS';
  if(vol >= 0.012) return 'HIGH_VOLATILITY';
  if(adx >= 25 && avg > 0.0004) return 'BULL_TREND';
  if(adx >= 25 && avg < -0.0004) return 'BEAR_TREND';
  return 'RANGING';
}
function metrics(rs){
  if(!rs.length) return {samples:0,hitRate:0,avgReturn:0,sharpe:0,maxDrawdown:0};
  let eq=1,peak=1,mdd=0,w=0;
  for(const r of rs){eq*=1+r;peak=Math.max(peak,eq);mdd=Math.max(mdd,(peak-eq)/peak);if(r>0)w++;}
  const m=mean(rs),sd=stdev(rs);
  return {samples:rs.length,hitRate:w/rs.length*100,avgReturn:m*100,sharpe:sd?m/sd*Math.sqrt(rs.length):0,maxDrawdown:mdd*100};
}

function buildRegimeSnapshots(events, horizon=20){
  const bySym=new Map();
  for(const e of events){ const s=String(e.symbol||'').toUpperCase(); if(!s) continue; if(!bySym.has(s))bySym.set(s,[]); bySym.get(s).push(e); }
  const observations=[];
  for(const [sym,arr] of bySym){
    arr.sort((a,b)=>a.ts-b.ts);
    const prices=arr.map(e=>{const p=e.payload||e.data||{};return Number(p.price??p.close??p.last??p.markPrice??p.market?.price);}).filter(Number.isFinite);
    const rets=[]; for(let i=1;i<prices.length;i++) if(prices[i-1]>0) rets.push(prices[i]/prices[i-1]-1);
    const regime=classify(rets.slice(-60));
    for(let i=0;i<arr.length;i++){
      const e=arr[i]; if(e.type!=='AGENTS:EVALUATED') continue;
      const p=e.payload||{}; const action=String(p.finalAction||'').toUpperCase(); if(!action)continue;
      const entry=Number(p.price??p.close??p.last??p.markPrice??p.market?.price); if(!(entry>0))continue;
      let future=null,steps=0; for(let j=i+1;j<arr.length&&steps<horizon;j++){const q=arr[j].payload||arr[j].data||{};const px=Number(q.price??q.close??q.last??q.markPrice??q.market?.price);if(px>0){future=px;steps++;}}
      if(!(future>0))continue;
      const raw=future/entry-1; const ret=/SELL|SHORT|VERKAUF/.test(action)?-raw:/BUY|LONG|KAUF/.test(action)?raw:null; if(ret==null)continue;
      observations.push({ts:e.ts,symbol:sym,regime,action,returnPct:ret*100,nodes:Array.isArray(p.nodes)?p.nodes:[]});
    }
  }
  return observations;
}

function analyze(events, horizon=20){
  const obs=buildRegimeSnapshots(events,horizon);
  const regimes=['BULL_TREND','BEAR_TREND','RANGING','HIGH_VOLATILITY','CRISIS'];
  const matrix={};
  for(const r of regimes){
    const xs=obs.filter(o=>o.regime===r); matrix[r]={...metrics(xs.map(x=>x.returnPct/100)),actions:{}};
    for(const action of [...new Set(xs.map(x=>x.action))]) matrix[r].actions[action]=metrics(xs.filter(x=>x.action===action).map(x=>x.returnPct/100));
  }
  const agentMap=new Map();
  for(const o of obs) for(const n of o.nodes){const name=String(n.label||n.id||'UNKNOWN');const key=o.regime+'|'+name;if(!agentMap.has(key))agentMap.set(key,{regime:o.regime,agent:name,returns:[],scores:[],pass:[],veto:[]});const a=agentMap.get(key);a.returns.push(o.returnPct/100);a.scores.push(Number(n.score)||0);if(/VETO|BLOCK/i.test(String(n.status||'')))a.veto.push(o.returnPct/100);else a.pass.push(o.returnPct/100);}
  const agents=[...agentMap.values()].map(a=>({regime:a.regime,agent:a.agent,...metrics(a.returns),avgScore:mean(a.scores),passAvg:mean(a.pass)*100,vetoAvg:mean(a.veto)*100}));
  const bestByRegime={}; for(const r of regimes){const xs=agents.filter(a=>a.regime===r&&a.samples);bestByRegime[r]=xs.sort((a,b)=>b.avgReturn-a.avgReturn).slice(0,3);}
  return {mode:'READ_ONLY_REGIME_INTELLIGENCE',timestamp:Date.now(),horizon,observations:obs.length,regimes:matrix,agents,bestByRegime,governance:{liveExecutionTouched:false,modelPromotionAllowed:false},note:'Regime classification is analytical, not a trading command. Agent performance is observational and not causal.'};
}

module.exports={classify,metrics,analyze};
