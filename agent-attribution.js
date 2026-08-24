'use strict';
class AgentAttribution {
  constructor({ maxRecords=5000 }={}) { this.maxRecords=maxRecords; this.records=[]; }
  record({ symbol, decision, outcome=null }) { this.records.push({ timestamp:Date.now(), symbol, decision, outcome }); if(this.records.length>this.maxRecords)this.records.shift(); }
  summary() {
    const map=new Map(); for(const r of this.records){ for(const a of (r.decision?.results||[])){ const x=map.get(a.agent)||{agent:a.agent,count:0,vetoes:0,totalScore:0,outcomes:0,pnl:0}; x.count++; x.vetoes+=a.veto?1:0; x.totalScore+=Number(a.score)||0; if(Number.isFinite(Number(r.outcome?.pnl))){x.outcomes++;x.pnl+=Number(r.outcome.pnl);} map.set(a.agent,x); }}
    return [...map.values()].map(x=>({...x,avgScore:x.count?x.totalScore/x.count:0,avgPnl:x.outcomes?x.pnl/x.outcomes:0})).sort((a,b)=>b.avgPnl-a.avgPnl);
  }
}
module.exports={AgentAttribution};
