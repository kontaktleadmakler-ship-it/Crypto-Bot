'use strict';
const {mean,quantile}=require('./institutional-backtest-engine');
function rng(seed){let x=(seed>>>0)||1;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)/4294967296}}
class MonteCarloEngine{
 constructor({runs=10000,seed=42}={}){this.runs=runs;this.seed=seed}
 run(inputTrades,{initialEquity=100000}={}){
  const trades=Array.isArray(inputTrades)?inputTrades:[],r=rng(this.seed),out=[];
  if(!trades.length){for(let k=0;k<this.runs;k++)out.push({finalEquity:initialEquity,totalPnl:0,maxDrawdown:0,returnPct:0,winrate:0});}
  else for(let k=0;k<this.runs;k++){let eq=initialEquity,peak=eq,mdd=0,wins=0;for(let i=0;i<trades.length;i++){const t=trades[Math.floor(r()*trades.length)];const pnl=Number(t.netPnl||0);eq+=pnl;peak=Math.max(peak,eq);mdd=Math.max(mdd,peak-eq);if(pnl>0)wins++}out.push({finalEquity:eq,totalPnl:eq-initialEquity,maxDrawdown:mdd,returnPct:(eq/initialEquity-1)*100,winrate:wins/trades.length})}
  return {runs:this.runs,seed:this.seed,distribution:out,summary:{finalEquity:{p05:quantile(out.map(x=>x.finalEquity),.05),p50:quantile(out.map(x=>x.finalEquity),.5),p95:quantile(out.map(x=>x.finalEquity),.95)},returnPct:{mean:mean(out.map(x=>x.returnPct)),p05:quantile(out.map(x=>x.returnPct),.05),p50:quantile(out.map(x=>x.returnPct),.5),p95:quantile(out.map(x=>x.returnPct),.95)},maxDrawdown:{mean:mean(out.map(x=>x.maxDrawdown)),p95:quantile(out.map(x=>x.maxDrawdown),.95)}}};
 }
}
module.exports={MonteCarloEngine};
